-- ===== Enums =====
CREATE TYPE public.app_role AS ENUM ('admin', 'coordinator', 'senior', 'family');
CREATE TYPE public.account_status AS ENUM ('active', 'suspended');
CREATE TYPE public.consent_status AS ENUM ('granted', 'withdrawn');
CREATE TYPE public.consent_recipient_category AS ENUM ('care_team', 'family_member');
CREATE TYPE public.consent_purpose AS ENUM ('care_coordination', 'family_updates', 'messaging');
CREATE TYPE public.consent_scope AS ENUM ('wellbeing_summary', 'observations', 'alerts', 'contact_details');
CREATE TYPE public.audit_outcome AS ENUM ('success', 'denied', 'error');

-- ===== Audit events (append-only) =====
CREATE TABLE public.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  action text NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$' AND length(action) <= 64),
  resource_type text NOT NULL CHECK (length(resource_type) <= 40),
  resource_id text CHECK (length(resource_id) <= 80),
  outcome public.audit_outcome NOT NULL,
  correlation_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(metadata) <= 2048)
);
GRANT SELECT ON public.audit_events TO authenticated;
GRANT SELECT, INSERT ON public.audit_events TO service_role;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX audit_events_occurred_idx ON public.audit_events (occurred_at DESC);
CREATE INDEX audit_events_actor_idx ON public.audit_events (actor_id, occurred_at DESC);
CREATE INDEX audit_events_resource_idx ON public.audit_events (resource_type, resource_id);

CREATE OR REPLACE FUNCTION public.prevent_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END $$;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_mutation();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON public.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_audit_mutation();

