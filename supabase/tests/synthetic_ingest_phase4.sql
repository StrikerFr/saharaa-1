SELECT set_config('sahaara.itest_body', $RUN$DO $g$ BEGIN
IF current_setting('sahaara.allow_synthetic_write', true) IS DISTINCT FROM 'syn-fddedfe343646498' THEN
RAISE EXCEPTION 'synthetic write guard not satisfied: set sahaara.allow_synthetic_write to the dataset id';
END IF;
IF auth.uid() IS NOT NULL OR current_user IN ('anon', 'authenticated') THEN
RAISE EXCEPTION 'synthetic ingestion requires a privileged operator session';
END IF;
IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = '7e570000-0000-4000-8000-0000000000a1'::uuid AND name LIKE 'TEST%') THEN
RAISE EXCEPTION 'target organisation must exist and be a TEST organisation';
END IF;
END $g$;
SELECT set_config('sahaara.synthetic_ingest', 'syn-fddedfe343646498', true);
INSERT INTO public.synthetic_datasets (id, generator_version, seed, reference_date, org_id, config, manifest_sha256)
VALUES ('syn-fddedfe343646498', 'sahaara-synth/1.0.0', 'itest', '2026-10-20', '7e570000-0000-4000-8000-0000000000a1', '{"seed":"itest","seniors":1,"days":7,"referenceDate":"2026-10-20","scenarioMix":{"stable_control":0.4,"gradual_weight_loss":0.1,"correlated_decline":0.1,"increased_bp_variability":0.08,"reduced_reporting":0.08,"temporary_deviation_recovery":0.1,"incomplete_baseline":0.08,"medication_adherence_decline":0.06},"missingness":{"baseMissRange":[0.03,0.15],"gapEpisodeProbability":0.25,"gapLengthDays":[2,6],"delayedEntryRate":0.08}}'::jsonb, 'e228c935aa87cfd3e6b297fe655dcd45145571d27723a3a94d659efb6bebbfd4')
ON CONFLICT (id) DO NOTHING;
DO $c$ BEGIN
IF (SELECT manifest_sha256 FROM public.synthetic_datasets WHERE id = 'syn-fddedfe343646498') <> 'e228c935aa87cfd3e6b297fe655dcd45145571d27723a3a94d659efb6bebbfd4' THEN
RAISE EXCEPTION 'dataset id already exists with different content; refusing to mix datasets';
END IF;
IF (SELECT org_id FROM public.synthetic_datasets WHERE id = 'syn-fddedfe343646498') <> '7e570000-0000-4000-8000-0000000000a1'::uuid THEN
RAISE EXCEPTION 'dataset already ingested into a different organisation';
END IF;
END $c$;
INSERT INTO public.synthetic_ingestion_runs (id, dataset_id, status) VALUES ('RUNID', 'syn-fddedfe343646498', 'running') ON CONFLICT (id) DO NOTHING;
DO $b$ DECLARE n int; BEGIN
INSERT INTO public.seniors (id, org_id, record_code, display_name, date_of_birth, preferred_language, time_zone, care_status, care_context, is_synthetic, synthetic_dataset_id)
VALUES ('686fb061-880e-57d6-b046-bdf57f455f46','7e570000-0000-4000-8000-0000000000a1','SFDDE-0001','Synthetic Imran 0001','1938-06-09','en','Asia/Kolkata','active','SYNTHETIC TEST RECORD — fictional person generated for software testing. Not a real senior.',true,'syn-fddedfe343646498')
ON CONFLICT DO NOTHING;
GET DIAGNOSTICS n = ROW_COUNT;
UPDATE public.synthetic_ingestion_runs SET counts = counts || jsonb_build_object(
'seniors_inserted', COALESCE((counts->>'seniors_inserted')::int, 0) + n,
'seniors_skipped', COALESCE((counts->>'seniors_skipped')::int, 0) + (1 - n))
WHERE id = 'RUNID'::uuid;
-- Ownership check: every id must now belong to this dataset (never touch unrelated rows).
IF (SELECT count(*) FROM public.seniors WHERE id IN ('686fb061-880e-57d6-b046-bdf57f455f46') AND synthetic_dataset_id = 'syn-fddedfe343646498') <> 1 THEN
RAISE EXCEPTION 'senior id or record code collides with a record outside this dataset';
END IF;
INSERT INTO public.senior_baselines (id, senior_id, field, status, value_numeric, value_numeric_2, value_text, unit, captured_at, recorded_at, source, verification)
VALUES ('15558992-25bb-5dcd-a6ac-d742a3f345ae','686fb061-880e-57d6-b046-bdf57f455f46','resting_heart_rate','recorded',70,NULL,NULL,'bpm','2026-10-07T04:30:00.000Z','2026-10-07T04:50:00.000Z','imported','unverified'),
('a9048e33-58df-5e7e-95d3-448845d5f8f5','686fb061-880e-57d6-b046-bdf57f455f46','blood_pressure','recorded',136,77,NULL,'mmHg','2026-10-07T04:30:00.000Z','2026-10-07T04:50:00.000Z','imported','unverified'),
('8383da78-eef7-5df4-af71-ffb74b355646','686fb061-880e-57d6-b046-bdf57f455f46','weight','recorded',59.5,NULL,NULL,'kg','2026-10-07T04:30:00.000Z','2026-10-07T04:50:00.000Z','imported','unverified'),
('faabbc78-e371-5cc7-ad75-784cdd1a9aa2','686fb061-880e-57d6-b046-bdf57f455f46','mobility','recorded',NULL,NULL,'independent',NULL,'2026-10-07T04:30:00.000Z','2026-10-07T04:50:00.000Z','imported','unverified'),
('9f933b92-9b4f-5050-8e19-3883c9cb0120','686fb061-880e-57d6-b046-bdf57f455f46','hearing','recorded',NULL,NULL,'no_difficulty',NULL,'2026-10-07T04:30:00.000Z','2026-10-07T04:50:00.000Z','imported','unverified'),
('c789b9c1-70a1-58e1-8687-c4f73f4caa85','686fb061-880e-57d6-b046-bdf57f455f46','vision','recorded',NULL,NULL,'no_difficulty',NULL,'2026-10-07T04:30:00.000Z','2026-10-07T04:50:00.000Z','imported','unverified')
ON CONFLICT DO NOTHING;
GET DIAGNOSTICS n = ROW_COUNT;
UPDATE public.synthetic_ingestion_runs SET counts = counts || jsonb_build_object(
'baselines_inserted', COALESCE((counts->>'baselines_inserted')::int, 0) + n,
'baselines_skipped', COALESCE((counts->>'baselines_skipped')::int, 0) + (6 - n))
WHERE id = 'RUNID'::uuid;
INSERT INTO public.synthetic_ground_truth (dataset_id, senior_id, scenario, onset_day, duration_days, affected_types, details)
VALUES ('syn-fddedfe343646498','686fb061-880e-57d6-b046-bdf57f455f46','stable_control',NULL,NULL,ARRAY[]::text[],'{"expected":"No planted change; negative control.","gap":null}'::jsonb)
ON CONFLICT DO NOTHING;
END $b$;
DO $g$ BEGIN
IF current_setting('sahaara.allow_synthetic_write', true) IS DISTINCT FROM 'syn-fddedfe343646498' THEN
RAISE EXCEPTION 'synthetic write guard not satisfied: set sahaara.allow_synthetic_write to the dataset id';
END IF;
IF auth.uid() IS NOT NULL OR current_user IN ('anon', 'authenticated') THEN
RAISE EXCEPTION 'synthetic ingestion requires a privileged operator session';
END IF;
IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = '7e570000-0000-4000-8000-0000000000a1'::uuid AND name LIKE 'TEST%') THEN
RAISE EXCEPTION 'target organisation must exist and be a TEST organisation';
END IF;
END $g$;
SELECT set_config('sahaara.synthetic_ingest', 'syn-fddedfe343646498', true);
DO $o$ DECLARE n int; BEGIN
INSERT INTO public.observations (id, client_request_id, senior_id, type, value_numeric, value_numeric_2, value_text, unit, note, observed_at, recorded_at, source, verification)
SELECT v.id::uuid, v.req::uuid, v.sid::uuid, v.t::observation_type, v.n1::numeric, v.n2::numeric, v.vt, v.u, v.note, v.oa::timestamptz, v.ra::timestamptz, v.src::data_source, v.ver::verification_status
FROM (VALUES ('ef480e5c-1d3a-5064-b5b6-76e6b90ecc56','168eaeaf-3ec5-5cb4-80f5-43a0916c7b98','686fb061-880e-57d6-b046-bdf57f455f46','heart_rate',65,NULL,NULL,'bpm',NULL,'2026-10-14T01:52:00.000Z','2026-10-14T02:06:00.000Z','imported','unverified'),
('c4ebc11d-e8af-5c23-ab40-76b33042a82c','ef1a6a8a-9e4e-58fc-bca0-c8df6e8970cf','686fb061-880e-57d6-b046-bdf57f455f46','heart_rate',63,NULL,NULL,'bpm',NULL,'2026-10-15T01:55:00.000Z','2026-10-15T02:25:00.000Z','imported','unverified'),
('9cf0a4ad-155b-5f2a-9460-19bacc114a17','c071d25e-ca45-515b-a641-0b4a370a7935','686fb061-880e-57d6-b046-bdf57f455f46','heart_rate',64,NULL,NULL,'bpm',NULL,'2026-10-16T02:43:00.000Z','2026-10-16T03:09:00.000Z','imported','unverified'),
('a9097314-8feb-5cb2-9979-a455271ef933','911f438a-c2fb-5406-9cd0-4d0c8d29db96','686fb061-880e-57d6-b046-bdf57f455f46','heart_rate',71,NULL,NULL,'bpm',NULL,'2026-10-17T03:05:00.000Z','2026-10-17T03:24:00.000Z','imported','unverified'),
('eeb48dac-5fa1-598f-bc3b-42b70251bbf9','7a98087e-6137-58a0-b59c-c0c6bb9085d5','686fb061-880e-57d6-b046-bdf57f455f46','heart_rate',71,NULL,NULL,'bpm',NULL,'2026-10-18T02:15:00.000Z','2026-10-18T02:30:00.000Z','imported','unverified'),
('b1a4fda3-62e1-534f-9643-0b9d883fd588','cbd4770b-e17b-553e-bb05-c001034d43ea','686fb061-880e-57d6-b046-bdf57f455f46','heart_rate',72,NULL,NULL,'bpm',NULL,'2026-10-19T03:00:00.000Z','2026-10-19T03:07:00.000Z','imported','unverified'),
('36bb1b7e-31a1-5452-ad1c-d3dae11179eb','7bf1baac-b43f-5a7b-9228-9024063d6cf0','686fb061-880e-57d6-b046-bdf57f455f46','heart_rate',66,NULL,NULL,'bpm',NULL,'2026-10-20T02:54:00.000Z','2026-10-20T03:18:00.000Z','imported','unverified'),
('4f278a63-a3a9-5705-ab3e-c717dd1adb97','e9b89d4c-fc53-55ec-8842-b0b98a49c6b7','686fb061-880e-57d6-b046-bdf57f455f46','blood_pressure',136,74,NULL,'mmHg',NULL,'2026-10-14T01:54:00.000Z','2026-10-15T02:37:00.000Z','imported','unverified'),
('dc616b71-ad4f-506a-9e69-389266f6238c','78f045b8-e89a-5803-88b1-eac9cca36fbc','686fb061-880e-57d6-b046-bdf57f455f46','blood_pressure',138,77,NULL,'mmHg',NULL,'2026-10-15T02:48:00.000Z','2026-10-15T03:14:00.000Z','imported','unverified'),
('7fae667f-d3bd-58a3-9a29-250645e8a003','817166a9-01a6-539b-9600-7a2fc05ed66b','686fb061-880e-57d6-b046-bdf57f455f46','blood_pressure',141,76,NULL,'mmHg',NULL,'2026-10-17T02:45:00.000Z','2026-10-17T03:04:00.000Z','imported','unverified'),
('7ea82ceb-d433-5ca3-8c18-043167668fb8','37186cd3-2906-5da0-82ee-f12e34f1dc83','686fb061-880e-57d6-b046-bdf57f455f46','blood_pressure',131,77,NULL,'mmHg',NULL,'2026-10-18T02:37:00.000Z','2026-10-18T02:50:00.000Z','imported','unverified'),
('e70db427-7cf2-5ec2-bf45-a50f9fb048a1','6a6f8bc0-aed8-57eb-8bed-d20aaba20e41','686fb061-880e-57d6-b046-bdf57f455f46','blood_pressure',137,75,NULL,'mmHg',NULL,'2026-10-19T02:55:00.000Z','2026-10-19T03:04:00.000Z','imported','unverified'),
('e5e6debb-f474-5c5a-8a73-54b8f5bf86c6','2f23ca30-def5-5fc2-ba8b-c9cef3be00dd','686fb061-880e-57d6-b046-bdf57f455f46','blood_pressure',130,72,NULL,'mmHg',NULL,'2026-10-20T03:05:00.000Z','2026-10-20T03:30:00.000Z','imported','unverified'),
('0251711b-f7fd-581c-82ec-96dea90b4e66','6da50c8c-c824-5f62-9eb1-ec832ba12aa6','686fb061-880e-57d6-b046-bdf57f455f46','sleep_duration',7.2,NULL,NULL,'h',NULL,'2026-10-14T03:17:00.000Z','2026-10-14T03:30:00.000Z','imported','unverified'),
('f7e4a9ed-8144-5f8b-8923-43ef0389cd06','a8ad8d2f-983d-57cc-9789-fdb8d81f7796','686fb061-880e-57d6-b046-bdf57f455f46','sleep_duration',7.1,NULL,NULL,'h',NULL,'2026-10-15T03:29:00.000Z','2026-10-15T03:54:00.000Z','imported','unverified'),
('95d96bc7-b6ff-550c-885c-40f88ec851ef','04f20254-8e3c-572d-bfdb-fefdc7aa7ee7','686fb061-880e-57d6-b046-bdf57f455f46','sleep_duration',7.3,NULL,NULL,'h',NULL,'2026-10-16T04:01:00.000Z','2026-10-16T04:30:00.000Z','imported','unverified'),
('85d54a90-0e5b-599d-b448-0b25d505fe99','88da9666-4493-5f9d-ba41-5452e3341b43','686fb061-880e-57d6-b046-bdf57f455f46','sleep_duration',8,NULL,NULL,'h',NULL,'2026-10-18T04:07:00.000Z','2026-10-18T04:09:00.000Z','imported','unverified'),
('6561f555-4437-53dc-a203-bb63d67534f1','d0d92d39-a778-5be4-8bfe-ca5614e13ffb','686fb061-880e-57d6-b046-bdf57f455f46','sleep_duration',7.9,NULL,NULL,'h',NULL,'2026-10-19T03:04:00.000Z','2026-10-19T03:17:00.000Z','imported','unverified'),
('66a3de91-a9f3-57e0-9806-ea19401e6aca','3151dc10-3d91-579f-b397-b38fdb1da5e8','686fb061-880e-57d6-b046-bdf57f455f46','sleep_duration',7.6,NULL,NULL,'h',NULL,'2026-10-20T03:28:00.000Z','2026-10-20T03:54:00.000Z','imported','unverified'),
('f676e638-47dd-519b-91cf-aad31a012e7e','354affcc-e2c6-546c-9ca1-a294672ad91c','686fb061-880e-57d6-b046-bdf57f455f46','appetite',NULL,NULL,'usual',NULL,NULL,'2026-10-16T07:04:00.000Z','2026-10-16T07:10:00.000Z','imported','unverified'),
('31bb7154-4dbb-5443-9dae-db610983d543','075a767b-1291-57fe-a95f-90d088119cf9','686fb061-880e-57d6-b046-bdf57f455f46','appetite',NULL,NULL,'usual',NULL,NULL,'2026-10-17T07:54:00.000Z','2026-10-18T13:48:00.000Z','imported','unverified'),
('8ad3cc2f-4150-555c-ba78-0b6429ce1884','9ffd049b-3b3e-5dc9-8927-f51fc8f1d75e','686fb061-880e-57d6-b046-bdf57f455f46','appetite',NULL,NULL,'usual',NULL,NULL,'2026-10-18T07:35:00.000Z','2026-10-18T07:43:00.000Z','imported','unverified'),
('7ac88c9d-64b5-58a8-80c0-e9edb0ce43e4','d5192ca0-f52e-57ea-828d-a89accd2329b','686fb061-880e-57d6-b046-bdf57f455f46','appetite',NULL,NULL,'increased',NULL,NULL,'2026-10-19T06:59:00.000Z','2026-10-19T07:11:00.000Z','imported','unverified'),
('f9868ffe-3ef0-5c4a-89b4-7d14eef99e44','80df7abd-ac9f-557a-a147-e82b9b7509db','686fb061-880e-57d6-b046-bdf57f455f46','appetite',NULL,NULL,'usual',NULL,NULL,'2026-10-20T07:26:00.000Z','2026-10-20T07:46:00.000Z','imported','unverified'),
('55c5a4e5-0fd1-5339-969e-38811cec519f','225740fc-49a1-51a1-bc43-ee46d89242e2','686fb061-880e-57d6-b046-bdf57f455f46','hydration',NULL,NULL,'usual',NULL,NULL,'2026-10-14T11:27:00.000Z','2026-10-14T11:53:00.000Z','imported','unverified'),
('6869b221-6578-54e1-b3fb-65d9857c8132','ccd76391-0061-5eb3-a64e-0bd83edea18f','686fb061-880e-57d6-b046-bdf57f455f46','hydration',NULL,NULL,'usual',NULL,NULL,'2026-10-15T11:27:00.000Z','2026-10-15T11:30:00.000Z','imported','unverified'),
('561f5a5c-999e-5d9d-8c1b-5984c8d7020d','ea0c87e4-93eb-5d1a-974f-44610cb6ecc5','686fb061-880e-57d6-b046-bdf57f455f46','hydration',NULL,NULL,'usual',NULL,NULL,'2026-10-18T11:07:00.000Z','2026-10-18T11:19:00.000Z','imported','unverified'),
('0c83d50e-64ad-5f64-bc3f-1e413a178fd4','96218007-8d6f-5c30-b11c-e2a5332a1d08','686fb061-880e-57d6-b046-bdf57f455f46','hydration',NULL,NULL,'usual',NULL,NULL,'2026-10-19T11:58:00.000Z','2026-10-19T12:27:00.000Z','imported','unverified'),
('06ec53dc-31e4-5b40-ad67-fc2c70015297','61a4eb7f-ef0c-5340-b008-7a2b046566af','686fb061-880e-57d6-b046-bdf57f455f46','medication_event',NULL,NULL,'taken',NULL,NULL,'2026-10-14T14:34:00.000Z','2026-10-14T14:48:00.000Z','imported','unverified'),
('a711773a-5b4c-5573-ad8b-5acaa020f894','01742600-55d3-5390-bb1b-cf272faea674','686fb061-880e-57d6-b046-bdf57f455f46','medication_event',NULL,NULL,'taken',NULL,NULL,'2026-10-15T14:50:00.000Z','2026-10-15T15:01:00.000Z','imported','unverified'),
('f0d00b9f-1eb8-53ef-8346-17aed03667f4','52f0696b-6c84-5d1c-929b-e9cd84c12465','686fb061-880e-57d6-b046-bdf57f455f46','medication_event',NULL,NULL,'taken',NULL,NULL,'2026-10-16T13:57:00.000Z','2026-10-16T14:19:00.000Z','imported','unverified'),
('edead74f-d12f-52c3-bb49-dbc803630232','909da8b1-4fa2-520e-94ac-bd59967b4fbd','686fb061-880e-57d6-b046-bdf57f455f46','medication_event',NULL,NULL,'taken',NULL,NULL,'2026-10-17T14:19:00.000Z','2026-10-17T14:32:00.000Z','imported','unverified'),
('93722884-1dd4-5d75-8d4d-71ffc3b7b9b6','3d31dd82-2856-582e-8db1-ff6291376526','686fb061-880e-57d6-b046-bdf57f455f46','medication_event',NULL,NULL,'taken',NULL,NULL,'2026-10-18T14:45:00.000Z','2026-10-18T17:41:00.000Z','imported','unverified'),
('248ea62d-d42e-5816-a412-61de254174b4','cb9ed55f-4bab-5e69-ad16-8b1fdbf8bd77','686fb061-880e-57d6-b046-bdf57f455f46','medication_event',NULL,NULL,'taken',NULL,NULL,'2026-10-19T14:53:00.000Z','2026-10-19T15:19:00.000Z','imported','unverified'),
('b4ce73c8-b0ee-5a6d-98b3-e9afb04f0316','dbdf3bbd-48fb-515f-8017-b559c5626b0d','686fb061-880e-57d6-b046-bdf57f455f46','medication_event',NULL,NULL,'partially_taken',NULL,NULL,'2026-10-20T13:56:00.000Z','2026-10-20T14:10:00.000Z','imported','unverified'),
('27dcc089-4b33-5b5b-8480-611622b464ac','d850e465-427a-5eaa-bc90-1dd7410cc9a9','686fb061-880e-57d6-b046-bdf57f455f46','mobility',NULL,NULL,'independent',NULL,NULL,'2026-10-15T05:16:00.000Z','2026-10-15T05:42:00.000Z','imported','unverified'),
('2d88c81b-f7ac-5cdf-8df4-5bba9b276ab6','2ca5272c-1ba0-53fc-bbac-5e6118ed3e8e','686fb061-880e-57d6-b046-bdf57f455f46','mobility',NULL,NULL,'uses_aid',NULL,NULL,'2026-10-18T05:43:00.000Z','2026-10-18T05:47:00.000Z','imported','unverified'),
('406cb8b3-2c01-5f5e-b4fd-83b55e528d6a','3134e50a-5054-5345-a410-e022c6725320','686fb061-880e-57d6-b046-bdf57f455f46','weight',59.6,NULL,NULL,'kg',NULL,'2026-10-14T03:34:00.000Z','2026-10-14T03:58:00.000Z','imported','unverified'),
('4dca7496-4a2d-5138-85a1-1cea139b5a61','96d9c162-e574-56d9-ace1-8713eb4f4520','686fb061-880e-57d6-b046-bdf57f455f46','care_note',NULL,NULL,NULL,NULL,'Synthetic routine check-in recorded for software testing.','2026-10-20T10:05:00.000Z','2026-10-20T10:11:00.000Z','imported','unverified')) AS v(id, req, sid, t, n1, n2, vt, u, note, oa, ra, src, ver)
JOIN public.seniors s ON s.id = v.sid::uuid AND s.synthetic_dataset_id = 'syn-fddedfe343646498'
ON CONFLICT DO NOTHING;
GET DIAGNOSTICS n = ROW_COUNT;
UPDATE public.synthetic_ingestion_runs SET counts = counts || jsonb_build_object(
'observations_inserted', COALESCE((counts->>'observations_inserted')::int, 0) + n,
'observations_skipped', COALESCE((counts->>'observations_skipped')::int, 0) + (39 - n))
WHERE id = 'RUNID'::uuid;
END $o$;
DO $g$ BEGIN
IF current_setting('sahaara.allow_synthetic_write', true) IS DISTINCT FROM 'syn-fddedfe343646498' THEN
RAISE EXCEPTION 'synthetic write guard not satisfied: set sahaara.allow_synthetic_write to the dataset id';
END IF;
IF auth.uid() IS NOT NULL OR current_user IN ('anon', 'authenticated') THEN
RAISE EXCEPTION 'synthetic ingestion requires a privileged operator session';
END IF;
IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = '7e570000-0000-4000-8000-0000000000a1'::uuid AND name LIKE 'TEST%') THEN
RAISE EXCEPTION 'target organisation must exist and be a TEST organisation';
END IF;
END $g$;
SELECT set_config('sahaara.synthetic_ingest', 'syn-fddedfe343646498', true);
UPDATE public.synthetic_ingestion_runs SET status = 'completed', finished_at = now(),
counts = counts || jsonb_build_object(
'db_seniors', (SELECT count(*) FROM public.seniors WHERE synthetic_dataset_id = 'syn-fddedfe343646498'),
'db_observations', (SELECT count(*) FROM public.observations ob JOIN public.seniors s ON s.id = ob.senior_id WHERE s.synthetic_dataset_id = 'syn-fddedfe343646498'),
'expected_observations', 39)
WHERE id = 'RUNID'::uuid;
SELECT public.write_audit(NULL, 'synthetic.ingested', 'synthetic_dataset', 'syn-fddedfe343646498', 'success', jsonb_build_object('run_id', 'RUNID'));$RUN$, true);
DO $all$ DECLARE r text := ''; BEGIN
INSERT INTO public.organizations(id,name) VALUES ('7e570000-0000-4000-8000-0000000000a1','TEST — Phase4 rollback itest');
BEGIN PERFORM set_config('sahaara.allow_synthetic_write','',true); EXECUTE replace(current_setting('sahaara.itest_body'),'RUNID','7e570000-0000-4000-8000-0000000000b1'); r := r || 'no_guard=ALLOWED!; ';
EXCEPTION WHEN OTHERS THEN r := r || 'no_guard=' || CASE WHEN SQLERRM LIKE '%guard not satisfied%' THEN 'blocked' ELSE 'other:' || SQLERRM END || '; '; END;
BEGIN PERFORM set_config('sahaara.allow_synthetic_write','syn-fddedfe343646498',true); INSERT INTO public.seniors(id,org_id,record_code,display_name) VALUES ('686fb061-880e-57d6-b046-bdf57f455f46','7e570000-0000-4000-8000-0000000000a1','REAL-0001','Manually entered person'); EXECUTE replace(current_setting('sahaara.itest_body'),'RUNID','7e570000-0000-4000-8000-0000000000b1'); r := r || 'collision=ALLOWED!; ';
EXCEPTION WHEN OTHERS THEN r := r || 'collision=' || CASE WHEN SQLERRM LIKE '%collides%' THEN 'blocked' ELSE 'other:' || SQLERRM END || '; '; END;
PERFORM set_config('sahaara.allow_synthetic_write','syn-fddedfe343646498',true);
UPDATE public.organizations SET name='Real Care Org itest' WHERE id='7e570000-0000-4000-8000-0000000000a1';
BEGIN  EXECUTE replace(current_setting('sahaara.itest_body'),'RUNID','7e570000-0000-4000-8000-0000000000b1'); r := r || 'non_test_org=ALLOWED!; ';
EXCEPTION WHEN OTHERS THEN r := r || 'non_test_org=' || CASE WHEN SQLERRM LIKE '%TEST organisation%' THEN 'blocked' ELSE 'other:' || SQLERRM END || '; '; END;
UPDATE public.organizations SET name='TEST — Phase4 rollback itest' WHERE id='7e570000-0000-4000-8000-0000000000a1';
EXECUTE replace(current_setting('sahaara.itest_body'),'RUNID','7e570000-0000-4000-8000-0000000000b1');
EXECUTE replace(current_setting('sahaara.itest_body'),'RUNID','7e570000-0000-4000-8000-0000000000b2');
RAISE NOTICE 'phase-a %', r;
PERFORM set_config('sahaara.itest_r', r, true);
END $all$;
DO $t$ DECLARE r text := current_setting('sahaara.itest_r'); c1 jsonb; c2 jsonb; n int; BEGIN
SELECT counts INTO c1 FROM public.synthetic_ingestion_runs WHERE id='7e570000-0000-4000-8000-0000000000b1';
SELECT counts INTO c2 FROM public.synthetic_ingestion_runs WHERE id='7e570000-0000-4000-8000-0000000000b2';
r := r || 'run1=' || c1::text || '; run2=' || c2::text || '; ';
SELECT count(*) INTO n FROM public.seniors WHERE synthetic_dataset_id='syn-fddedfe343646498'; r := r || 'db_seniors=' || n || '/1; ';
SELECT count(*) INTO n FROM public.observations o JOIN public.seniors s ON s.id=o.senior_id WHERE s.synthetic_dataset_id='syn-fddedfe343646498'; r := r || 'db_obs=' || n || '/39; ';
SELECT count(*) INTO n FROM public.senior_baselines b JOIN public.seniors s ON s.id=b.senior_id WHERE s.synthetic_dataset_id='syn-fddedfe343646498'; r := r || 'db_baselines=' || n || '/6; ';
SELECT count(*) INTO n FROM public.synthetic_ground_truth WHERE dataset_id='syn-fddedfe343646498'; r := r || 'gt=' || n || '/1; ';
SELECT count(*) INTO n FROM public.observations o JOIN public.seniors s ON s.id=o.senior_id WHERE s.synthetic_dataset_id='syn-fddedfe343646498' AND o.recorded_at - o.observed_at > interval '1 hour'; r := r || 'delayed_preserved=' || n || '/3; ';
SELECT count(*) INTO n FROM public.observations o JOIN public.seniors s ON s.id=o.senior_id WHERE s.synthetic_dataset_id='syn-fddedfe343646498' AND o.recorded_by IS NOT NULL; r := r || 'recorded_by_set=' || n || '; ';
SELECT count(*) INTO n FROM public.seniors WHERE synthetic_dataset_id='syn-fddedfe343646498' AND NOT is_synthetic; r := r || 'not_synthetic=' || n || '; ';
SELECT count(*) INTO n FROM public.audit_events WHERE resource_type='synthetic_dataset' AND resource_id='syn-fddedfe343646498'; r := r || 'run_audits=' || n || '; ';
SELECT count(*) INTO n FROM public.seniors WHERE record_code='SYN-0001' AND synthetic_dataset_id IS NULL; r := r || 'unrelated_SYN0001_untouched=' || n || '; ';
-- cross-tenant: existing E2E coordinator (other org) via authenticated role
PERFORM set_config('request.jwt.claims', json_build_object('sub',(SELECT id::text FROM auth.users WHERE email='e2e-coordinator@sahaara.test'),'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT count(*) INTO n FROM public.seniors WHERE synthetic_dataset_id='syn-fddedfe343646498'; r := r || 'other_org_sees=' || n || '; ';
BEGIN PERFORM 1 FROM public.synthetic_ground_truth LIMIT 1; r := r || 'gt_auth=READABLE!; ';
EXCEPTION WHEN insufficient_privilege THEN r := r || 'gt_auth=denied; '; END;
BEGIN PERFORM 1 FROM public.synthetic_datasets LIMIT 1; GET DIAGNOSTICS n = ROW_COUNT; r := r || 'datasets_nonadmin_rows=' || n || '; ';
EXCEPTION WHEN insufficient_privilege THEN r := r || 'datasets_nonadmin=denied; '; END;
BEGIN UPDATE public.seniors SET synthetic_dataset_id = NULL WHERE false; r := r || 'set_dataset_col=ALLOWED!; ';
EXCEPTION WHEN insufficient_privilege THEN r := r || 'set_dataset_col=denied; '; END;
RESET ROLE;
RAISE EXCEPTION 'TEST_RESULTS(rolled back): %', r;
END $t$;