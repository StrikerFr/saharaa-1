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
