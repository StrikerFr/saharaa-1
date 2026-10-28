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