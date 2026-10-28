-- ===== Daily routine: scheduled care items (medicine, meals, sleep, ...) and
-- an append-only log of what happened each day. Apply after Phase 7.
--
-- Trust model (same as Phases 6-7)
--  * Clients hold SELECT only. All writes go through SECURITY DEFINER functions
--    that derive the actor from auth.uid() via require_care_actor() and audit.
--  * Logs are append-only: a correction is a new row; the newest row for an
--    item + day is the current state. History is never overwritten.
--  * `source` records who reported it (coordinator, AI-assisted coordinator
--    entry, and later senior/family/whatsapp/call channels). AI-assisted
--    entries are always confirmed by a human before this function is called.

CREATE TABLE IF NOT EXISTS public.care_routine_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id uuid NOT NULL REFERENCES public.seniors(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  category text NOT NULL CHECK (category IN
    ('medication','meal','sleep','exercise','hydration','vitals','hygiene','other')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  details text CHECK (details IS NULL OR length(details) <= 500),
  scheduled_time time NOT NULL,
  -- ISO weekdays 1=Mon..7=Sun
  days_of_week smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT routine_days_valid CHECK (COALESCE(
    cardinality(days_of_week) BETWEEN 1 AND 7 AND days_of_week <@ '{1,2,3,4,5,6,7}'::smallint[], false))
);
CREATE INDEX IF NOT EXISTS care_routine_items_senior_idx ON public.care_routine_items (senior_id, scheduled_time);

CREATE TABLE IF NOT EXISTS public.care_routine_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.care_routine_items(id) ON DELETE CASCADE,
  senior_id uuid NOT NULL REFERENCES public.seniors(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  local_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('done','missed','skipped','pending')),
  done_at timestamptz,
  note text CHECK (note IS NULL OR length(note) <= 500),
  source text NOT NULL CHECK (source IN
    ('coordinator','ai_assist','senior','family','care_worker','whatsapp','call')),
  recorded_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  client_request_id uuid NOT NULL UNIQUE,
  CONSTRAINT routine_done_at CHECK (COALESCE(status = 'done' OR done_at IS NULL, false))
);
CREATE INDEX IF NOT EXISTS care_routine_logs_day_idx ON public.care_routine_logs (senior_id, local_date, created_at DESC);

CREATE OR REPLACE FUNCTION public.care_routine_logs_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'routine logs are append-only' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS care_routine_logs_no_update ON public.care_routine_logs;
CREATE TRIGGER care_routine_logs_no_update BEFORE UPDATE OR DELETE ON public.care_routine_logs
  FOR EACH ROW EXECUTE FUNCTION public.care_routine_logs_immutable();

REVOKE ALL ON public.care_routine_items, public.care_routine_logs FROM anon, authenticated;
GRANT SELECT ON public.care_routine_items, public.care_routine_logs TO authenticated;
GRANT ALL ON public.care_routine_items, public.care_routine_logs TO service_role;
ALTER TABLE public.care_routine_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_routine_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS routine_items_read ON public.care_routine_items;
CREATE POLICY routine_items_read ON public.care_routine_items FOR SELECT TO authenticated
  USING (public.can_access_org(org_id));
DROP POLICY IF EXISTS routine_logs_read ON public.care_routine_logs;
CREATE POLICY routine_logs_read ON public.care_routine_logs FOR SELECT TO authenticated
  USING (public.can_access_org(org_id));

-- Create (when _item IS NULL) or edit a routine item.
CREATE OR REPLACE FUNCTION public.save_routine_item(
  _senior uuid, _item uuid, _category text, _title text, _details text,
  _time time, _days smallint[], _active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid; _org uuid; _id uuid;
BEGIN
  _actor := public.require_care_actor(_senior);
  SELECT org_id INTO _org FROM public.seniors WHERE id = _senior;
  IF _item IS NULL THEN
    INSERT INTO public.care_routine_items
      (senior_id, org_id, category, title, details, scheduled_time, days_of_week, active, created_by)
    VALUES (_senior, _org, _category, btrim(_title), NULLIF(btrim(_details), ''), _time, _days, COALESCE(_active, true), _actor)
    RETURNING id INTO _id;
    PERFORM public.write_audit(_actor, 'routine_item.created', 'care_routine_item', _id::text, 'success',
      jsonb_build_object('senior_id', _senior, 'category', _category));
  ELSE
    UPDATE public.care_routine_items SET category = _category, title = btrim(_title),
      details = NULLIF(btrim(_details), ''), scheduled_time = _time, days_of_week = _days,
      active = COALESCE(_active, active), updated_at = now()
    WHERE id = _item AND senior_id = _senior RETURNING id INTO _id;
    IF _id IS NULL THEN RAISE EXCEPTION 'routine item not found' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.write_audit(_actor, 'routine_item.updated', 'care_routine_item', _id::text, 'success',
      jsonb_build_object('senior_id', _senior, 'active', _active));
  END IF;
  RETURN _id;
END $$;

-- Record what happened for one item on one local day. Idempotent per request id.
CREATE OR REPLACE FUNCTION public.log_routine(
  _item uuid, _date date, _status text, _done_at timestamptz, _note text,
  _source text, _client_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid; _senior uuid; _org uuid; _id uuid;
BEGIN
  SELECT id INTO _id FROM public.care_routine_logs WHERE client_request_id = _client_request_id;
  IF _id IS NOT NULL THEN RETURN _id; END IF;
  SELECT senior_id, org_id INTO _senior, _org FROM public.care_routine_items WHERE id = _item;
  IF _senior IS NULL THEN RAISE EXCEPTION 'routine item not found' USING ERRCODE = 'P0002'; END IF;
  _actor := public.require_care_actor(_senior);
  IF _date > (now() AT TIME ZONE 'UTC')::date + 1 OR _date < (now() AT TIME ZONE 'UTC')::date - 31 THEN
    RAISE EXCEPTION 'date out of range' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.care_routine_logs
    (item_id, senior_id, org_id, local_date, status, done_at, note, source, recorded_by, client_request_id)
  VALUES (_item, _senior, _org, _date, _status,
    CASE WHEN _status = 'done' THEN COALESCE(_done_at, now()) END,
    NULLIF(btrim(_note), ''), _source, _actor, _client_request_id)
  RETURNING id INTO _id;
  PERFORM public.write_audit(_actor, 'routine.logged', 'care_routine_log', _id::text, 'success',
    jsonb_build_object('senior_id', _senior, 'item_id', _item, 'status', _status, 'source', _source));
  RETURN _id;
END $$;

REVOKE ALL ON FUNCTION public.save_routine_item(uuid, uuid, text, text, text, time, smallint[], boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.log_routine(uuid, date, text, timestamptz, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_routine_item(uuid, uuid, text, text, text, time, smallint[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_routine(uuid, date, text, timestamptz, text, text, uuid) TO authenticated;
