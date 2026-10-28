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