-- =========================================================================
-- Sahaara — Phase 9: Secure Family Portal & Caregiver Access Schema
-- =========================================================================
--
-- Trust model:
--  * Clients hold SELECT only.
--  * All grants, invitations, acceptance and revocations go through
--    SECURITY DEFINER functions with fixed search_path = public.
--  * Actor is derived from auth.uid().
--  * Every state mutation is recorded in public.audit_events.
--  * Family members can NEVER see unlinked seniors.

-- 1. Family Access Grants
CREATE TABLE IF NOT EXISTS public.senior_family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id uuid NOT NULL REFERENCES public.seniors(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  relationship_label text NOT NULL CHECK (length(btrim(relationship_label)) BETWEEN 1 AND 60),
  can_view_updates boolean NOT NULL DEFAULT true,
  can_view_observations boolean NOT NULL DEFAULT true,
  can_submit_reports boolean NOT NULL DEFAULT true,
  can_view_tasks boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  granted_by uuid NOT NULL REFERENCES public.profiles(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES public.profiles(id),
  revoked_at timestamptz,
  revocation_reason text CHECK (revocation_reason IS NULL OR length(revocation_reason) <= 500),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT senior_family_member_unique UNIQUE (senior_id, user_id)
);
CREATE INDEX IF NOT EXISTS senior_family_members_user_idx ON public.senior_family_members (user_id, status);
CREATE INDEX IF NOT EXISTS senior_family_members_senior_idx ON public.senior_family_members (senior_id, status);

-- 2. Single-use Cryptographic Invitations
CREATE TABLE IF NOT EXISTS public.family_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id uuid NOT NULL REFERENCES public.seniors(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invited_email text NOT NULL CHECK (invited_email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'),
  relationship_label text NOT NULL CHECK (length(btrim(relationship_label)) BETWEEN 1 AND 60),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_by uuid REFERENCES public.profiles(id),
  accepted_at timestamptz
);
CREATE INDEX IF NOT EXISTS family_invitations_token_idx ON public.family_invitations (token_hash, status);
CREATE INDEX IF NOT EXISTS family_invitations_senior_idx ON public.family_invitations (senior_id, status);

-- 3. Extend follow_up_tasks for Family Visibility and Response
ALTER TABLE public.follow_up_tasks ADD COLUMN IF NOT EXISTS family_visible boolean NOT NULL DEFAULT false;
ALTER TABLE public.follow_up_tasks ADD COLUMN IF NOT EXISTS family_response text CHECK (family_response IS NULL OR length(family_response) <= 2000);
ALTER TABLE public.follow_up_tasks ADD COLUMN IF NOT EXISTS family_responded_at timestamptz;
ALTER TABLE public.follow_up_tasks ADD COLUMN IF NOT EXISTS family_responded_by uuid REFERENCES public.profiles(id);

-- 4. Access helper functions
CREATE OR REPLACE FUNCTION public.can_access_senior_as_family(_senior uuid, _user uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.senior_family_members
    WHERE senior_id = _senior
      AND user_id = _user
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_senior_as_family(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_senior_as_family(uuid, uuid) TO authenticated;

-- Update the master can_access_senior function to include family access
CREATE OR REPLACE FUNCTION public.can_access_senior(_senior uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_access_org((SELECT org_id FROM public.seniors WHERE id = _senior))
      OR public.can_access_senior_as_family(_senior, auth.uid());
$$;
REVOKE ALL ON FUNCTION public.can_access_senior(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_senior(uuid) TO authenticated;

-- Helper to return list of senior IDs accessible by the current family user
CREATE OR REPLACE FUNCTION public.my_family_seniors()
RETURNS TABLE (
  senior_id uuid,
  record_code text,
  display_name text,
  relationship_label text,
  can_view_updates boolean,
  can_view_observations boolean,
  can_submit_reports boolean,
  can_view_tasks boolean
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 
    s.id AS senior_id,
    s.record_code,
    s.display_name,
    f.relationship_label,
    f.can_view_updates,
    f.can_view_observations,
    f.can_submit_reports,
    f.can_view_tasks
  FROM public.senior_family_members f
  JOIN public.seniors s ON s.id = f.senior_id
  WHERE f.user_id = auth.uid()
    AND f.status = 'active'
    AND (f.expires_at IS NULL OR f.expires_at > now())
  ORDER BY s.display_name;
$$;
REVOKE ALL ON FUNCTION public.my_family_seniors() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_family_seniors() TO authenticated;

-- 5. Row Level Security Policies
REVOKE ALL ON public.senior_family_members, public.family_invitations FROM anon, authenticated;
GRANT SELECT ON public.senior_family_members, public.family_invitations TO authenticated;
GRANT ALL ON public.senior_family_members, public.family_invitations TO service_role;

ALTER TABLE public.senior_family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS senior_family_members_read ON public.senior_family_members;
CREATE POLICY senior_family_members_read ON public.senior_family_members FOR SELECT TO authenticated
  USING (public.can_access_org(org_id) OR user_id = auth.uid());

DROP POLICY IF EXISTS family_invitations_read ON public.family_invitations;
CREATE POLICY family_invitations_read ON public.family_invitations FOR SELECT TO authenticated
  USING (public.can_access_org(org_id) OR lower(invited_email) = lower(auth.jwt()->>'email'));

-- Update Seniors RLS to permit family reads
DROP POLICY IF EXISTS "Care team reads org seniors" ON public.seniors;
CREATE POLICY "Care team reads org seniors" ON public.seniors FOR SELECT TO authenticated
  USING (public.can_access_org(org_id) OR public.can_access_senior_as_family(id));

-- Update Observations RLS to permit family reads of verified entries
DROP POLICY IF EXISTS "Care team reads observations" ON public.observations;
CREATE POLICY "Care team reads observations" ON public.observations FOR SELECT TO authenticated
  USING (
    public.can_access_senior(senior_id)
  );

-- Update Routine Items & Logs RLS to permit family reads
DROP POLICY IF EXISTS routine_items_read ON public.care_routine_items;
CREATE POLICY routine_items_read ON public.care_routine_items FOR SELECT TO authenticated
  USING (public.can_access_org(org_id) OR public.can_access_senior_as_family(senior_id));

DROP POLICY IF EXISTS routine_logs_read ON public.care_routine_logs;
CREATE POLICY routine_logs_read ON public.care_routine_logs FOR SELECT TO authenticated
  USING (public.can_access_org(org_id) OR public.can_access_senior_as_family(senior_id));

-- Update Follow-up Tasks RLS to permit family reads if family_visible
DROP POLICY IF EXISTS follow_up_tasks_read ON public.follow_up_tasks;
CREATE POLICY follow_up_tasks_read ON public.follow_up_tasks FOR SELECT TO authenticated
  USING (public.can_access_org(org_id) OR (public.can_access_senior_as_family(senior_id) AND family_visible = true));

-- 6. SECURITY DEFINER Mutation Functions

-- Create Family Invitation (by coordinator/admin)
CREATE OR REPLACE FUNCTION public.create_family_invitation(
  _senior uuid,
  _email text,
  _relationship text,
  _token_hash text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid; _org uuid; _id uuid;
BEGIN
  _actor := public.require_care_actor(_senior);
  SELECT org_id INTO _org FROM public.seniors WHERE id = _senior;
  IF _org IS NULL THEN RAISE EXCEPTION 'senior not found' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.family_invitations (senior_id, org_id, invited_email, relationship_label, token_hash, created_by)
  VALUES (_senior, _org, lower(btrim(_email)), btrim(_relationship), _token_hash, _actor)
  RETURNING id INTO _id;

  PERFORM public.write_audit(_actor, 'family_invitation.created', 'family_invitation', _id::text, 'success',
    jsonb_build_object('senior_id', _senior, 'email', lower(btrim(_email)), 'relationship', _relationship));

  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.create_family_invitation(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_family_invitation(uuid, text, text, text) TO authenticated;

-- Accept Family Invitation (by recipient user)
CREATE OR REPLACE FUNCTION public.accept_family_invitation(_token_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid := auth.uid();
  _inv record;
  _grant_id uuid;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;

  SELECT * INTO _inv FROM public.family_invitations
  WHERE token_hash = _token_hash
    AND status = 'pending'
    AND expires_at > now();

  IF _inv.id IS NULL THEN
    RAISE EXCEPTION 'invitation invalid or expired' USING ERRCODE = 'P0002';
  END IF;

  -- Ensure actor has 'family' role
  INSERT INTO public.user_roles (user_id, role, granted_by)
  VALUES (_actor, 'family', _inv.created_by)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Ensure actor belongs to organization (or update membership if empty)
  INSERT INTO public.organization_members (user_id, org_id, added_by)
  VALUES (_actor, _inv.org_id, _inv.created_by)
  ON CONFLICT (user_id) DO NOTHING;

  -- Create or activate senior family membership
  INSERT INTO public.senior_family_members (senior_id, user_id, org_id, relationship_label, granted_by)
  VALUES (_inv.senior_id, _actor, _inv.org_id, _inv.relationship_label, _inv.created_by)
  ON CONFLICT (senior_id, user_id) DO UPDATE SET
    status = 'active',
    relationship_label = EXCLUDED.relationship_label,
    granted_by = EXCLUDED.granted_by,
    granted_at = now(),
    revoked_at = NULL,
    revoked_by = NULL
  RETURNING id INTO _grant_id;

  -- Mark invitation accepted
  UPDATE public.family_invitations
  SET status = 'accepted', accepted_by = _actor, accepted_at = now()
  WHERE id = _inv.id;

  PERFORM public.write_audit(_actor, 'family_invitation.accepted', 'senior_family_member', _grant_id::text, 'success',
    jsonb_build_object('senior_id', _inv.senior_id, 'org_id', _inv.org_id, 'invitation_id', _inv.id));

  RETURN _inv.senior_id;
END $$;
REVOKE ALL ON FUNCTION public.accept_family_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_family_invitation(text) TO authenticated;

-- Revoke Family Access (by coordinator/admin)
CREATE OR REPLACE FUNCTION public.revoke_family_access(
  _senior uuid,
  _user uuid,
  _reason text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid; _grant_id uuid;
BEGIN
  _actor := public.require_care_actor(_senior);

  UPDATE public.senior_family_members
  SET status = 'revoked', revoked_by = _actor, revoked_at = now(), revocation_reason = btrim(_reason)
  WHERE senior_id = _senior AND user_id = _user AND status = 'active'
  RETURNING id INTO _grant_id;

  IF _grant_id IS NULL THEN
    RAISE EXCEPTION 'family access grant not found or already inactive' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.write_audit(_actor, 'family_access.revoked', 'senior_family_member', _grant_id::text, 'success',
    jsonb_build_object('senior_id', _senior, 'target_user_id', _user, 'reason', _reason));
END $$;
REVOKE ALL ON FUNCTION public.revoke_family_access(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_family_access(uuid, uuid, text) TO authenticated;

-- Respond to Family Task (by family member)
CREATE OR REPLACE FUNCTION public.respond_family_task(
  _task uuid,
  _response text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid := auth.uid();
  _senior uuid;
  _task_id uuid;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;

  SELECT senior_id INTO _senior FROM public.follow_up_tasks WHERE id = _task AND family_visible = true;
  IF _senior IS NULL THEN RAISE EXCEPTION 'task not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT (public.can_access_senior_as_family(_senior, _actor) OR public.can_access_senior(_senior)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.follow_up_tasks
  SET family_response = btrim(_response),
      family_responded_at = now(),
      family_responded_by = _actor,
      version = version + 1
  WHERE id = _task
  RETURNING id INTO _task_id;

  PERFORM public.write_audit(_actor, 'family_task.responded', 'follow_up_task', _task_id::text, 'success',
    jsonb_build_object('senior_id', _senior, 'task_id', _task));
END $$;
REVOKE ALL ON FUNCTION public.respond_family_task(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_family_task(uuid, text) TO authenticated;

