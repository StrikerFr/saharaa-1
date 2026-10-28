// Ingestion SQL emitter. Produces ordered batch files, each its own transaction and idempotent
// (ON CONFLICT DO NOTHING on stable ids). Every batch re-checks the explicit write guard.
import type { Dataset } from "./generate";

const q = (v: string | number | null | boolean): string => {
  if (v === null) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite number");
    return String(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return `'${v.replace(/'/g, "''")}'`;
};

export interface SqlOptions {
  /** Target organisation id. Its name must start with "TEST" (checked in SQL). */
  orgId: string;
  runId: string;
  manifestSha: string;
  observationBatchSize?: number;
  /** Omit BEGIN/COMMIT (for wrapping inside a test transaction). */
  noTransaction?: boolean;
}

function guard(dsId: string, orgId: string): string {
  return `DO $g$ BEGIN
  IF current_setting('sahaara.allow_synthetic_write', true) IS DISTINCT FROM ${q(dsId)} THEN
    RAISE EXCEPTION 'synthetic write guard not satisfied: set sahaara.allow_synthetic_write to the dataset id';
  END IF;
  IF auth.uid() IS NOT NULL OR current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'synthetic ingestion requires a privileged operator session';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = ${q(orgId)}::uuid AND name LIKE 'TEST%') THEN
    RAISE EXCEPTION 'target organisation must exist and be a TEST organisation';
  END IF;
END $g$;
SELECT set_config('sahaara.synthetic_ingest', ${q(dsId)}, true);`;
}

function counter(runId: string, key: string, total: number): string {
  return `GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.synthetic_ingestion_runs SET counts = counts || jsonb_build_object(
    '${key}_inserted', COALESCE((counts->>'${key}_inserted')::int, 0) + n,
    '${key}_skipped', COALESCE((counts->>'${key}_skipped')::int, 0) + (${total} - n))
  WHERE id = ${q(runId)}::uuid;`;
}

export function buildSqlBatches(ds: Dataset, o: SqlOptions): string[] {
  const id = ds.meta.dataset_id;
  const wrap = (body: string) =>
    o.noTransaction
      ? `${guard(id, o.orgId)}\n${body}`
      : `BEGIN;\n${guard(id, o.orgId)}\n${body}\nCOMMIT;`;
  const batches: string[] = [];

  const seniorRows = ds.seniors
    .map(
      (s) =>
        `(${[s.id, o.orgId, s.record_code, s.display_name, s.date_of_birth, s.preferred_language, s.time_zone, s.care_status, s.care_context].map(q).join(",")},true,${q(id)})`,
    )
    .join(",\n");
  const seniorIds = ds.seniors.map((s) => q(s.id)).join(",");
  const baselineRows = ds.baselines
    .map(
      (b) =>
        `(${[b.id, b.senior_id, b.field, b.status, b.value_numeric, b.value_numeric_2, b.value_text, b.unit, b.captured_at, b.recorded_at, b.source, b.verification].map(q).join(",")})`,
    )
    .join(",\n");
  const gtRows = ds.groundTruth
    .map(
      (g) =>
        `(${q(id)},${q(g.senior_id)},${q(g.scenario)},${q(g.onset_day)},${q(g.duration_days)},ARRAY[${g.affected_types.map(q).join(",")}]::text[],${q(JSON.stringify(g.details))}::jsonb)`,
    )
    .join(",\n");

  batches.push(
    wrap(`INSERT INTO public.synthetic_datasets (id, generator_version, seed, reference_date, org_id, config, manifest_sha256)
VALUES (${q(id)}, ${q(ds.meta.generator_version)}, ${q(ds.meta.seed)}, ${q(ds.meta.reference_date)}, ${q(o.orgId)}, ${q(JSON.stringify(ds.meta.config))}::jsonb, ${q(o.manifestSha)})
ON CONFLICT (id) DO NOTHING;
DO $c$ BEGIN
  IF (SELECT manifest_sha256 FROM public.synthetic_datasets WHERE id = ${q(id)}) <> ${q(o.manifestSha)} THEN
    RAISE EXCEPTION 'dataset id already exists with different content; refusing to mix datasets';
  END IF;
  IF (SELECT org_id FROM public.synthetic_datasets WHERE id = ${q(id)}) <> ${q(o.orgId)}::uuid THEN
    RAISE EXCEPTION 'dataset already ingested into a different organisation';
  END IF;
END $c$;
INSERT INTO public.synthetic_ingestion_runs (id, dataset_id, status) VALUES (${q(o.runId)}, ${q(id)}, 'running') ON CONFLICT (id) DO NOTHING;
DO $b$ DECLARE n int; BEGIN
  INSERT INTO public.seniors (id, org_id, record_code, display_name, date_of_birth, preferred_language, time_zone, care_status, care_context, is_synthetic, synthetic_dataset_id)
  VALUES ${seniorRows}
  ON CONFLICT DO NOTHING;
  ${counter(o.runId, "seniors", ds.seniors.length)}
  -- Ownership check: every id must now belong to this dataset (never touch unrelated rows).
  IF (SELECT count(*) FROM public.seniors WHERE id IN (${seniorIds}) AND synthetic_dataset_id = ${q(id)}) <> ${ds.seniors.length} THEN
    RAISE EXCEPTION 'senior id or record code collides with a record outside this dataset';
  END IF;
  INSERT INTO public.senior_baselines (id, senior_id, field, status, value_numeric, value_numeric_2, value_text, unit, captured_at, recorded_at, source, verification)
  VALUES ${baselineRows}
  ON CONFLICT DO NOTHING;
  ${counter(o.runId, "baselines", ds.baselines.length)}
  INSERT INTO public.synthetic_ground_truth (dataset_id, senior_id, scenario, onset_day, duration_days, affected_types, details)
  VALUES ${gtRows}
  ON CONFLICT DO NOTHING;
END $b$;`),
  );

  const size = o.observationBatchSize ?? 5000;
  for (let i = 0; i < ds.observations.length; i += size) {
    const chunk = ds.observations.slice(i, i + size);
    const rows = chunk
      .map(
        (x) =>
          `(${[x.id, x.client_request_id, x.senior_id, x.type, x.value_numeric, x.value_numeric_2, x.value_text, x.unit, x.note, x.observed_at, x.recorded_at, x.source, x.verification].map(q).join(",")})`,
      )
      .join(",\n");
    batches.push(
      wrap(`DO $o$ DECLARE n int; BEGIN
  INSERT INTO public.observations (id, client_request_id, senior_id, type, value_numeric, value_numeric_2, value_text, unit, note, observed_at, recorded_at, source, verification)
  SELECT v.id::uuid, v.req::uuid, v.sid::uuid, v.t::observation_type, v.n1::numeric, v.n2::numeric, v.vt, v.u, v.note, v.oa::timestamptz, v.ra::timestamptz, v.src::data_source, v.ver::verification_status
  FROM (VALUES ${rows}) AS v(id, req, sid, t, n1, n2, vt, u, note, oa, ra, src, ver)
  JOIN public.seniors s ON s.id = v.sid::uuid AND s.synthetic_dataset_id = ${q(id)}
  ON CONFLICT DO NOTHING;
  ${counter(o.runId, "observations", chunk.length)}
END $o$;`),
    );
  }

  batches.push(
    wrap(`UPDATE public.synthetic_ingestion_runs SET status = 'completed', finished_at = now(),
  counts = counts || jsonb_build_object(
    'db_seniors', (SELECT count(*) FROM public.seniors WHERE synthetic_dataset_id = ${q(id)}),
    'db_observations', (SELECT count(*) FROM public.observations ob JOIN public.seniors s ON s.id = ob.senior_id WHERE s.synthetic_dataset_id = ${q(id)}),
    'expected_observations', ${ds.observations.length})
WHERE id = ${q(o.runId)}::uuid;
SELECT public.write_audit(NULL, 'synthetic.ingested', 'synthetic_dataset', ${q(id)}, 'success', jsonb_build_object('run_id', ${q(o.runId)}));`),
  );
  return batches;
}
