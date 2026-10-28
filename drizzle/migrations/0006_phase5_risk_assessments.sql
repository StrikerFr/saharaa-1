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