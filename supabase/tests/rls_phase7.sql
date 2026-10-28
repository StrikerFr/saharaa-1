-- Phase 7 care-report matrix. Rolls back; any "ALLOWED!" or "LEAK!" or "DUP!" is a failure.
DO $$
DECLARE
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  o1 uuid; o2 uuid; s1 uuid; s2 uuid; rep uuid; cue uuid; obs1 uuid; obs2 uuid; r text := ''; n int;
  cues jsonb := '[{"cueType":"appetite","description":"Eating less","evidenceText":"kam kha rahi","polarity":"positive","temporality":"current","certainty":"stated","speaker":"third_party","reportedTimeText":null,"statedMeasurement":null,"categoryValue":"reduced","limitations":[]}]';
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) VALUES
   (c1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','t7-c1@test.invalid','{}',now(),now()),
   (c2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','t7-c2@test.invalid','{}',now(),now());
  INSERT INTO public.organizations(name) VALUES ('TEST P7 One') RETURNING id INTO o1;
  INSERT INTO public.organizations(name) VALUES ('TEST P7 Two') RETURNING id INTO o2;
  INSERT INTO public.organization_members(user_id, org_id) VALUES (c1,o1),(c2,o2);
  INSERT INTO public.user_roles(user_id, role) VALUES (c1,'coordinator'),(c2,'coordinator');
  INSERT INTO public.seniors(org_id, record_code, display_name, is_synthetic) VALUES (o1,'P7-001','Synthetic P7 A',true) RETURNING id INTO s1;
  INSERT INTO public.seniors(org_id, record_code, display_name, is_synthetic) VALUES (o2,'P7-002','Synthetic P7 B',true) RETURNING id INTO s2;

  PERFORM set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  rep := public.submit_text_report(s1, 'Synthetic: kam kha rahi hain', 'family', 'hinglish', NULL, gen_random_uuid());
  r := r||'submit=ok; ';
  BEGIN PERFORM public.submit_text_report(s2, 'x x x', 'family', 'en', NULL, gen_random_uuid()); r := r||'cross_submit=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'cross_submit=denied; '; END;
  BEGIN PERFORM public.record_report_extraction(c1, rep, cues, 'cues.v1', 'm', false); r := r||'client_extraction=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'client_extraction=denied; '; END;
  BEGIN UPDATE public.care_reports SET original_text = 'forged' WHERE id = rep; GET DIAGNOSTICS n = ROW_COUNT;
    r := r || CASE WHEN n > 0 THEN 'direct_update=ALLOWED!; ' ELSE 'direct_update=denied; ' END;
  EXCEPTION WHEN others THEN r := r||'direct_update=denied; '; END;
  RESET ROLE;

  -- Server writes cues for c1 (service path); a foreign actor is refused.
  BEGIN PERFORM public.record_report_extraction(c2, rep, cues, 'cues.v1', 'm', false); r := r||'foreign_actor=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'foreign_actor=denied; '; END;
  PERFORM public.record_report_extraction(c1, rep, cues, 'cues.v1', 'm', false);
  SELECT id INTO cue FROM public.report_cues WHERE report_id = rep;

  -- c2 cannot read or confirm c1's cue.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',c2,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.care_reports WHERE id = rep; r := r || CASE WHEN n > 0 THEN 'cross_read=LEAK!; ' ELSE 'cross_read=denied; ' END;
  BEGIN PERFORM public.confirm_report_cue(cue, 'appetite', NULL, NULL, 'reduced', NULL, NULL, now(), 'reported_by_family', ''); r := r||'cross_confirm=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'cross_confirm=denied; '; END;
  RESET ROLE;

  -- c1 confirms twice: exactly one observation.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  obs1 := public.confirm_report_cue(cue, 'appetite', NULL, NULL, 'reduced', NULL, 'n', now(), 'reported_by_family', '');
  obs2 := public.confirm_report_cue(cue, 'appetite', NULL, NULL, 'reduced', NULL, 'n', now(), 'reported_by_family', '');
  SELECT count(*) INTO n FROM public.observations WHERE client_request_id = cue;
  r := r || CASE WHEN n = 1 AND obs1 = obs2 THEN 'idempotent_confirm=ok; ' ELSE 'idempotent_confirm=DUP!; ' END;
  BEGIN PERFORM public.reject_report_cue(cue, 'x'); r := r||'reject_confirmed=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'reject_confirmed=denied; '; END;
  RESET ROLE;
  -- Audit is admin-only to read, so check it with the privileged session.
  SELECT count(*) INTO n FROM public.audit_events WHERE action = 'report_cue.confirmed' AND resource_id = cue::text;
  r := r || CASE WHEN n = 1 THEN 'audit=ok; ' ELSE 'audit=MISSING!; ' END;

  SET LOCAL ROLE anon;
  BEGIN SELECT count(*) INTO n FROM public.care_reports; r := r||'anon_read=LEAK!; ';
  EXCEPTION WHEN others THEN r := r||'anon_read=denied; '; END;
  RESET ROLE;
  RAISE EXCEPTION 'TEST_RESULTS(rolled back): %', r;
END $$;
