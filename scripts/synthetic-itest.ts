// Builds supabase/tests/synthetic_ingest_phase4.sql: a self-rolling-back DB test of the real ingestion SQL
// (guard, collision, non-TEST org, insert + idempotent rerun, delayed recorded_at, isolation). Run the output via an admin SQL session.
import { writeFileSync } from "node:fs";
import { defaultConfig } from "../src/synthetic/config";
import { generate } from "../src/synthetic/generate";
import { buildSqlBatches } from "../src/synthetic/sql";
import { contentHash } from "../src/synthetic/report";
const ds = generate(defaultConfig({ seniors: 1, days: 7, seed: "itest" }));
const org = "7e570000-0000-4000-8000-0000000000a1";
const sha = contentHash(ds);
const run = (r: string) =>
  buildSqlBatches(ds, {
    orgId: org,
    runId: r,
    manifestSha: sha,
    observationBatchSize: 1000,
    noTransaction: true,
  }).join("\n");
const id = ds.meta.dataset_id;
const delayed = ds.observations.filter(
  (o) => Date.parse(o.recorded_at) - Date.parse(o.observed_at) > 3600000,
).length;
const pre = `SELECT set_config('sahaara.allow_synthetic_write','${id}',true);
INSERT INTO public.organizations(id,name) VALUES ('${org}','TEST — Phase4 rollback itest');`;
const R1 = "7e570000-0000-4000-8000-0000000000b1",
  R2 = "7e570000-0000-4000-8000-0000000000b2";
const checks = `DO $t$ DECLARE r text := ''; c1 jsonb; c2 jsonb; n int; BEGIN
 SELECT counts INTO c1 FROM public.synthetic_ingestion_runs WHERE id='${R1}';
 SELECT counts INTO c2 FROM public.synthetic_ingestion_runs WHERE id='${R2}';
 r := r || 'run1=' || c1::text || '; run2=' || c2::text || '; ';
 SELECT count(*) INTO n FROM public.seniors WHERE synthetic_dataset_id='${id}'; r := r || 'db_seniors=' || n || '/1; ';
 SELECT count(*) INTO n FROM public.observations o JOIN public.seniors s ON s.id=o.senior_id WHERE s.synthetic_dataset_id='${id}'; r := r || 'db_obs=' || n || '/${ds.observations.length}; ';
 SELECT count(*) INTO n FROM public.senior_baselines b JOIN public.seniors s ON s.id=b.senior_id WHERE s.synthetic_dataset_id='${id}'; r := r || 'db_baselines=' || n || '/${ds.baselines.length}; ';
 SELECT count(*) INTO n FROM public.synthetic_ground_truth WHERE dataset_id='${id}'; r := r || 'gt=' || n || '/1; ';
 SELECT count(*) INTO n FROM public.observations o JOIN public.seniors s ON s.id=o.senior_id WHERE s.synthetic_dataset_id='${id}' AND o.recorded_at - o.observed_at > interval '1 hour'; r := r || 'delayed_preserved=' || n || '/${delayed}; ';
 SELECT count(*) INTO n FROM public.observations o JOIN public.seniors s ON s.id=o.senior_id WHERE s.synthetic_dataset_id='${id}' AND o.recorded_by IS NOT NULL; r := r || 'recorded_by_set=' || n || '; ';
 SELECT count(*) INTO n FROM public.seniors WHERE synthetic_dataset_id='${id}' AND NOT is_synthetic; r := r || 'not_synthetic=' || n || '; ';
 SELECT count(*) INTO n FROM public.audit_events WHERE resource_type='synthetic_dataset' AND resource_id='${id}'; r := r || 'run_audits=' || n || '; ';
 SELECT count(*) INTO n FROM public.seniors WHERE record_code='SYN-0001' AND synthetic_dataset_id IS NULL; r := r || 'unrelated_SYN0001_untouched=' || n || '; ';
 -- cross-tenant: existing E2E coordinator (other org) via authenticated role
 PERFORM set_config('request.jwt.claims', json_build_object('sub',(SELECT id::text FROM auth.users WHERE email='e2e-coordinator@sahaara.test'),'role','authenticated')::text, true);
 SET LOCAL ROLE authenticated;
 SELECT count(*) INTO n FROM public.seniors WHERE synthetic_dataset_id='${id}'; r := r || 'other_org_sees=' || n || '; ';
 BEGIN PERFORM 1 FROM public.synthetic_ground_truth LIMIT 1; r := r || 'gt_auth=READABLE!; ';
 EXCEPTION WHEN insufficient_privilege THEN r := r || 'gt_auth=denied; '; END;
 BEGIN PERFORM 1 FROM public.synthetic_datasets LIMIT 1; GET DIAGNOSTICS n = ROW_COUNT; r := r || 'datasets_nonadmin_rows=' || n || '; ';
 EXCEPTION WHEN insufficient_privilege THEN r := r || 'datasets_nonadmin=denied; '; END;
 BEGIN UPDATE public.seniors SET synthetic_dataset_id = NULL WHERE false; r := r || 'set_dataset_col=ALLOWED!; ';
 EXCEPTION WHEN insufficient_privilege THEN r := r || 'set_dataset_col=denied; '; END;
 RESET ROLE;
 RAISE EXCEPTION 'TEST_RESULTS(rolled back): %', r;
END $t$;`;
const body = run("RUNID");
const neg = (
  label: string,
  setup: string,
  expect: string,
) => `BEGIN ${setup} EXECUTE replace(current_setting('sahaara.itest_body'),'RUNID','${R1}'); r := r || '${label}=ALLOWED!; ';
 EXCEPTION WHEN OTHERS THEN r := r || '${label}=' || CASE WHEN SQLERRM LIKE '%${expect}%' THEN 'blocked' ELSE 'other:' || SQLERRM END || '; '; END;`;
const all = `SELECT set_config('sahaara.itest_body', $RUN$${body}$RUN$, true);
DO $all$ DECLARE r text := ''; BEGIN
 INSERT INTO public.organizations(id,name) VALUES ('${org}','TEST — Phase4 rollback itest');
 ${neg("no_guard", "PERFORM set_config('sahaara.allow_synthetic_write','',true);", "guard not satisfied")}
 ${neg("collision", `PERFORM set_config('sahaara.allow_synthetic_write','${id}',true); INSERT INTO public.seniors(id,org_id,record_code,display_name) VALUES ('${ds.seniors[0]!.id}','${org}','REAL-0001','Manually entered person');`, "collides")}
 PERFORM set_config('sahaara.allow_synthetic_write','${id}',true);
 UPDATE public.organizations SET name='Real Care Org itest' WHERE id='${org}';
 ${neg("non_test_org", "", "TEST organisation")}
 UPDATE public.organizations SET name='TEST — Phase4 rollback itest' WHERE id='${org}';
 EXECUTE replace(current_setting('sahaara.itest_body'),'RUNID','${R1}');
 EXECUTE replace(current_setting('sahaara.itest_body'),'RUNID','${R2}');
 RAISE NOTICE 'phase-a %', r;
 PERFORM set_config('sahaara.itest_r', r, true);
END $all$;
`;
writeFileSync(
  "supabase/tests/synthetic_ingest_phase4.sql",
  all +
    checks.replace(
      "DECLARE r text := '';",
      "DECLARE r text := current_setting('sahaara.itest_r');",
    ),
);
const s0 = ds.seniors[0]!;
