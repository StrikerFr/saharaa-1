-- Phase 5 risk-assessment matrix. Rolls back; any "ALLOWED!" or "LEAK!" is a failure.
DO $$
DECLARE
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  o1 uuid; o2 uuid; s1 uuid; s2 uuid; a1 uuid; r text := ''; n int;
  res jsonb := '{"schemaVersion":"1"}'::jsonb;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) VALUES
   (c1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','t5-c1@test.invalid','{}',now(),now()),
   (c2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','t5-c2@test.invalid','{}',now(),now()),
   (u ,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','t5-u@test.invalid','{}',now(),now());
  INSERT INTO public.organizations(name) VALUES ('TEST P5 One') RETURNING id INTO o1;
  INSERT INTO public.organizations(name) VALUES ('TEST P5 Two') RETURNING id INTO o2;
  INSERT INTO public.organization_members(user_id, org_id) VALUES (c1,o1),(c2,o2),(u,o1);
  INSERT INTO public.user_roles(user_id, role) VALUES (c1,'coordinator'),(c2,'coordinator');
  INSERT INTO public.seniors(org_id, record_code, display_name, is_synthetic) VALUES (o1,'P5-001','Synthetic P5 A',true) RETURNING id INTO s1;
  INSERT INTO public.seniors(org_id, record_code, display_name, is_synthetic) VALUES (o2,'P5-002','Synthetic P5 B',true) RETURNING id INTO s2;

  -- Privileged (server) inserts: valid author OK; org forced from senior; foreign/no-role author refused.
  INSERT INTO public.risk_assessments(senior_id, org_id, reference_time, engine_version, ruleset_version, config_fingerprint, input_digest, priority, data_quality, result, created_by)
    VALUES (s1, o2, now(), 'e', 'r', 'cfg-0123456789abcdef', 'in-0123456789abcdef', 'review_suggested', 'limited', res, c1) RETURNING id INTO a1;
  r := r||'org_forced_from_senior='||((SELECT org_id FROM public.risk_assessments WHERE id=a1)=o1)||'; ';
  r := r||'audit_written='||(EXISTS(SELECT 1 FROM public.audit_events WHERE resource_id=a1::text AND action='risk_assessment.created' AND actor_id=c1))||'; ';
  BEGIN INSERT INTO public.risk_assessments(senior_id, org_id, reference_time, engine_version, ruleset_version, config_fingerprint, input_digest, priority, data_quality, result, created_by)
    VALUES (s1, o1, now(), 'e', 'r', 'cfg-0123456789abcdef', 'in-0123456789abcdef', 'review_suggested', 'limited', res, c2); r := r||'cross_tenant_author=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'cross_tenant_author=denied('||SQLSTATE||'); '; END;
  BEGIN INSERT INTO public.risk_assessments(senior_id, org_id, reference_time, engine_version, ruleset_version, config_fingerprint, input_digest, priority, data_quality, result, created_by)
    VALUES (s1, o1, now(), 'e', 'r', 'cfg-0123456789abcdef', 'in-0123456789abcdef', 'review_suggested', 'limited', res, u); r := r||'no_role_author=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'no_role_author=denied('||SQLSTATE||'); '; END;
  BEGIN INSERT INTO public.risk_assessments(senior_id, org_id, reference_time, engine_version, ruleset_version, config_fingerprint, input_digest, priority, data_quality, result, created_by)
    VALUES (s1, o1, now()+interval '1 day', 'e', 'r', 'cfg-0123456789abcdef', 'in-0123456789abcdef', 'review_suggested', 'limited', res, c1); r := r||'future_reference=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'future_reference=rejected; '; END;
  BEGIN INSERT INTO public.risk_assessments(senior_id, org_id, reference_time, engine_version, ruleset_version, config_fingerprint, input_digest, priority, data_quality, result, created_by)
    VALUES (s1, o1, now(), 'e', 'r', 'cfg-0123456789abcdef', 'in-0123456789abcdef', 'healthy', 'limited', res, c1); r := r||'bad_priority=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'bad_priority=rejected; '; END;
  BEGIN UPDATE public.risk_assessments SET priority='no_signal_detected' WHERE id=a1; r := r||'privileged_update=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'privileged_update=blocked; '; END;
  BEGIN DELETE FROM public.risk_assessments WHERE id=a1; r := r||'privileged_delete=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'privileged_delete=blocked; '; END;

  -- C1 (same org coordinator)
  PERFORM set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.risk_assessments; r := r||'C1_reads_own_org='||n||'; ';
  BEGIN INSERT INTO public.risk_assessments(senior_id, org_id, reference_time, engine_version, ruleset_version, config_fingerprint, input_digest, priority, data_quality, result, created_by)
    VALUES (s1, o1, now(), 'e', 'r', 'cfg-0123456789abcdef', 'in-0123456789abcdef', 'no_signal_detected', 'adequate', res, c1); r := r||'C1_client_insert=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'C1_client_insert=denied('||SQLSTATE||'); '; END;
  BEGIN UPDATE public.risk_assessments SET priority='no_signal_detected' WHERE id=a1;
    GET DIAGNOSTICS n = ROW_COUNT; r := r||CASE WHEN n>0 THEN 'C1_update=ALLOWED!; ' ELSE 'C1_update=0rows; ' END;
  EXCEPTION WHEN others THEN r := r||'C1_update=denied('||SQLSTATE||'); '; END;
  BEGIN SELECT count(*) INTO n FROM public.synthetic_ground_truth; r := r||'C1_ground_truth=LEAK!; ';
  EXCEPTION WHEN others THEN r := r||'C1_ground_truth=denied('||SQLSTATE||'); '; END;
  PERFORM public.log_risk_assessment_denied(s2);
  RESET ROLE;
  r := r||'denial_logged_as_C1='||(EXISTS(SELECT 1 FROM public.audit_events WHERE actor_id=c1 AND action='risk_assessment.create' AND outcome='denied' AND resource_id=s2::text))||'; ';

  -- C2 (other org) and U (no role)
  PERFORM set_config('request.jwt.claims', json_build_object('sub',c2,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.risk_assessments WHERE senior_id=s1; r := r||CASE WHEN n>0 THEN 'C2_cross_tenant=LEAK!; ' ELSE 'C2_cross_tenant=0; ' END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.risk_assessments; r := r||CASE WHEN n>0 THEN 'U_no_role=LEAK!; ' ELSE 'U_no_role=0; ' END;
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN SELECT count(*) INTO n FROM public.risk_assessments; r := r||'anon_read=LEAK!; ';
  EXCEPTION WHEN others THEN r := r||'anon_read=denied('||SQLSTATE||'); '; END;
  BEGIN PERFORM public.log_risk_assessment_denied(s1); r := r||'anon_log=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'anon_log=denied('||SQLSTATE||'); '; END;
  RESET ROLE;

  RAISE EXCEPTION 'TEST_RESULTS(rolled back): %', r;
END $$;
