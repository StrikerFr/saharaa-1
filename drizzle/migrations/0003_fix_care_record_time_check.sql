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