-- ===== Phase 11: Smartwatch Live Health Monitoring & Wearable Telemetry
-- Supports Fire-Boltt Legacy smartwatch and standard BLE/cloud health feeds.
--
-- Trust model (consistent with Phases 1-10):
--  * Clients hold SELECT only. Writes run via authenticated SECURITY DEFINER
--    functions or service-role ingestion guarded by can_access_org(org_id).
--  * Wearable telemetry is append-only: raw sensor packets are never altered.
--  * Consumer smartwatch readings are stored with source attribution and must
--    never fabricate a formal medical diagnosis without coordinator clinical confirmation.

CREATE TABLE IF NOT EXISTS public.wearable_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id uuid NOT NULL REFERENCES public.seniors(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  device_name text NOT NULL CHECK (length(btrim(device_name)) BETWEEN 1 AND 100),
  device_model text NOT NULL DEFAULT 'Fire-Boltt Legacy',
  mac_address text CHECK (mac_address IS NULL OR length(mac_address) <= 30),
  connection_status text NOT NULL DEFAULT 'connected'
    CHECK (connection_status IN ('connected', 'disconnected', 'syncing', 'standby')),
  battery_level integer NOT NULL DEFAULT 84 CHECK (battery_level BETWEEN 0 AND 100),
  firmware_version text DEFAULT 'v2.4.18-BLE',
  paired_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wearable_one_device_per_senior UNIQUE (senior_id, device_model)
);
CREATE INDEX IF NOT EXISTS wearable_devices_senior_idx ON public.wearable_devices (senior_id);
CREATE INDEX IF NOT EXISTS wearable_devices_org_idx ON public.wearable_devices (org_id);

CREATE TABLE IF NOT EXISTS public.wearable_health_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id uuid NOT NULL REFERENCES public.seniors(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  device_id uuid REFERENCES public.wearable_devices(id) ON DELETE SET NULL,
  timestamp timestamptz NOT NULL,
  heart_rate integer CHECK (heart_rate IS NULL OR (heart_rate >= 30 AND heart_rate <= 250)),
  spo2 integer CHECK (spo2 IS NULL OR (spo2 >= 70 AND spo2 <= 100)),
  stress_score integer CHECK (stress_score IS NULL OR (stress_score >= 0 AND stress_score <= 100)),
  stress_category text CHECK (stress_category IS NULL OR stress_category IN ('relaxed', 'low', 'normal', 'mild', 'elevated', 'high')),
  bp_systolic integer CHECK (bp_systolic IS NULL OR (bp_systolic >= 60 AND bp_systolic <= 250)),
  bp_diastolic integer CHECK (bp_diastolic IS NULL OR (bp_diastolic >= 40 AND bp_diastolic <= 150)),
  steps integer CHECK (steps IS NULL OR steps >= 0),
  calories integer CHECK (calories IS NULL OR calories >= 0),
  distance_km numeric(6,2) CHECK (distance_km IS NULL OR distance_km >= 0),
  sleep_minutes integer CHECK (sleep_minutes IS NULL OR sleep_minutes >= 0),
  sleep_deep_minutes integer CHECK (sleep_deep_minutes IS NULL OR sleep_deep_minutes >= 0),
  sleep_light_minutes integer CHECK (sleep_light_minutes IS NULL OR sleep_light_minutes >= 0),
  sleep_rem_minutes integer CHECK (sleep_rem_minutes IS NULL OR sleep_rem_minutes >= 0),
  source text NOT NULL DEFAULT 'fire_boltt_legacy',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wearable_readings_senior_time_idx ON public.wearable_health_readings (senior_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS wearable_readings_org_idx ON public.wearable_health_readings (org_id);

CREATE TABLE IF NOT EXISTS public.wearable_health_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id uuid NOT NULL REFERENCES public.seniors(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  metric text NOT NULL CHECK (metric IN ('heart_rate', 'spo2', 'blood_pressure', 'stress', 'sleep', 'inactivity')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 150),
  severity text NOT NULL CHECK (severity IN ('critical', 'warning', 'attention', 'info')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'acknowledged', 'under_review', 'resolved')),
  current_value text NOT NULL,
  previous_value text,
  reason text NOT NULL,
  recommendation text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.profiles(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wearable_alerts_senior_idx ON public.wearable_health_alerts (senior_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS wearable_alerts_status_idx ON public.wearable_health_alerts (status);

-- Append-only trigger for telemetry readings
CREATE OR REPLACE FUNCTION public.wearable_readings_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Wearable telemetry readings are append-only' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS wearable_readings_no_update ON public.wearable_health_readings;
CREATE TRIGGER wearable_readings_no_update BEFORE UPDATE OR DELETE ON public.wearable_health_readings
  FOR EACH ROW EXECUTE FUNCTION public.wearable_readings_immutable();

-- Permissions & RLS
REVOKE ALL ON public.wearable_devices, public.wearable_health_readings, public.wearable_health_alerts FROM anon, authenticated;
GRANT SELECT ON public.wearable_devices, public.wearable_health_readings, public.wearable_health_alerts TO authenticated;
GRANT ALL ON public.wearable_devices, public.wearable_health_readings, public.wearable_health_alerts TO service_role;

ALTER TABLE public.wearable_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wearable_health_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wearable_health_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wearable_devices_read ON public.wearable_devices;
CREATE POLICY wearable_devices_read ON public.wearable_devices FOR SELECT TO authenticated
  USING (public.can_access_org(org_id));

DROP POLICY IF EXISTS wearable_readings_read ON public.wearable_health_readings;
CREATE POLICY wearable_readings_read ON public.wearable_health_readings FOR SELECT TO authenticated
  USING (public.can_access_org(org_id));

DROP POLICY IF EXISTS wearable_alerts_read ON public.wearable_health_alerts;
CREATE POLICY wearable_alerts_read ON public.wearable_health_alerts FOR SELECT TO authenticated
  USING (public.can_access_org(org_id));

-- Stored procedure to update alert status
CREATE OR REPLACE FUNCTION public.update_wearable_alert_status(
  _alert_id uuid,
  _new_status text,
  _notes text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid;
  _org uuid;
BEGIN
  _actor := auth.uid();
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO _org FROM public.wearable_health_alerts WHERE id = _alert_id;
  IF _org IS NULL OR NOT public.can_access_org(_org) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.wearable_health_alerts
  SET status = _new_status,
      notes = COALESCE(_notes, notes),
      resolved_at = CASE WHEN _new_status = 'resolved' THEN now() ELSE resolved_at END,
      resolved_by = CASE WHEN _new_status = 'resolved' THEN _actor ELSE resolved_by END
  WHERE id = _alert_id;

  RETURN true;
END;
$$;