-- Internal writer: actor is always derived from auth.uid() unless called by a trusted trigger.
CREATE OR REPLACE FUNCTION public.write_audit(
  _actor uuid, _action text, _resource_type text, _resource_id text,
  _outcome public.audit_outcome, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.audit_events (actor_id, action, resource_type, resource_id, outcome, metadata)
  VALUES (_actor, _action, _resource_type, _resource_id, _outcome, COALESCE(_metadata, '{}'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.write_audit(uuid, text, text, text, public.audit_outcome, jsonb) FROM PUBLIC, anon, authenticated;

-- ===== Profiles =====
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '' CHECK (length(display_name) <= 80),
  account_status public.account_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (display_name) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== Roles =====
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE INDEX user_roles_user_idx ON public.user_roles (user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- Policies (default deny; only SELECT/UPDATE explicitly allowed)
CREATE POLICY "Read own profile" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());
CREATE POLICY "Admins read all profiles" ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "Read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Admins read all roles" ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins read audit" ON public.audit_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Profile auto-creation on signup (no role is granted)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, left(COALESCE(NEW.raw_user_meta_data->>'display_name', ''), 80));
  PERFORM public.write_audit(NEW.id, 'account.created', 'profile', NEW.id::text, 'success', '{}'::jsonb);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Audit profile name changes
CREATE OR REPLACE FUNCTION public.audit_profile_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    PERFORM public.write_audit(auth.uid(), 'profile.updated', 'profile', NEW.id::text, 'success',
      jsonb_build_object('fields', jsonb_build_array('display_name')));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_profile_update() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER profiles_audit AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_profile_update();

-- Admin role management (only path to change roles)
CREATE OR REPLACE FUNCTION public.admin_set_role(_target uuid, _role public.app_role, _grant boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid := auth.uid();
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT public.has_role(_actor, 'admin') THEN
    PERFORM public.write_audit(_actor, CASE WHEN _grant THEN 'role.grant' ELSE 'role.revoke' END,
      'user_role', _target::text, 'denied', jsonb_build_object('role', _role));
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _target) THEN
    RAISE EXCEPTION 'unknown_user' USING ERRCODE = 'P0002';
  END IF;
  IF NOT _grant AND _role = 'admin' AND _target = _actor THEN
    RAISE EXCEPTION 'cannot_remove_own_admin' USING ERRCODE = '42501';
  END IF;
  IF _grant THEN
    INSERT INTO public.user_roles (user_id, role, granted_by) VALUES (_target, _role, _actor)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _target AND role = _role;
  END IF;
  PERFORM public.write_audit(_actor, CASE WHEN _grant THEN 'role.grant' ELSE 'role.revoke' END,
    'user_role', _target::text, 'success', jsonb_build_object('role', _role));
END $$;
REVOKE ALL ON FUNCTION public.admin_set_role(uuid, public.app_role, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_role(uuid, public.app_role, boolean) TO authenticated;

-- ===== Consent =====
CREATE TABLE public.consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recorded_by uuid NOT NULL REFERENCES public.profiles(id),
  recipient_category public.consent_recipient_category NOT NULL,
  recipient_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  purpose public.consent_purpose NOT NULL,
  scope public.consent_scope NOT NULL,
  status public.consent_status NOT NULL DEFAULT 'granted',
  effective_from timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  withdrawn_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_withdrawal_consistent CHECK (
    (status = 'granted' AND withdrawn_at IS NULL AND withdrawn_by IS NULL) OR
    (status = 'withdrawn' AND withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL)),
  CONSTRAINT consent_family_needs_recipient CHECK (
    recipient_category <> 'family_member' OR recipient_id IS NOT NULL)
);
GRANT SELECT ON public.consent_records TO authenticated;
GRANT ALL ON public.consent_records TO service_role;
ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;
CREATE INDEX consent_subject_idx ON public.consent_records (subject_id, status);
CREATE INDEX consent_recipient_idx ON public.consent_records (recipient_id, status);
CREATE UNIQUE INDEX consent_one_active ON public.consent_records
  (subject_id, recipient_category, COALESCE(recipient_id, '00000000-0000-0000-0000-000000000000'::uuid), purpose, scope)
  WHERE status = 'granted';

CREATE POLICY "Subject reads own consents" ON public.consent_records FOR SELECT TO authenticated
  USING (subject_id = auth.uid());
CREATE POLICY "Recipient reads consents naming them" ON public.consent_records FOR SELECT TO authenticated
  USING (recipient_id = auth.uid());
CREATE POLICY "Admins read consents" ON public.consent_records FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Only the subject (or an admin acting for them) can grant
CREATE OR REPLACE FUNCTION public.grant_consent(
  _subject uuid, _category public.consent_recipient_category, _recipient uuid,
  _purpose public.consent_purpose, _scope public.consent_scope)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid := auth.uid(); _id uuid;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF _actor <> _subject AND NOT public.has_role(_actor, 'admin') THEN
    PERFORM public.write_audit(_actor, 'consent.grant', 'consent', _subject::text, 'denied', '{}'::jsonb);
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.consent_records (subject_id, recorded_by, recipient_category, recipient_id, purpose, scope)
  VALUES (_subject, _actor, _category, _recipient, _purpose, _scope) RETURNING id INTO _id;
  PERFORM public.write_audit(_actor, 'consent.grant', 'consent', _id::text, 'success',
    jsonb_build_object('purpose', _purpose, 'scope', _scope, 'category', _category));
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.grant_consent(uuid, public.consent_recipient_category, uuid, public.consent_purpose, public.consent_scope) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_consent(uuid, public.consent_recipient_category, uuid, public.consent_purpose, public.consent_scope) TO authenticated;

CREATE OR REPLACE FUNCTION public.withdraw_consent(_consent uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid := auth.uid(); _subject uuid;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  SELECT subject_id INTO _subject FROM public.consent_records WHERE id = _consent AND status = 'granted';
  IF _subject IS NULL OR (_actor <> _subject AND NOT public.has_role(_actor, 'admin')) THEN
    PERFORM public.write_audit(_actor, 'consent.withdraw', 'consent', _consent::text, 'denied', '{}'::jsonb);
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.consent_records SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by = _actor
  WHERE id = _consent;
  PERFORM public.write_audit(_actor, 'consent.withdraw', 'consent', _consent::text, 'success', '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.withdraw_consent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_consent(uuid) TO authenticated;

-- Consent rows are never edited except by withdraw_consent; block other field changes
CREATE OR REPLACE FUNCTION public.consent_immutable_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'withdrawn' THEN RAISE EXCEPTION 'withdrawn consent is final'; END IF;
  IF (NEW.subject_id, NEW.recorded_by, NEW.recipient_category, NEW.recipient_id, NEW.purpose, NEW.scope, NEW.effective_from, NEW.created_at)
     IS DISTINCT FROM
     (OLD.subject_id, OLD.recorded_by, OLD.recipient_category, OLD.recipient_id, OLD.purpose, OLD.scope, OLD.effective_from, OLD.created_at) THEN
    RAISE EXCEPTION 'consent terms are immutable; withdraw and grant anew';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER consent_immutable BEFORE UPDATE ON public.consent_records
  FOR EACH ROW EXECUTE FUNCTION public.consent_immutable_fields();
CREATE TRIGGER consent_no_delete BEFORE DELETE ON public.consent_records
  FOR EACH ROW WHEN (pg_trigger_depth() = 0 AND current_user NOT IN ('postgres','supabase_admin'))
  EXECUTE FUNCTION public.prevent_audit_mutation();

-- Lets the current user check own roles cheaply
CREATE OR REPLACE FUNCTION public.my_roles()
RETURNS SETOF public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.my_roles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_roles() TO authenticated;