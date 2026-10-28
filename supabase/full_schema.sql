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
-- Remove default schema privileges, then grant exactly what the policies need.
REVOKE ALL ON public.profiles, public.user_roles, public.consent_records, public.audit_events FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (display_name) ON public.profiles TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT ON public.consent_records TO authenticated;
GRANT SELECT ON public.audit_events TO authenticated;
REVOKE ALL ON FUNCTION public.prevent_audit_mutation(), public.touch_updated_at(), public.consent_immutable_fields() FROM PUBLIC, anon, authenticated;
-- ===== Organizations (tenant boundary) =====
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX organizations_name_uq ON public.organizations (lower(name));

-- One organization per user (simple, explicit tenancy)
CREATE TABLE public.organization_members (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  added_by uuid REFERENCES public.profiles(id),
  added_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organization_members_org_idx ON public.organization_members (org_id);

REVOKE ALL ON public.organizations, public.organization_members FROM anon, authenticated;
GRANT SELECT ON public.organizations, public.organization_members TO authenticated;
GRANT ALL ON public.organizations, public.organization_members TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_org()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.organization_members WHERE user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.current_org() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_org() TO authenticated;

-- Care-data access: coordinator or admin role AND member of the record's organization
CREATE OR REPLACE FUNCTION public.can_access_org(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _org IS NOT NULL
     AND _org = (SELECT org_id FROM public.organization_members WHERE user_id = auth.uid())
     AND (public.has_role(auth.uid(), 'coordinator') OR public.has_role(auth.uid(), 'admin'))
$$;
REVOKE ALL ON FUNCTION public.can_access_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_org(uuid) TO authenticated;

CREATE POLICY "Members read own org" ON public.organizations FOR SELECT TO authenticated
  USING (id = public.current_org() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Read own membership" ON public.organization_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.admin_create_org(_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid := auth.uid(); _id uuid;
BEGIN
  IF _actor IS NULL OR NOT public.has_role(_actor, 'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.organizations (name, created_by) VALUES (btrim(_name), _actor) RETURNING id INTO _id;
  PERFORM public.write_audit(_actor, 'org.created', 'organization', _id::text, 'success', '{}'::jsonb);
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.admin_create_org(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_org(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_membership(_user uuid, _org uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid := auth.uid();
BEGIN
  IF _actor IS NULL OR NOT public.has_role(_actor, 'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF _org IS NULL THEN
    DELETE FROM public.organization_members WHERE user_id = _user;
  ELSE
    INSERT INTO public.organization_members (user_id, org_id, added_by) VALUES (_user, _org, _actor)
    ON CONFLICT (user_id) DO UPDATE SET org_id = EXCLUDED.org_id, added_by = EXCLUDED.added_by, added_at = now();
  END IF;
  PERFORM public.write_audit(_actor, 'org.membership_set', 'profile', _user::text, 'success',
    jsonb_build_object('org_id', _org));
END $$;
REVOKE ALL ON FUNCTION public.admin_set_membership(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_membership(uuid, uuid) TO authenticated;

-- ===== Seniors =====
CREATE TYPE public.care_status AS ENUM ('active', 'paused', 'discharged');
CREATE TYPE public.preferred_language AS ENUM ('en', 'hi', 'other');

CREATE TABLE public.seniors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  record_code text NOT NULL CHECK (record_code ~ '^[A-Z0-9][A-Z0-9-]{2,19}$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 2 AND 120),
  date_of_birth date CHECK (date_of_birth IS NULL OR (date_of_birth >= DATE '1900-01-01')),
  preferred_language public.preferred_language NOT NULL DEFAULT 'en',
  time_zone text NOT NULL DEFAULT 'Asia/Kolkata' CHECK (length(time_zone) BETWEEN 3 AND 64),
  care_status public.care_status NOT NULL DEFAULT 'active',
  communication_notes text CHECK (length(communication_notes) <= 1000),
  care_context text CHECK (length(care_context) <= 2000),
  is_synthetic boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, record_code)
);
CREATE INDEX seniors_org_name_idx ON public.seniors (org_id, lower(display_name), id);

REVOKE ALL ON public.seniors FROM anon, authenticated;
GRANT SELECT ON public.seniors TO authenticated;
GRANT INSERT (record_code, display_name, date_of_birth, preferred_language, time_zone, care_status, communication_notes, care_context, is_synthetic)
  ON public.seniors TO authenticated;
GRANT UPDATE (display_name, date_of_birth, preferred_language, time_zone, care_status, communication_notes, care_context, is_synthetic)
  ON public.seniors TO authenticated;
GRANT ALL ON public.seniors TO service_role;
ALTER TABLE public.seniors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Care team reads org seniors" ON public.seniors FOR SELECT TO authenticated
  USING (public.can_access_org(org_id));
CREATE POLICY "Care team creates org seniors" ON public.seniors FOR INSERT TO authenticated
  WITH CHECK (public.can_access_org(org_id));
CREATE POLICY "Care team updates org seniors" ON public.seniors FOR UPDATE TO authenticated
  USING (public.can_access_org(org_id)) WITH CHECK (public.can_access_org(org_id));

-- Server-controlled fields: tenant, authorship, timestamps, version
CREATE OR REPLACE FUNCTION public.seniors_set_server_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.org_id := public.current_org();
      NEW.created_by := auth.uid();
    END IF;
    NEW.created_at := now(); NEW.version := 1; NEW.updated_by := NEW.created_by;
  ELSE
    NEW.id := OLD.id; NEW.org_id := OLD.org_id; NEW.record_code := OLD.record_code;
    NEW.created_by := OLD.created_by; NEW.created_at := OLD.created_at;
    NEW.version := OLD.version + 1; NEW.updated_by := auth.uid();
  END IF;
  NEW.updated_at := now();
  IF NEW.date_of_birth IS NOT NULL AND NEW.date_of_birth > current_date THEN
    RAISE EXCEPTION 'date_of_birth_in_future' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.seniors_set_server_fields() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER seniors_server_fields BEFORE INSERT OR UPDATE ON public.seniors
  FOR EACH ROW EXECUTE FUNCTION public.seniors_set_server_fields();

CREATE OR REPLACE FUNCTION public.seniors_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.write_audit(auth.uid(), CASE WHEN TG_OP = 'INSERT' THEN 'senior.created' ELSE 'senior.updated' END,
    'senior', NEW.id::text, 'success', jsonb_build_object('version', NEW.version));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.seniors_audit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER seniors_audit_trg AFTER INSERT OR UPDATE ON public.seniors
  FOR EACH ROW EXECUTE FUNCTION public.seniors_audit();

-- ===== Shared provenance enums =====
CREATE TYPE public.data_source AS ENUM ('manual_entry', 'reported_by_senior', 'reported_by_family', 'device', 'imported');
CREATE TYPE public.verification_status AS ENUM ('verified', 'unverified');

-- ===== Baselines (append-only history; latest per field is current) =====
CREATE TYPE public.baseline_field AS ENUM ('resting_heart_rate', 'blood_pressure', 'weight', 'mobility', 'hearing', 'vision');
CREATE TYPE public.baseline_status AS ENUM ('recorded', 'unknown', 'not_applicable');

CREATE TABLE public.senior_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id uuid NOT NULL REFERENCES public.seniors(id) ON DELETE CASCADE,
  field public.baseline_field NOT NULL,
  status public.baseline_status NOT NULL,
  value_numeric numeric(6,1),
  value_numeric_2 numeric(6,1),
  value_text text CHECK (length(value_text) <= 40),
  unit text CHECK (unit IN ('bpm', 'mmHg', 'kg')),
  note text CHECK (length(note) <= 500),
  captured_at timestamptz NOT NULL,
  source public.data_source NOT NULL DEFAULT 'manual_entry',
  verification public.verification_status NOT NULL DEFAULT 'unverified',
  recorded_by uuid REFERENCES public.profiles(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT baseline_value_shape CHECK (
    (status <> 'recorded' AND value_numeric IS NULL AND value_numeric_2 IS NULL AND value_text IS NULL AND unit IS NULL)
    OR (status = 'recorded' AND (
      (field = 'resting_heart_rate' AND unit = 'bpm' AND value_numeric BETWEEN 20 AND 250 AND value_numeric_2 IS NULL AND value_text IS NULL) OR
      (field = 'blood_pressure' AND unit = 'mmHg' AND value_numeric BETWEEN 50 AND 260 AND value_numeric_2 BETWEEN 30 AND 160 AND value_numeric > value_numeric_2 AND value_text IS NULL) OR
      (field = 'weight' AND unit = 'kg' AND value_numeric BETWEEN 20 AND 300 AND value_numeric_2 IS NULL AND value_text IS NULL) OR
      (field = 'mobility' AND unit IS NULL AND value_numeric IS NULL AND value_text IN ('independent', 'uses_aid', 'needs_assistance', 'bed_bound')) OR
      (field IN ('hearing', 'vision') AND unit IS NULL AND value_numeric IS NULL AND value_text IN ('no_difficulty', 'some_difficulty', 'significant_difficulty', 'uses_device'))
    )))
);
CREATE INDEX senior_baselines_lookup_idx ON public.senior_baselines (senior_id, field, captured_at DESC, recorded_at DESC);

-- ===== Observations (append-only events) =====
CREATE TYPE public.observation_type AS ENUM ('heart_rate', 'blood_pressure', 'weight', 'sleep_duration', 'mobility', 'appetite', 'hydration', 'medication_event', 'care_note');

CREATE TABLE public.observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id uuid NOT NULL REFERENCES public.seniors(id) ON DELETE CASCADE,
  type public.observation_type NOT NULL,
  schema_version smallint NOT NULL DEFAULT 1,
  value_numeric numeric(6,1),
  value_numeric_2 numeric(6,1),
  value_text text CHECK (length(value_text) <= 40),
  unit text CHECK (unit IN ('bpm', 'mmHg', 'kg', 'h')),
  note text CHECK (length(note) <= 2000),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES public.profiles(id),
  source public.data_source NOT NULL DEFAULT 'manual_entry',
  verification public.verification_status NOT NULL DEFAULT 'unverified',
  client_request_id uuid NOT NULL UNIQUE,
  CONSTRAINT observation_value_shape CHECK (
    (type = 'heart_rate' AND unit = 'bpm' AND value_numeric BETWEEN 20 AND 250 AND value_numeric_2 IS NULL AND value_text IS NULL) OR
    (type = 'blood_pressure' AND unit = 'mmHg' AND value_numeric BETWEEN 50 AND 260 AND value_numeric_2 BETWEEN 30 AND 160 AND value_numeric > value_numeric_2 AND value_text IS NULL) OR
    (type = 'weight' AND unit = 'kg' AND value_numeric BETWEEN 20 AND 300 AND value_numeric_2 IS NULL AND value_text IS NULL) OR
    (type = 'sleep_duration' AND unit = 'h' AND value_numeric BETWEEN 0 AND 24 AND value_numeric_2 IS NULL AND value_text IS NULL) OR
    (type = 'mobility' AND unit IS NULL AND value_numeric IS NULL AND value_text IN ('independent', 'uses_aid', 'needs_assistance', 'bed_bound')) OR
    (type IN ('appetite', 'hydration') AND unit IS NULL AND value_numeric IS NULL AND value_text IN ('usual', 'reduced', 'increased', 'refused')) OR
    (type = 'medication_event' AND unit IS NULL AND value_numeric IS NULL AND value_text IN ('taken', 'partially_taken', 'missed', 'refused')) OR
    (type = 'care_note' AND unit IS NULL AND value_numeric IS NULL AND value_text IS NULL AND length(btrim(note)) >= 3)
  )
);
CREATE INDEX observations_history_idx ON public.observations (senior_id, observed_at DESC, id DESC);
CREATE INDEX observations_latest_idx ON public.observations (senior_id, type, observed_at DESC, id DESC);

REVOKE ALL ON public.senior_baselines, public.observations FROM anon, authenticated;
GRANT SELECT ON public.senior_baselines, public.observations TO authenticated;
GRANT INSERT (senior_id, field, status, value_numeric, value_numeric_2, value_text, unit, note, captured_at, source, verification)
  ON public.senior_baselines TO authenticated;
GRANT INSERT (senior_id, type, value_numeric, value_numeric_2, value_text, unit, note, observed_at, source, verification, client_request_id)
  ON public.observations TO authenticated;
GRANT ALL ON public.senior_baselines, public.observations TO service_role;
ALTER TABLE public.senior_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.observations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_access_senior(_senior uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_access_org((SELECT org_id FROM public.seniors WHERE id = _senior))
$$;
REVOKE ALL ON FUNCTION public.can_access_senior(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_senior(uuid) TO authenticated;

CREATE POLICY "Care team reads baselines" ON public.senior_baselines FOR SELECT TO authenticated
  USING (public.can_access_senior(senior_id));
CREATE POLICY "Care team records baselines" ON public.senior_baselines FOR INSERT TO authenticated
  WITH CHECK (public.can_access_senior(senior_id));
CREATE POLICY "Care team reads observations" ON public.observations FOR SELECT TO authenticated
  USING (public.can_access_senior(senior_id));
CREATE POLICY "Care team records observations" ON public.observations FOR INSERT TO authenticated
  WITH CHECK (public.can_access_senior(senior_id));

-- Recorder identity and entry time are always server-assigned; time sanity checks
CREATE OR REPLACE FUNCTION public.care_record_server_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _t timestamptz;
BEGIN
  NEW.recorded_by := auth.uid();
  NEW.recorded_at := now();
  _t := CASE WHEN TG_TABLE_NAME = 'observations' THEN NEW.observed_at ELSE NEW.captured_at END;
  IF _t > now() + interval '5 minutes' THEN RAISE EXCEPTION 'time_in_future' USING ERRCODE = '23514'; END IF;
  IF _t < now() - interval '5 years' THEN RAISE EXCEPTION 'time_too_old' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.care_record_server_fields() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER observations_server_fields BEFORE INSERT ON public.observations
  FOR EACH ROW EXECUTE FUNCTION public.care_record_server_fields();
CREATE TRIGGER baselines_server_fields BEFORE INSERT ON public.senior_baselines
  FOR EACH ROW EXECUTE FUNCTION public.care_record_server_fields();

-- Append-only: no edits or deletes through any client path
CREATE TRIGGER observations_no_mutation BEFORE UPDATE OR DELETE ON public.observations
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.prevent_audit_mutation();
CREATE TRIGGER baselines_no_mutation BEFORE UPDATE OR DELETE ON public.senior_baselines
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.prevent_audit_mutation();

CREATE OR REPLACE FUNCTION public.care_record_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.write_audit(auth.uid(),
    CASE WHEN TG_TABLE_NAME = 'observations' THEN 'observation.recorded' ELSE 'baseline.recorded' END,
    TG_TABLE_NAME, NEW.id::text, 'success', jsonb_build_object('senior_id', NEW.senior_id));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.care_record_audit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER observations_audit AFTER INSERT ON public.observations
  FOR EACH ROW EXECUTE FUNCTION public.care_record_audit();
CREATE TRIGGER baselines_audit AFTER INSERT ON public.senior_baselines
  FOR EACH ROW EXECUTE FUNCTION public.care_record_audit();

-- Read helpers (SECURITY INVOKER: RLS applies)
CREATE OR REPLACE FUNCTION public.latest_observations(_senior uuid)
RETURNS SETOF public.observations LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT DISTINCT ON (type) * FROM public.observations
  WHERE senior_id = _senior ORDER BY type, observed_at DESC, id DESC
$$;
CREATE OR REPLACE FUNCTION public.current_baselines(_senior uuid)
RETURNS SETOF public.senior_baselines LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT DISTINCT ON (field) * FROM public.senior_baselines
  WHERE senior_id = _senior ORDER BY field, captured_at DESC, recorded_at DESC
$$;
REVOKE ALL ON FUNCTION public.latest_observations(uuid), public.current_baselines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.latest_observations(uuid), public.current_baselines(uuid) TO authenticated;

-- Admins may see the names of users in their review (names only)
CREATE OR REPLACE FUNCTION public.profile_names(_ids uuid[])
RETURNS TABLE (id uuid, display_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.display_name FROM public.profiles p
  JOIN public.organization_members m ON m.user_id = p.id
  WHERE p.id = ANY(_ids[1:200]) AND m.org_id = public.current_org() AND public.can_access_org(m.org_id)
$$;
REVOKE ALL ON FUNCTION public.profile_names(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_names(uuid[]) TO authenticated;
CREATE OR REPLACE FUNCTION public.care_record_server_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _t timestamptz;
BEGIN
  NEW.recorded_by := auth.uid();
  NEW.recorded_at := now();
  IF TG_TABLE_NAME = 'observations' THEN
    _t := (to_jsonb(NEW)->>'observed_at')::timestamptz;
  ELSE
    _t := (to_jsonb(NEW)->>'captured_at')::timestamptz;
  END IF;
  IF _t > now() + interval '5 minutes' THEN RAISE EXCEPTION 'time_in_future' USING ERRCODE = '23514'; END IF;
  IF _t < now() - interval '5 years' THEN RAISE EXCEPTION 'time_too_old' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.care_record_server_fields() FROM PUBLIC, anon, authenticated;
-- CHECK constraints treat NULL as pass; wrap shapes in COALESCE(..., false) so missing values are rejected.
ALTER TABLE public.observations DROP CONSTRAINT observation_value_shape;
ALTER TABLE public.observations ADD CONSTRAINT observation_value_shape CHECK (COALESCE(
    (type = 'heart_rate' AND unit = 'bpm' AND value_numeric BETWEEN 20 AND 250 AND value_numeric_2 IS NULL AND value_text IS NULL) OR
    (type = 'blood_pressure' AND unit = 'mmHg' AND value_numeric BETWEEN 50 AND 260 AND value_numeric_2 BETWEEN 30 AND 160 AND value_numeric > value_numeric_2 AND value_text IS NULL) OR
    (type = 'weight' AND unit = 'kg' AND value_numeric BETWEEN 20 AND 300 AND value_numeric_2 IS NULL AND value_text IS NULL) OR
    (type = 'sleep_duration' AND unit = 'h' AND value_numeric BETWEEN 0 AND 24 AND value_numeric_2 IS NULL AND value_text IS NULL) OR
    (type = 'mobility' AND unit IS NULL AND value_numeric IS NULL AND value_numeric_2 IS NULL AND value_text IN ('independent', 'uses_aid', 'needs_assistance', 'bed_bound')) OR
    (type IN ('appetite', 'hydration') AND unit IS NULL AND value_numeric IS NULL AND value_numeric_2 IS NULL AND value_text IN ('usual', 'reduced', 'increased', 'refused')) OR
    (type = 'medication_event' AND unit IS NULL AND value_numeric IS NULL AND value_numeric_2 IS NULL AND value_text IN ('taken', 'partially_taken', 'missed', 'refused')) OR
    (type = 'care_note' AND unit IS NULL AND value_numeric IS NULL AND value_numeric_2 IS NULL AND value_text IS NULL AND note IS NOT NULL AND length(btrim(note)) >= 3),
  false));

ALTER TABLE public.senior_baselines DROP CONSTRAINT baseline_value_shape;
ALTER TABLE public.senior_baselines ADD CONSTRAINT baseline_value_shape CHECK (COALESCE(
    (status <> 'recorded' AND value_numeric IS NULL AND value_numeric_2 IS NULL AND value_text IS NULL AND unit IS NULL)
    OR (status = 'recorded' AND (
      (field = 'resting_heart_rate' AND unit = 'bpm' AND value_numeric BETWEEN 20 AND 250 AND value_numeric_2 IS NULL AND value_text IS NULL) OR
      (field = 'blood_pressure' AND unit = 'mmHg' AND value_numeric BETWEEN 50 AND 260 AND value_numeric_2 BETWEEN 30 AND 160 AND value_numeric > value_numeric_2 AND value_text IS NULL) OR
      (field = 'weight' AND unit = 'kg' AND value_numeric BETWEEN 20 AND 300 AND value_numeric_2 IS NULL AND value_text IS NULL) OR
      (field = 'mobility' AND unit IS NULL AND value_numeric IS NULL AND value_numeric_2 IS NULL AND value_text IN ('independent', 'uses_aid', 'needs_assistance', 'bed_bound')) OR
      (field IN ('hearing', 'vision') AND unit IS NULL AND value_numeric IS NULL AND value_numeric_2 IS NULL AND value_text IN ('no_difficulty', 'some_difficulty', 'significant_difficulty', 'uses_device'))
    )),
  false));
-- Phase 4: synthetic dataset ownership, protected ground truth, ingestion runs.
CREATE TABLE public.synthetic_datasets (
  id text PRIMARY KEY CHECK (id ~ '^syn-[a-z0-9-]{4,60}$'),
  generator_version text NOT NULL,
  seed text NOT NULL,
  reference_date date NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  config jsonb NOT NULL,
  manifest_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.synthetic_datasets FROM anon, authenticated;
GRANT SELECT ON public.synthetic_datasets TO authenticated;
GRANT ALL ON public.synthetic_datasets TO service_role;
ALTER TABLE public.synthetic_datasets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read synthetic datasets" ON public.synthetic_datasets FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Ground truth: evaluation labels. No anon/authenticated access at all.
CREATE TABLE public.synthetic_ground_truth (
  dataset_id text NOT NULL REFERENCES public.synthetic_datasets(id),
  senior_id uuid NOT NULL REFERENCES public.seniors(id),
  scenario text NOT NULL,
  onset_day integer,
  duration_days integer,
  affected_types text[] NOT NULL DEFAULT '{}',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (dataset_id, senior_id)
);
REVOKE ALL ON public.synthetic_ground_truth FROM anon, authenticated;
GRANT ALL ON public.synthetic_ground_truth TO service_role;
ALTER TABLE public.synthetic_ground_truth ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.synthetic_ingestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id text NOT NULL REFERENCES public.synthetic_datasets(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  counts jsonb NOT NULL DEFAULT '{}'::jsonb
);
REVOKE ALL ON public.synthetic_ingestion_runs FROM anon, authenticated;
GRANT SELECT ON public.synthetic_ingestion_runs TO authenticated;
GRANT ALL ON public.synthetic_ingestion_runs TO service_role;
ALTER TABLE public.synthetic_ingestion_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read ingestion runs" ON public.synthetic_ingestion_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Ownership link. Not in authenticated column grants, so clients cannot set it.
ALTER TABLE public.seniors ADD COLUMN synthetic_dataset_id text REFERENCES public.synthetic_datasets(id);
ALTER TABLE public.seniors ADD CONSTRAINT seniors_dataset_is_synthetic
  CHECK (synthetic_dataset_id IS NULL OR is_synthetic);
CREATE INDEX seniors_synthetic_dataset_idx ON public.seniors (synthetic_dataset_id) WHERE synthetic_dataset_id IS NOT NULL;

-- True only inside an explicitly guarded, privileged ingestion session for this senior's dataset.
-- Always false for anon/authenticated callers (they run the care-record triggers too, so EXECUTE stays granted).
CREATE OR REPLACE FUNCTION public.is_synthetic_ingest(_senior uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT auth.uid() IS NULL
     AND current_user NOT IN ('anon', 'authenticated')
     AND COALESCE(current_setting('sahaara.synthetic_ingest', true), '') <> ''
     AND EXISTS (SELECT 1 FROM public.seniors s WHERE s.id = _senior AND s.is_synthetic
                 AND s.synthetic_dataset_id = current_setting('sahaara.synthetic_ingest', true))
$$;

CREATE OR REPLACE FUNCTION public.care_record_server_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _t timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'observations' THEN
    _t := (to_jsonb(NEW)->>'observed_at')::timestamptz;
  ELSE
    _t := (to_jsonb(NEW)->>'captured_at')::timestamptz;
  END IF;
  IF public.is_synthetic_ingest(NEW.senior_id) THEN
    NEW.recorded_by := NULL;
    NEW.recorded_at := COALESCE(NEW.recorded_at, now());
    IF NEW.recorded_at < _t OR NEW.recorded_at > now() + interval '5 minutes' THEN
      RAISE EXCEPTION 'synthetic_recorded_at_invalid' USING ERRCODE = '23514';
    END IF;
  ELSE
    NEW.recorded_by := auth.uid();
    NEW.recorded_at := now();
  END IF;
  IF _t > now() + interval '5 minutes' THEN RAISE EXCEPTION 'time_in_future' USING ERRCODE = '23514'; END IF;
  IF _t < now() - interval '5 years' THEN RAISE EXCEPTION 'time_too_old' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.care_record_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL AND COALESCE(current_setting('sahaara.synthetic_ingest', true), '') <> '' THEN
    RETURN NEW;
  END IF;
  PERFORM public.write_audit(auth.uid(),
    CASE WHEN TG_TABLE_NAME = 'observations' THEN 'observation.recorded' ELSE 'baseline.recorded' END,
    TG_TABLE_NAME, NEW.id::text, 'success', jsonb_build_object('senior_id', NEW.senior_id));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.seniors_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL AND COALESCE(current_setting('sahaara.synthetic_ingest', true), '') <> '' THEN
    RETURN NEW;
  END IF;
  PERFORM public.write_audit(auth.uid(), CASE WHEN TG_OP = 'INSERT' THEN 'senior.created' ELSE 'senior.updated' END,
    'senior', NEW.id::text, 'success', jsonb_build_object('version', NEW.version));
  RETURN NEW;
END $$;
-- Phase 5: append-only, explainable risk assessments. Written only by the server (service role) after the
-- caller's access is verified; the trigger re-checks that the recorded author may access the senior.
CREATE TABLE public.risk_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id uuid NOT NULL REFERENCES public.seniors(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  reference_time timestamptz NOT NULL,
  engine_version text NOT NULL CHECK (length(engine_version) BETWEEN 1 AND 80),
  ruleset_version text NOT NULL CHECK (length(ruleset_version) BETWEEN 1 AND 80),
  config_fingerprint text NOT NULL CHECK (config_fingerprint ~ '^cfg-[0-9a-f]{16}$'),
  input_digest text NOT NULL CHECK (input_digest ~ '^in-[0-9a-f]{16}$'),
  priority text NOT NULL CHECK (priority IN ('unable_to_assess','no_signal_detected','review_suggested','review_recommended','prompt_review_recommended')),
  data_quality text NOT NULL CHECK (data_quality IN ('adequate','limited','insufficient')),
  changed_domains text[] NOT NULL DEFAULT '{}',
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object' AND result->>'schemaVersion' = '1'),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX risk_assessments_senior_created_idx ON public.risk_assessments (senior_id, created_at DESC, id DESC);

REVOKE ALL ON public.risk_assessments FROM anon, authenticated;
GRANT SELECT ON public.risk_assessments TO authenticated;
GRANT SELECT, INSERT ON public.risk_assessments TO service_role;
ALTER TABLE public.risk_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Care team reads assessments" ON public.risk_assessments FOR SELECT TO authenticated
  USING (public.can_access_senior(senior_id));

CREATE OR REPLACE FUNCTION public.risk_assessment_server_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid;
BEGIN
  SELECT org_id INTO _org FROM public.seniors WHERE id = NEW.senior_id;
  IF _org IS NULL THEN RAISE EXCEPTION 'unknown senior' USING ERRCODE = '23503'; END IF;
  IF NOT (EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = NEW.created_by AND org_id = _org)
          AND (public.has_role(NEW.created_by, 'coordinator') OR public.has_role(NEW.created_by, 'admin'))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NEW.reference_time > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'reference_time in the future' USING ERRCODE = '23514';
  END IF;
  NEW.org_id := _org;
  NEW.created_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.risk_assessment_server_fields() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER risk_assessments_server_fields BEFORE INSERT ON public.risk_assessments
  FOR EACH ROW EXECUTE FUNCTION public.risk_assessment_server_fields();

CREATE OR REPLACE FUNCTION public.risk_assessment_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.write_audit(NEW.created_by, 'risk_assessment.created', 'risk_assessment', NEW.id::text, 'success',
    jsonb_build_object('senior_id', NEW.senior_id, 'engine_version', NEW.engine_version,
      'ruleset_version', NEW.ruleset_version, 'config_fingerprint', NEW.config_fingerprint));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.risk_assessment_audit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER risk_assessments_audit AFTER INSERT ON public.risk_assessments
  FOR EACH ROW EXECUTE FUNCTION public.risk_assessment_audit();

CREATE OR REPLACE FUNCTION public.risk_assessment_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'risk_assessments is append-only; recomputation creates a new record';
END $$;
CREATE TRIGGER risk_assessments_no_update BEFORE UPDATE OR DELETE ON public.risk_assessments
  FOR EACH ROW EXECUTE FUNCTION public.risk_assessment_immutable();
CREATE TRIGGER risk_assessments_no_truncate BEFORE TRUNCATE ON public.risk_assessments
  FOR EACH STATEMENT EXECUTE FUNCTION public.risk_assessment_immutable();

-- Denied recomputation attempts: actor is always auth.uid(); callers can only log about themselves.
CREATE OR REPLACE FUNCTION public.log_risk_assessment_denied(_senior uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  PERFORM public.write_audit(auth.uid(), 'risk_assessment.create', 'senior', _senior::text, 'denied', '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.log_risk_assessment_denied(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_risk_assessment_denied(uuid) TO authenticated;

-- ============================================================================
-- Phase 6 — Coordinator operations: review cases and follow-up tasks
-- Review cases track the human review lifecycle of a senior's surfaced
-- assessments; follow-up tasks track the next human action. Clients get
-- SELECT only; every mutation goes through a SECURITY DEFINER function that
-- derives the actor from auth.uid(), validates the transition and org scope,
-- writes append-only history, and audits. Overdue is derived from due_at and
-- status at query time — never stored.
-- ============================================================================

CREATE TYPE public.review_case_status AS ENUM
  ('needs_review', 'in_review', 'follow_up_required', 'resolved', 'dismissed');
CREATE TYPE public.follow_up_task_status AS ENUM
  ('open', 'in_progress', 'completed', 'cancelled');

-- ===== Review cases =====
-- One active case per senior (partial unique index below). A case links the
-- assessment that opened it and the latest assessment seen; superseded
-- assessments stay in risk_assessments and the case keeps its history.
CREATE TABLE public.review_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id uuid NOT NULL REFERENCES public.seniors(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  status public.review_case_status NOT NULL DEFAULT 'needs_review',
  priority_at_open text NOT NULL CHECK (priority_at_open IN
    ('unable_to_assess','no_signal_detected','review_suggested','review_recommended','prompt_review_recommended')),
  opened_by_assessment_id uuid NOT NULL REFERENCES public.risk_assessments(id) ON DELETE RESTRICT,
  latest_assessment_id uuid NOT NULL REFERENCES public.risk_assessments(id) ON DELETE RESTRICT,
  assigned_to uuid REFERENCES public.profiles(id),
  opened_by uuid NOT NULL REFERENCES public.profiles(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
-- Exactly one active (unresolved, undismissed) case per senior.
CREATE UNIQUE INDEX review_cases_one_active_per_senior ON public.review_cases (senior_id)
  WHERE status IN ('needs_review', 'in_review', 'follow_up_required');
CREATE INDEX review_cases_org_status_idx ON public.review_cases (org_id, status, opened_at DESC);
CREATE INDEX review_cases_assignee_idx ON public.review_cases (assigned_to) WHERE assigned_to IS NOT NULL;

REVOKE ALL ON public.review_cases FROM anon, authenticated;
GRANT SELECT ON public.review_cases TO authenticated;
GRANT ALL ON public.review_cases TO service_role;
ALTER TABLE public.review_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Care team reads org review cases" ON public.review_cases FOR SELECT TO authenticated
  USING (public.can_access_org(org_id));

-- Append-only review status history.
CREATE TABLE public.review_case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.review_cases(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  from_status public.review_case_status,
  to_status public.review_case_status NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 2 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_case_events_case_idx ON public.review_case_events (case_id, created_at ASC, id ASC);

REVOKE ALL ON public.review_case_events FROM anon, authenticated;
GRANT SELECT ON public.review_case_events TO authenticated;
GRANT SELECT, INSERT ON public.review_case_events TO service_role;
ALTER TABLE public.review_case_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Care team reads org review events" ON public.review_case_events FOR SELECT TO authenticated
  USING (public.can_access_org(org_id));

CREATE OR REPLACE FUNCTION public.review_case_events_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'review_case_events is append-only';
END $$;
CREATE TRIGGER review_case_events_no_update BEFORE UPDATE OR DELETE ON public.review_case_events
  FOR EACH ROW EXECUTE FUNCTION public.review_case_events_immutable();
CREATE TRIGGER review_case_events_no_truncate BEFORE TRUNCATE ON public.review_case_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.review_case_events_immutable();

-- ===== Follow-up tasks =====
CREATE TABLE public.follow_up_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id uuid NOT NULL REFERENCES public.seniors(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  review_case_id uuid REFERENCES public.review_cases(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 160),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  assigned_to uuid REFERENCES public.profiles(id),
  due_at timestamptz,
  status public.follow_up_task_status NOT NULL DEFAULT 'open',
  outcome_note text CHECK (outcome_note IS NULL OR length(btrim(outcome_note)) BETWEEN 2 AND 2000),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX follow_up_tasks_org_status_due_idx ON public.follow_up_tasks (org_id, status, due_at);
CREATE INDEX follow_up_tasks_senior_idx ON public.follow_up_tasks (senior_id, created_at DESC);
CREATE INDEX follow_up_tasks_case_idx ON public.follow_up_tasks (review_case_id) WHERE review_case_id IS NOT NULL;
CREATE INDEX follow_up_tasks_assignee_idx ON public.follow_up_tasks (assigned_to) WHERE assigned_to IS NOT NULL;

REVOKE ALL ON public.follow_up_tasks FROM anon, authenticated;
GRANT SELECT ON public.follow_up_tasks TO authenticated;
GRANT ALL ON public.follow_up_tasks TO service_role;
ALTER TABLE public.follow_up_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Care team reads org tasks" ON public.follow_up_tasks FOR SELECT TO authenticated
  USING (public.can_access_org(org_id));

CREATE TABLE public.follow_up_task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.follow_up_tasks(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  from_status public.follow_up_task_status,
  to_status public.follow_up_task_status NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 2 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX follow_up_task_events_task_idx ON public.follow_up_task_events (task_id, created_at ASC, id ASC);

REVOKE ALL ON public.follow_up_task_events FROM anon, authenticated;
GRANT SELECT ON public.follow_up_task_events TO authenticated;
GRANT SELECT, INSERT ON public.follow_up_task_events TO service_role;
ALTER TABLE public.follow_up_task_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Care team reads org task events" ON public.follow_up_task_events FOR SELECT TO authenticated
  USING (public.can_access_org(org_id));

CREATE OR REPLACE FUNCTION public.follow_up_task_events_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'follow_up_task_events is append-only';
END $$;
CREATE TRIGGER follow_up_task_events_no_update BEFORE UPDATE OR DELETE ON public.follow_up_task_events
  FOR EACH ROW EXECUTE FUNCTION public.follow_up_task_events_immutable();
CREATE TRIGGER follow_up_task_events_no_truncate BEFORE TRUNCATE ON public.follow_up_task_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.follow_up_task_events_immutable();

-- ===== Shared guards =====
-- Actor must be a coordinator or admin who can access the senior's org.
CREATE OR REPLACE FUNCTION public.require_care_actor(_senior uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid := auth.uid(); _org uuid;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT org_id INTO _org FROM public.seniors WHERE id = _senior;
  IF _org IS NULL OR NOT public.can_access_org(_org) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN _actor;
END $$;
REVOKE ALL ON FUNCTION public.require_care_actor(uuid) FROM PUBLIC, anon, authenticated;

-- An assignee must be a member of the same org with a coordinator or admin role.
CREATE OR REPLACE FUNCTION public.is_valid_assignee(_assignee uuid, _org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _assignee IS NOT NULL AND _org IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = _assignee AND org_id = _org)
     AND (public.has_role(_assignee, 'coordinator') OR public.has_role(_assignee, 'admin'))
$$;
REVOKE ALL ON FUNCTION public.is_valid_assignee(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Helper for assignee selector in task form
CREATE OR REPLACE FUNCTION public.org_assignees()
RETURNS TABLE (id uuid, display_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.display_name
  FROM public.profiles p
  JOIN public.organization_members m ON m.user_id = p.id
  WHERE m.org_id = public.current_org()
    AND public.can_access_org(m.org_id)
    AND (public.has_role(p.id, 'coordinator') OR public.has_role(p.id, 'admin'))
  ORDER BY p.display_name ASC;
$$;
REVOKE ALL ON FUNCTION public.org_assignees() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_assignees() TO authenticated;

-- ===== Review case mutations =====

-- Open a review case for a senior from a specific assessment. Idempotent: if an
-- active case already exists for the senior, its latest_assessment_id is
-- refreshed and the existing case is returned — no duplicate active cases.
CREATE OR REPLACE FUNCTION public.open_review_case(_senior uuid, _assessment uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid; _org uuid; _priority text; _case uuid;
BEGIN
  _actor := public.require_care_actor(_senior);
  SELECT org_id INTO _org FROM public.seniors WHERE id = _senior;
  -- The assessment must belong to this senior and be readable by the actor.
  SELECT priority INTO _priority FROM public.risk_assessments
    WHERE id = _assessment AND senior_id = _senior AND public.can_access_senior(_senior);
  IF _priority IS NULL THEN RAISE EXCEPTION 'assessment not found for this senior' USING ERRCODE = '23503'; END IF;

  SELECT id INTO _case FROM public.review_cases
    WHERE senior_id = _senior AND status IN ('needs_review', 'in_review', 'follow_up_required');
  IF _case IS NOT NULL THEN
    UPDATE public.review_cases SET latest_assessment_id = _assessment, updated_at = now()
      WHERE id = _case;
    RETURN _case;
  END IF;

  INSERT INTO public.review_cases
    (senior_id, org_id, status, priority_at_open, opened_by_assessment_id, latest_assessment_id, opened_by)
    VALUES (_senior, _org, 'needs_review', _priority, _assessment, _assessment, _actor)
    RETURNING id INTO _case;
  INSERT INTO public.review_case_events (case_id, org_id, from_status, to_status, actor_id, reason)
    VALUES (_case, _org, NULL, 'needs_review', _actor, NULL);
  PERFORM public.write_audit(_actor, 'review_case.opened', 'review_case', _case::text, 'success',
    jsonb_build_object('senior_id', _senior, 'assessment_id', _assessment, 'priority', _priority));
  RETURN _case;
END $$;
REVOKE ALL ON FUNCTION public.open_review_case(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_review_case(uuid, uuid) TO authenticated;

-- Validated status transition. Dismissal requires a reason; resolution requires
-- an outcome note. Terminal cases cannot transition. Reopening is a new case
-- via open_review_case, never a status flip, so history stays intact.
CREATE OR REPLACE FUNCTION public.transition_review_case(
  _case uuid, _to public.review_case_status, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid; _from public.review_case_status; _senior uuid; _org uuid;
BEGIN
  SELECT senior_id, org_id, status INTO _senior, _org, _from FROM public.review_cases WHERE id = _case;
  IF _senior IS NULL THEN RAISE EXCEPTION 'case not found' USING ERRCODE = '23503'; END IF;
  _actor := public.require_care_actor(_senior);

  IF _from IN ('resolved', 'dismissed') THEN
    RAISE EXCEPTION 'case is already closed' USING ERRCODE = '23514';
  END IF;
  IF _to = _from THEN
    RAISE EXCEPTION 'case is already in this status' USING ERRCODE = '23514';
  END IF;
  -- Permitted transitions (mirrored in src/lib/review-workflow.ts):
  --   needs_review -> in_review | dismissed
  --   in_review -> follow_up_required | resolved | dismissed
  --   follow_up_required -> resolved | dismissed
  IF NOT ((_from = 'needs_review' AND _to IN ('in_review', 'dismissed'))
       OR (_from = 'in_review' AND _to IN ('follow_up_required', 'resolved', 'dismissed'))
       OR (_from = 'follow_up_required' AND _to IN ('resolved', 'dismissed'))) THEN
    RAISE EXCEPTION 'invalid status transition' USING ERRCODE = '23514';
  END IF;
  IF _to = 'dismissed' AND (_reason IS NULL OR length(btrim(_reason)) < 2) THEN
    RAISE EXCEPTION 'dismissal requires a reason' USING ERRCODE = '23514';
  END IF;
  IF _to = 'resolved' AND (_reason IS NULL OR length(btrim(_reason)) < 2) THEN
    RAISE EXCEPTION 'resolution requires an outcome note' USING ERRCODE = '23514';
  END IF;

  UPDATE public.review_cases
    SET status = _to, updated_at = now(), version = version + 1
    WHERE id = _case AND status = _from; -- concurrent-update guard
  IF NOT FOUND THEN RAISE EXCEPTION 'case changed while you worked; reload and try again' USING ERRCODE = '23514'; END IF;

  INSERT INTO public.review_case_events (case_id, org_id, from_status, to_status, actor_id, reason)
    VALUES (_case, _org, _from, _to, _actor, _reason);
  PERFORM public.write_audit(_actor, 'review_case.' || _to::text, 'review_case', _case::text, 'success',
    jsonb_build_object('senior_id', _senior, 'from', _from, 'to', _to));
END $$;
REVOKE ALL ON FUNCTION public.transition_review_case(uuid, public.review_case_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_review_case(uuid, public.review_case_status, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_review_case(_case uuid, _assignee uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid; _senior uuid; _org uuid; _status public.review_case_status;
BEGIN
  SELECT senior_id, org_id, status INTO _senior, _org, _status FROM public.review_cases WHERE id = _case;
  IF _senior IS NULL THEN RAISE EXCEPTION 'case not found' USING ERRCODE = '23503'; END IF;
  _actor := public.require_care_actor(_senior);
  IF _assignee IS NOT NULL AND NOT public.is_valid_assignee(_assignee, _org) THEN
    RAISE EXCEPTION 'assignee must be a coordinator or admin in this organisation' USING ERRCODE = '42501';
  END IF;
  UPDATE public.review_cases SET assigned_to = _assignee, updated_at = now(), version = version + 1
    WHERE id = _case;
  PERFORM public.write_audit(_actor, 'review_case.assigned', 'review_case', _case::text, 'success',
    jsonb_build_object('senior_id', _senior, 'assignee', _assignee));
END $$;
REVOKE ALL ON FUNCTION public.assign_review_case(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_review_case(uuid, uuid) TO authenticated;

-- ===== Follow-up task mutations =====

CREATE OR REPLACE FUNCTION public.create_follow_up_task(
  _senior uuid, _title text, _notes text DEFAULT NULL, _case uuid DEFAULT NULL,
  _assignee uuid DEFAULT NULL, _due_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid; _org uuid; _case_senior uuid; _task uuid;
BEGIN
  _actor := public.require_care_actor(_senior);
  SELECT org_id INTO _org FROM public.seniors WHERE id = _senior;
  IF _title IS NULL OR length(btrim(_title)) < 2 THEN
    RAISE EXCEPTION 'title is required' USING ERRCODE = '23514';
  END IF;
  IF _case IS NOT NULL THEN
    SELECT senior_id INTO _case_senior FROM public.review_cases WHERE id = _case;
    IF _case_senior IS NULL OR _case_senior <> _senior THEN
      RAISE EXCEPTION 'review case does not belong to this senior' USING ERRCODE = '23503';
    END IF;
  END IF;
  IF _assignee IS NOT NULL AND NOT public.is_valid_assignee(_assignee, _org) THEN
    RAISE EXCEPTION 'assignee must be a coordinator or admin in this organisation' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.follow_up_tasks
    (senior_id, org_id, review_case_id, title, notes, assigned_to, due_at, status, created_by)
    VALUES (_senior, _org, _case, btrim(_title), _notes, _assignee, _due_at, 'open', _actor)
    RETURNING id INTO _task;
  INSERT INTO public.follow_up_task_events (task_id, org_id, from_status, to_status, actor_id, note)
    VALUES (_task, _org, NULL, 'open', _actor, NULL);
  PERFORM public.write_audit(_actor, 'follow_up_task.created', 'follow_up_task', _task::text, 'success',
    jsonb_build_object('senior_id', _senior, 'case_id', _case, 'assignee', _assignee, 'due_at', _due_at));
  RETURN _task;
END $$;
REVOKE ALL ON FUNCTION public.create_follow_up_task(uuid, text, text, uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_follow_up_task(uuid, text, text, uuid, uuid, timestamptz) TO authenticated;

-- Validated task transition. Completion requires an outcome note. Completing a
-- task never closes the review case — that is a separate human decision.
CREATE OR REPLACE FUNCTION public.transition_follow_up_task(
  _task uuid, _to public.follow_up_task_status, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid; _from public.follow_up_task_status; _senior uuid; _org uuid;
BEGIN
  SELECT senior_id, org_id, status INTO _senior, _org, _from FROM public.follow_up_tasks WHERE id = _task;
  IF _senior IS NULL THEN RAISE EXCEPTION 'task not found' USING ERRCODE = '23503'; END IF;
  _actor := public.require_care_actor(_senior);

  IF _from IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'task is already closed' USING ERRCODE = '23514';
  END IF;
  -- Permitted transitions (mirrored in src/lib/review-workflow.ts):
  --   open -> in_progress | completed | cancelled
  --   in_progress -> completed | cancelled | open
  IF NOT ((_from = 'open' AND _to IN ('in_progress', 'completed', 'cancelled'))
       OR (_from = 'in_progress' AND _to IN ('completed', 'cancelled', 'open'))) THEN
    RAISE EXCEPTION 'invalid status transition' USING ERRCODE = '23514';
  END IF;
  IF _to = 'completed' AND (_note IS NULL OR length(btrim(_note)) < 2) THEN
    RAISE EXCEPTION 'completion requires an outcome note' USING ERRCODE = '23514';
  END IF;

  UPDATE public.follow_up_tasks
    SET status = _to,
        outcome_note = CASE WHEN _to = 'completed' THEN btrim(_note) ELSE outcome_note END,
        completed_at = CASE WHEN _to = 'completed' THEN now() ELSE completed_at END,
        updated_at = now(), version = version + 1
    WHERE id = _task AND status = _from; -- concurrent-update guard
  IF NOT FOUND THEN RAISE EXCEPTION 'task changed while you worked; reload and try again' USING ERRCODE = '23514'; END IF;

  INSERT INTO public.follow_up_task_events (task_id, org_id, from_status, to_status, actor_id, note)
    VALUES (_task, _org, _from, _to, _actor, _note);
  PERFORM public.write_audit(_actor, 'follow_up_task.' || _to::text, 'follow_up_task', _task::text, 'success',
    jsonb_build_object('senior_id', _senior, 'from', _from, 'to', _to));
END $$;
REVOKE ALL ON FUNCTION public.transition_follow_up_task(uuid, public.follow_up_task_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_follow_up_task(uuid, public.follow_up_task_status, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_follow_up_task(_task uuid, _assignee uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid; _senior uuid; _org uuid;
BEGIN
  SELECT senior_id, org_id INTO _senior, _org FROM public.follow_up_tasks WHERE id = _task;
  IF _senior IS NULL THEN RAISE EXCEPTION 'task not found' USING ERRCODE = '23503'; END IF;
  _actor := public.require_care_actor(_senior);
  IF _assignee IS NOT NULL AND NOT public.is_valid_assignee(_assignee, _org) THEN
    RAISE EXCEPTION 'assignee must be a coordinator or admin in this organisation' USING ERRCODE = '42501';
  END IF;
  UPDATE public.follow_up_tasks SET assigned_to = _assignee, updated_at = now(), version = version + 1
    WHERE id = _task;
  PERFORM public.write_audit(_actor, 'follow_up_task.assigned', 'follow_up_task', _task::text, 'success',
    jsonb_build_object('senior_id', _senior, 'assignee', _assignee));
END $$;
REVOKE ALL ON FUNCTION public.assign_follow_up_task(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_follow_up_task(uuid, uuid) TO authenticated;

-- ===== Phase 7: care reports, AI candidate cues, human review =====
-- Apply after Phase 6. Idempotent where practical. Also appended to full_schema.sql.
--
-- Trust model
--  * Human actions (submit typed report, correct transcript, review cues, ask for
--    clarification) are SECURITY DEFINER functions callable by `authenticated`;
--    the actor is always auth.uid() via require_care_actor().
--  * Machine outputs (a Groq transcript, Groq-extracted cues, extraction failures)
--    are written only by service_role functions, called by the app server after it
--    verified the caller's JWT and access. Those functions re-validate that the
--    passed actor is a coordinator/admin member of the senior's organisation.
--  * Clients hold SELECT only. Cue JSON is AI output and never trusted for ids,
--    roles or statuses: those columns are set here.
--  * Only confirm_report_cue writes an observation, with client_request_id = cue id,
--    so repeated confirmation can never create a second observation.

DO $$ BEGIN
  CREATE TYPE public.care_report_source AS ENUM ('typed_text', 'transcribed_audio');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.care_report_status AS ENUM
    ('pending_extraction', 'pending_review', 'needs_clarification', 'reviewed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.report_cue_status AS ENUM ('pending_review', 'confirmed', 'rejected', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.care_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id uuid NOT NULL REFERENCES public.seniors(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  source_type public.care_report_source NOT NULL,
  reporter_relation text NOT NULL CHECK (reporter_relation IN ('senior', 'family', 'care_worker', 'coordinator', 'other')),
  -- Typed text, or the machine transcript exactly as returned. Never edited.
  original_text text NOT NULL CHECK (length(btrim(original_text)) >= 1 AND length(original_text) <= 8000),
  -- Human-corrected transcript (audio only). Extraction uses this when present.
  reviewed_text text CHECK (reviewed_text IS NULL OR (length(btrim(reviewed_text)) >= 1 AND length(reviewed_text) <= 8000)),
  declared_language text NOT NULL DEFAULT 'unknown' CHECK (declared_language IN ('en', 'hi', 'hinglish', 'unknown')),
  stt_model text CHECK (length(stt_model) <= 80),
  stt_language text CHECK (length(stt_language) <= 40),
  stt_duration_s numeric(8,1),
  audio_mime text CHECK (length(audio_mime) <= 60),
  audio_bytes integer CHECK (audio_bytes IS NULL OR audio_bytes > 0),
  audio_retained boolean NOT NULL DEFAULT false CHECK (audio_retained = false), -- audio is never stored
  event_time timestamptz,
  submitted_by uuid NOT NULL REFERENCES public.profiles(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status public.care_report_status NOT NULL DEFAULT 'pending_extraction',
  extraction_schema_version text CHECK (length(extraction_schema_version) <= 40),
  llm_model text CHECK (length(llm_model) <= 80),
  extraction_error text CHECK (length(extraction_error) <= 60), -- error code only, never provider payloads
  extraction_attempts smallint NOT NULL DEFAULT 0,
  clarification_note text CHECK (length(clarification_note) <= 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  client_request_id uuid NOT NULL UNIQUE,
  CONSTRAINT care_report_audio_fields CHECK (COALESCE(
    (source_type = 'typed_text' AND reviewed_text IS NULL AND stt_model IS NULL AND audio_mime IS NULL)
    OR (source_type = 'transcribed_audio' AND stt_model IS NOT NULL), false))
);
CREATE INDEX IF NOT EXISTS care_reports_senior_idx ON public.care_reports (senior_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS care_reports_actor_idx ON public.care_reports (submitted_by, submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.report_cues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.care_reports(id) ON DELETE CASCADE,
  senior_id uuid NOT NULL REFERENCES public.seniors(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  attempt smallint NOT NULL,
  position smallint NOT NULL,
  cue jsonb NOT NULL CHECK (jsonb_typeof(cue) = 'object' AND pg_column_size(cue) <= 8000),
  schema_version text NOT NULL CHECK (length(schema_version) <= 40),
  llm_model text NOT NULL CHECK (length(llm_model) <= 80),
  review_status public.report_cue_status NOT NULL DEFAULT 'pending_review',
  reviewer_description text CHECK (length(reviewer_description) <= 500),
  reject_reason text CHECK (length(reject_reason) <= 500),
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  observation_id uuid UNIQUE REFERENCES public.observations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, attempt, position),
  CONSTRAINT cue_confirmed_has_observation CHECK (COALESCE(
    (review_status = 'confirmed') = (observation_id IS NOT NULL), false))
);
CREATE INDEX IF NOT EXISTS report_cues_report_idx ON public.report_cues (report_id, attempt, position);

CREATE TABLE IF NOT EXISTS public.care_report_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES public.care_reports(id) ON DELETE CASCADE,
  cue_id uuid REFERENCES public.report_cues(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  actor_id uuid REFERENCES public.profiles(id),
  action text NOT NULL CHECK (length(action) <= 60),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS care_report_events_report_idx ON public.care_report_events (report_id, at);

REVOKE ALL ON public.care_reports, public.report_cues, public.care_report_events FROM anon, authenticated;
GRANT SELECT ON public.care_reports, public.report_cues, public.care_report_events TO authenticated;
GRANT ALL ON public.care_reports, public.report_cues, public.care_report_events TO service_role;
ALTER TABLE public.care_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_cues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_report_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Care team reads reports" ON public.care_reports;
CREATE POLICY "Care team reads reports" ON public.care_reports FOR SELECT TO authenticated
  USING (public.can_access_org(org_id));
DROP POLICY IF EXISTS "Care team reads cues" ON public.report_cues;
CREATE POLICY "Care team reads cues" ON public.report_cues FOR SELECT TO authenticated
  USING (public.can_access_org(org_id));
DROP POLICY IF EXISTS "Care team reads report events" ON public.care_report_events;
CREATE POLICY "Care team reads report events" ON public.care_report_events FOR SELECT TO authenticated
  USING (public.can_access_org(org_id));

-- History is append-only; original text never changes.
DROP TRIGGER IF EXISTS care_report_events_no_mutation ON public.care_report_events;
CREATE TRIGGER care_report_events_no_mutation BEFORE UPDATE OR DELETE ON public.care_report_events
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.prevent_audit_mutation();

CREATE OR REPLACE FUNCTION public.care_report_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.original_text IS DISTINCT FROM OLD.original_text OR NEW.senior_id <> OLD.senior_id
     OR NEW.org_id <> OLD.org_id OR NEW.submitted_by <> OLD.submitted_by
     OR NEW.source_type <> OLD.source_type OR NEW.submitted_at <> OLD.submitted_at THEN
    RAISE EXCEPTION 'report provenance is immutable' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.care_report_immutable() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS care_reports_immutable ON public.care_reports;
CREATE TRIGGER care_reports_immutable BEFORE UPDATE ON public.care_reports
  FOR EACH ROW EXECUTE FUNCTION public.care_report_immutable();

-- Validates a server-passed actor (service_role paths only).
CREATE OR REPLACE FUNCTION public.require_server_actor(_actor uuid, _senior uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid;
BEGIN
  SELECT org_id INTO _org FROM public.seniors WHERE id = _senior;
  IF _org IS NULL OR NOT public.is_valid_assignee(_actor, _org) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN _org;
END $$;
REVOKE ALL ON FUNCTION public.require_server_actor(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.report_event(_report uuid, _cue uuid, _org uuid, _actor uuid, _action text, _detail jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.care_report_events (report_id, cue_id, org_id, actor_id, action, detail)
  VALUES (_report, _cue, _org, _actor, _action, COALESCE(_detail, '{}'::jsonb));
  SELECT public.write_audit(_actor, _action, CASE WHEN _cue IS NULL THEN 'care_report' ELSE 'report_cue' END,
    COALESCE(_cue, _report)::text, 'success', COALESCE(_detail, '{}'::jsonb) || jsonb_build_object('report_id', _report));
$$;
REVOKE ALL ON FUNCTION public.report_event(uuid, uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Throttle: at most 30 reports per user per hour (bounds provider spend).
CREATE OR REPLACE FUNCTION public.report_throttle(_actor uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT count(*) FROM public.care_reports WHERE submitted_by = _actor AND submitted_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'report_rate_limited' USING ERRCODE = '54000';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.report_throttle(uuid) FROM PUBLIC, anon, authenticated;

-- Human: typed report.
CREATE OR REPLACE FUNCTION public.submit_text_report(
  _senior uuid, _text text, _relation text, _language text, _event_time timestamptz, _client_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid; _org uuid; _id uuid;
BEGIN
  _actor := public.require_care_actor(_senior);
  SELECT id INTO _id FROM public.care_reports WHERE client_request_id = _client_request_id AND submitted_by = _actor;
  IF _id IS NOT NULL THEN RETURN _id; END IF; -- idempotent retry
  PERFORM public.report_throttle(_actor);
  IF _event_time IS NOT NULL AND (_event_time > now() + interval '5 minutes' OR _event_time < now() - interval '1 year') THEN
    RAISE EXCEPTION 'event time out of range' USING ERRCODE = '23514';
  END IF;
  SELECT org_id INTO _org FROM public.seniors WHERE id = _senior;
  INSERT INTO public.care_reports (senior_id, org_id, source_type, reporter_relation, original_text,
      declared_language, event_time, submitted_by, client_request_id)
    VALUES (_senior, _org, 'typed_text', _relation, _text, _language, _event_time, _actor, _client_request_id)
    RETURNING id INTO _id;
  PERFORM public.report_event(_id, NULL, _org, _actor, 'care_report.submitted', jsonb_build_object('source', 'typed_text', 'senior_id', _senior));
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.submit_text_report(uuid, text, text, text, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_text_report(uuid, text, text, text, timestamptz, uuid) TO authenticated;

-- Machine: transcribed audio report (server only; audio itself is not stored).
CREATE OR REPLACE FUNCTION public.record_transcribed_report(
  _actor uuid, _senior uuid, _transcript text, _relation text, _language text, _event_time timestamptz,
  _stt_model text, _stt_language text, _duration numeric, _mime text, _bytes integer, _client_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid; _id uuid;
BEGIN
  _org := public.require_server_actor(_actor, _senior);
  SELECT id INTO _id FROM public.care_reports WHERE client_request_id = _client_request_id AND submitted_by = _actor;
  IF _id IS NOT NULL THEN RETURN _id; END IF;
  PERFORM public.report_throttle(_actor);
  IF _event_time IS NOT NULL AND (_event_time > now() + interval '5 minutes' OR _event_time < now() - interval '1 year') THEN
    RAISE EXCEPTION 'event time out of range' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.care_reports (senior_id, org_id, source_type, reporter_relation, original_text, declared_language,
      event_time, submitted_by, stt_model, stt_language, stt_duration_s, audio_mime, audio_bytes, client_request_id)
    VALUES (_senior, _org, 'transcribed_audio', _relation, _transcript, _language, _event_time, _actor,
      _stt_model, _stt_language, _duration, _mime, _bytes, _client_request_id)
    RETURNING id INTO _id;
  PERFORM public.report_event(_id, NULL, _org, _actor, 'care_report.submitted',
    jsonb_build_object('source', 'transcribed_audio', 'senior_id', _senior, 'stt_model', _stt_model));
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.record_transcribed_report(uuid, uuid, text, text, text, timestamptz, text, text, numeric, text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_transcribed_report(uuid, uuid, text, text, text, timestamptz, text, text, numeric, text, integer, uuid) TO service_role;

-- Machine: store validated cues for a new extraction attempt. Prior pending cues are superseded.
CREATE OR REPLACE FUNCTION public.record_report_extraction(
  _actor uuid, _report uuid, _cues jsonb, _schema_version text, _model text, _needs_clarification boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _senior uuid; _org uuid; _status public.care_report_status; _attempt smallint; _c jsonb; _i int := 0;
BEGIN
  SELECT senior_id, status INTO _senior, _status FROM public.care_reports WHERE id = _report FOR UPDATE;
  IF _senior IS NULL THEN RAISE EXCEPTION 'report not found' USING ERRCODE = '23503'; END IF;
  _org := public.require_server_actor(_actor, _senior);
  IF _status = 'reviewed' THEN RAISE EXCEPTION 'report already reviewed' USING ERRCODE = '23514'; END IF;
  IF jsonb_typeof(_cues) <> 'array' OR jsonb_array_length(_cues) > 12 THEN
    RAISE EXCEPTION 'invalid cues' USING ERRCODE = '23514';
  END IF;
  UPDATE public.care_reports SET extraction_attempts = extraction_attempts + 1 WHERE id = _report
    RETURNING extraction_attempts INTO _attempt;
  UPDATE public.report_cues SET review_status = 'superseded'
    WHERE report_id = _report AND review_status = 'pending_review';
  FOR _c IN SELECT * FROM jsonb_array_elements(_cues) LOOP
    INSERT INTO public.report_cues (report_id, senior_id, org_id, attempt, position, cue, schema_version, llm_model)
      VALUES (_report, _senior, _org, _attempt, _i, _c, _schema_version, _model);
    _i := _i + 1;
  END LOOP;
  UPDATE public.care_reports SET
    status = CASE WHEN _needs_clarification THEN 'needs_clarification'::public.care_report_status
                  WHEN _i = 0 AND NOT EXISTS (SELECT 1 FROM public.report_cues WHERE report_id = _report AND review_status = 'confirmed')
                    THEN 'needs_clarification' ELSE 'pending_review' END,
    extraction_schema_version = _schema_version, llm_model = _model, extraction_error = NULL
    WHERE id = _report;
  PERFORM public.report_event(_report, NULL, _org, _actor, 'care_report.extracted',
    jsonb_build_object('attempt', _attempt, 'cue_count', _i, 'model', _model, 'schema_version', _schema_version));
  RETURN _i;
END $$;
REVOKE ALL ON FUNCTION public.record_report_extraction(uuid, uuid, jsonb, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_report_extraction(uuid, uuid, jsonb, text, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.record_report_failure(_actor uuid, _report uuid, _code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _senior uuid; _org uuid; _status public.care_report_status;
BEGIN
  SELECT senior_id, status INTO _senior, _status FROM public.care_reports WHERE id = _report FOR UPDATE;
  IF _senior IS NULL THEN RAISE EXCEPTION 'report not found' USING ERRCODE = '23503'; END IF;
  _org := public.require_server_actor(_actor, _senior);
  IF _status = 'reviewed' THEN RETURN; END IF;
  UPDATE public.care_reports SET extraction_error = left(_code, 60), extraction_attempts = extraction_attempts + 1,
    status = CASE WHEN _status IN ('pending_extraction', 'failed') THEN 'failed'::public.care_report_status ELSE _status END
    WHERE id = _report;
  PERFORM public.report_event(_report, NULL, _org, _actor, 'care_report.extraction_failed', jsonb_build_object('code', left(_code, 60)));
END $$;
REVOKE ALL ON FUNCTION public.record_report_failure(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_report_failure(uuid, uuid, text) TO service_role;

-- Human: correct a machine transcript before (re)extraction. Not allowed once a cue is confirmed.
CREATE OR REPLACE FUNCTION public.correct_report_transcript(_report uuid, _text text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid; _senior uuid; _org uuid; _src public.care_report_source;
BEGIN
  SELECT senior_id, org_id, source_type INTO _senior, _org, _src FROM public.care_reports WHERE id = _report FOR UPDATE;
  IF _senior IS NULL THEN RAISE EXCEPTION 'report not found' USING ERRCODE = '23503'; END IF;
  _actor := public.require_care_actor(_senior);
  IF _src <> 'transcribed_audio' THEN RAISE EXCEPTION 'only transcripts can be corrected' USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM public.report_cues WHERE report_id = _report AND review_status = 'confirmed') THEN
    RAISE EXCEPTION 'a cue from this report is already confirmed' USING ERRCODE = '23514';
  END IF;
  UPDATE public.report_cues SET review_status = 'superseded' WHERE report_id = _report AND review_status = 'pending_review';
  UPDATE public.care_reports SET reviewed_text = _text, status = 'pending_extraction' WHERE id = _report;
  PERFORM public.report_event(_report, NULL, _org, _actor, 'care_report.transcript_corrected', '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.correct_report_transcript(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_report_transcript(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_report_clarification(_report uuid, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid; _senior uuid; _org uuid; _status public.care_report_status;
BEGIN
  SELECT senior_id, org_id, status INTO _senior, _org, _status FROM public.care_reports WHERE id = _report FOR UPDATE;
  IF _senior IS NULL THEN RAISE EXCEPTION 'report not found' USING ERRCODE = '23503'; END IF;
  _actor := public.require_care_actor(_senior);
  IF _status NOT IN ('pending_review', 'failed', 'needs_clarification') THEN
    RAISE EXCEPTION 'invalid status transition' USING ERRCODE = '23514';
  END IF;
  IF _note IS NULL OR length(btrim(_note)) < 2 THEN RAISE EXCEPTION 'clarification needs a note' USING ERRCODE = '23514'; END IF;
  UPDATE public.care_reports SET status = 'needs_clarification', clarification_note = _note WHERE id = _report;
  PERFORM public.report_event(_report, NULL, _org, _actor, 'care_report.clarification_requested', '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.request_report_clarification(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_report_clarification(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.settle_report_status(_report uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.care_reports SET status = 'reviewed'
  WHERE id = _report AND status IN ('pending_review', 'needs_clarification')
    AND EXISTS (SELECT 1 FROM public.report_cues WHERE report_id = _report AND review_status IN ('confirmed', 'rejected'))
    AND NOT EXISTS (SELECT 1 FROM public.report_cues WHERE report_id = _report AND review_status = 'pending_review');
$$;
REVOKE ALL ON FUNCTION public.settle_report_status(uuid) FROM PUBLIC, anon, authenticated;

-- Human: reject a candidate cue.
CREATE OR REPLACE FUNCTION public.reject_report_cue(_cue uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid; _senior uuid; _org uuid; _report uuid; _st public.report_cue_status;
BEGIN
  SELECT senior_id, org_id, report_id, review_status INTO _senior, _org, _report, _st
    FROM public.report_cues WHERE id = _cue FOR UPDATE;
  IF _senior IS NULL THEN RAISE EXCEPTION 'cue not found' USING ERRCODE = '23503'; END IF;
  _actor := public.require_care_actor(_senior);
  IF _st = 'rejected' THEN RETURN; END IF; -- idempotent
  IF _st <> 'pending_review' THEN RAISE EXCEPTION 'cue is no longer pending review' USING ERRCODE = '23514'; END IF;
  UPDATE public.report_cues SET review_status = 'rejected', reject_reason = NULLIF(btrim(_reason), ''),
    reviewed_by = _actor, reviewed_at = now() WHERE id = _cue;
  PERFORM public.report_event(_report, _cue, _org, _actor, 'report_cue.rejected', jsonb_build_object('senior_id', _senior));
  PERFORM public.settle_report_status(_report);
END $$;
REVOKE ALL ON FUNCTION public.reject_report_cue(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_report_cue(uuid, text) TO authenticated;

-- Human: confirm a cue. Writes exactly one observation (client_request_id = cue id) through the
-- normal observations table, so its CHECKs, server-field trigger and audit trigger all apply.
CREATE OR REPLACE FUNCTION public.confirm_report_cue(
  _cue uuid, _type public.observation_type, _value_numeric numeric, _value_numeric_2 numeric,
  _value_text text, _unit text, _note text, _observed_at timestamptz, _source public.data_source, _description text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid; _senior uuid; _org uuid; _report uuid; _st public.report_cue_status; _obs uuid;
BEGIN
  SELECT senior_id, org_id, report_id, review_status, observation_id INTO _senior, _org, _report, _st, _obs
    FROM public.report_cues WHERE id = _cue FOR UPDATE;
  IF _senior IS NULL THEN RAISE EXCEPTION 'cue not found' USING ERRCODE = '23503'; END IF;
  _actor := public.require_care_actor(_senior);
  IF _st = 'confirmed' THEN RETURN _obs; END IF; -- double-click / retry returns the same observation
  IF _st <> 'pending_review' THEN RAISE EXCEPTION 'cue is no longer pending review' USING ERRCODE = '23514'; END IF;
  IF _source NOT IN ('manual_entry', 'reported_by_senior', 'reported_by_family') THEN
    RAISE EXCEPTION 'invalid source' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.observations (senior_id, type, value_numeric, value_numeric_2, value_text, unit, note,
      observed_at, source, verification, client_request_id)
    VALUES (_senior, _type, _value_numeric, _value_numeric_2, _value_text, _unit, _note,
      _observed_at, _source, 'unverified', _cue)
    ON CONFLICT (client_request_id) DO NOTHING
    RETURNING id INTO _obs;
  IF _obs IS NULL THEN SELECT id INTO _obs FROM public.observations WHERE client_request_id = _cue AND senior_id = _senior; END IF;
  UPDATE public.report_cues SET review_status = 'confirmed', observation_id = _obs,
    reviewer_description = NULLIF(btrim(_description), ''), reviewed_by = _actor, reviewed_at = now()
    WHERE id = _cue;
  PERFORM public.report_event(_report, _cue, _org, _actor, 'report_cue.confirmed',
    jsonb_build_object('senior_id', _senior, 'observation_id', _obs, 'type', _type));
  PERFORM public.settle_report_status(_report);
  RETURN _obs;
END $$;
REVOKE ALL ON FUNCTION public.confirm_report_cue(uuid, public.observation_type, numeric, numeric, text, text, text, timestamptz, public.data_source, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_report_cue(uuid, public.observation_type, numeric, numeric, text, text, text, timestamptz, public.data_source, text) TO authenticated;

-- Server: audit a speech synthesis request (no text stored).
CREATE OR REPLACE FUNCTION public.log_report_tts(_actor uuid, _report uuid, _chars integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _senior uuid; _org uuid;
BEGIN
  SELECT senior_id INTO _senior FROM public.care_reports WHERE id = _report;
  IF _senior IS NULL THEN RAISE EXCEPTION 'report not found' USING ERRCODE = '23503'; END IF;
  _org := public.require_server_actor(_actor, _senior);
  PERFORM public.write_audit(_actor, 'care_report.tts_generated', 'care_report', _report::text, 'success',
    jsonb_build_object('chars', _chars));
END $$;
REVOKE ALL ON FUNCTION public.log_report_tts(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_report_tts(uuid, uuid, integer) TO service_role;
