-- Phase 3 tenant / senior / observation matrix. Rolls back; any "ALLOWED!" or "LEAK!" is a failure.
DO $$
DECLARE
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  o1 uuid; o2 uuid; s1 uuid; s2 uuid; r text := ''; n int; rid uuid;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) VALUES
   (c1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-c1@test.invalid','{}',now(),now()),
   (c2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-c2@test.invalid','{}',now(),now()),
   (u ,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-u@test.invalid','{}',now(),now());
  INSERT INTO public.organizations(name) VALUES ('TEST Org One') RETURNING id INTO o1;
  INSERT INTO public.organizations(name) VALUES ('TEST Org Two') RETURNING id INTO o2;
  INSERT INTO public.organization_members(user_id, org_id) VALUES (c1,o1),(c2,o2),(u,o1);
  INSERT INTO public.user_roles(user_id, role) VALUES (c1,'coordinator'),(c2,'coordinator');

  -- C1 creates a senior, trying to spoof org and author
  PERFORM set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN INSERT INTO public.seniors(org_id, record_code, display_name) VALUES (o2,'SYN-001','Synthetic A'); r := r||'C1_set_org_column=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'C1_set_org_column=denied('||SQLSTATE||'); '; END;
  BEGIN INSERT INTO public.seniors(record_code, display_name, created_by) VALUES ('SYN-001','Synthetic A',c2); r := r||'C1_spoof_creator=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'C1_spoof_creator=denied('||SQLSTATE||'); '; END;
  INSERT INTO public.seniors(record_code, display_name, is_synthetic) VALUES ('SYN-001','Synthetic A',true) RETURNING id INTO s1;
  r := r||'S1_org_is_C1_org='||((SELECT org_id FROM public.seniors WHERE id=s1)=o1)||'; ';
  r := r||'S1_created_by_C1='||((SELECT created_by FROM public.seniors WHERE id=s1)=c1)||'; ';
  BEGIN INSERT INTO public.seniors(record_code, display_name) VALUES ('SYN-001','Dup'); r := r||'dup_code=ALLOWED!; ';
  EXCEPTION WHEN unique_violation THEN r := r||'dup_code=rejected; '; END;
  BEGIN INSERT INTO public.seniors(record_code, display_name, date_of_birth) VALUES ('SYN-009','Future', current_date+1); r := r||'future_dob=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'future_dob=rejected; '; END;
  BEGIN INSERT INTO public.observations(senior_id,type,value_numeric,unit,observed_at,client_request_id,recorded_by) VALUES (s1,'heart_rate',72,'bpm',now(),gen_random_uuid(),c2); r := r||'spoof_recorder_col=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'spoof_recorder_col=denied('||SQLSTATE||'); '; END;
  rid := gen_random_uuid();
  INSERT INTO public.observations(senior_id,type,value_numeric,unit,observed_at,client_request_id) VALUES (s1,'heart_rate',72,'bpm',now()-interval '2 hours',rid);
  r := r||'obs_recorder_is_C1='||((SELECT recorded_by FROM public.observations WHERE client_request_id=rid)=c1)||'; ';
  r := r||'obs_recorded_after_observed='||((SELECT recorded_at > observed_at FROM public.observations WHERE client_request_id=rid))||'; ';
  BEGIN INSERT INTO public.observations(senior_id,type,value_numeric,unit,observed_at,client_request_id) VALUES (s1,'heart_rate',72,'bpm',now(),rid); r := r||'replay=ALLOWED!; ';
  EXCEPTION WHEN unique_violation THEN r := r||'replay=rejected; '; END;
  BEGIN INSERT INTO public.observations(senior_id,type,value_numeric,unit,observed_at,client_request_id) VALUES (s1,'heart_rate',0,'bpm',now(),gen_random_uuid()); r := r||'hr_zero=ALLOWED!; ';
  EXCEPTION WHEN check_violation THEN r := r||'hr_zero=rejected; '; END;
  BEGIN INSERT INTO public.observations(senior_id,type,value_numeric,unit,observed_at,client_request_id) VALUES (s1,'heart_rate',72,'kg',now(),gen_random_uuid()); r := r||'wrong_unit=ALLOWED!; ';
  EXCEPTION WHEN check_violation THEN r := r||'wrong_unit=rejected; '; END;
  BEGIN INSERT INTO public.observations(senior_id,type,value_numeric,value_numeric_2,unit,observed_at,client_request_id) VALUES (s1,'blood_pressure',80,120,'mmHg',now(),gen_random_uuid()); r := r||'bp_inverted=ALLOWED!; ';
  EXCEPTION WHEN check_violation THEN r := r||'bp_inverted=rejected; '; END;
  BEGIN INSERT INTO public.observations(senior_id,type,observed_at,client_request_id) VALUES (s1,'medication_event',now(),gen_random_uuid()); r := r||'med_no_value=ALLOWED!; ';
  EXCEPTION WHEN check_violation THEN r := r||'med_no_value=rejected; '; END;
  BEGIN INSERT INTO public.observations(senior_id,type,value_numeric,unit,observed_at,client_request_id) VALUES (s1,'weight',70,'kg',now()+interval '1 day',gen_random_uuid()); r := r||'future_obs=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'future_obs=rejected; '; END;
  BEGIN INSERT INTO public.senior_baselines(senior_id,field,status,value_numeric,unit,captured_at) VALUES (s1,'weight','unknown',70,'kg',now()); r := r||'unknown_with_value=ALLOWED!; ';
  EXCEPTION WHEN check_violation THEN r := r||'unknown_with_value=rejected; '; END;
  INSERT INTO public.senior_baselines(senior_id,field,status,captured_at) VALUES (s1,'hearing','unknown',now());
  BEGIN UPDATE public.observations SET value_numeric=99 WHERE senior_id=s1; r := r||'obs_update=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'obs_update=denied('||SQLSTATE||'); '; END;
  BEGIN DELETE FROM public.observations WHERE senior_id=s1; r := r||'obs_delete=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'obs_delete=denied('||SQLSTATE||'); '; END;
  BEGIN UPDATE public.seniors SET record_code='X-1' WHERE id=s1; r := r||'edit_code=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'edit_code=denied('||SQLSTATE||'); '; END;
  UPDATE public.seniors SET care_status='paused' WHERE id=s1 AND version=1; GET DIAGNOSTICS n=ROW_COUNT;
  r := r||'C1_update_v1_rows='||n||'; ';
  UPDATE public.seniors SET care_status='active' WHERE id=s1 AND version=1; GET DIAGNOSTICS n=ROW_COUNT;
  r := r||'stale_version_rows='||n||'; ';

  -- C2 (other org) tries everything on s1
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',c2,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := r||'C2_sees_s1='||(SELECT count(*) FROM public.seniors WHERE id=s1)||'; ';
  r := r||'C2_sees_s1_obs='||(SELECT count(*) FROM public.observations WHERE senior_id=s1)||'; ';
  r := r||'C2_latest_rpc='||(SELECT count(*) FROM public.latest_observations(s1))||'; ';
  r := r||'C2_baselines='||(SELECT count(*) FROM public.current_baselines(s1))||'; ';
  r := r||'C2_can_access_senior='||public.can_access_senior(s1)||'; ';
  BEGIN INSERT INTO public.observations(senior_id,type,value_numeric,unit,observed_at,client_request_id) VALUES (s1,'heart_rate',70,'bpm',now(),gen_random_uuid()); r := r||'C2_obs_on_s1=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'C2_obs_on_s1=denied('||SQLSTATE||'); '; END;
  UPDATE public.seniors SET display_name='Hijack' WHERE id=s1; GET DIAGNOSTICS n=ROW_COUNT; r := r||'C2_update_s1_rows='||n||'; ';
  INSERT INTO public.seniors(record_code, display_name, is_synthetic) VALUES ('SYN-001','Synthetic B',true) RETURNING id INTO s2;
  r := r||'same_code_other_org=ok; C2_directory='||(SELECT count(*) FROM public.seniors)||'; ';
  r := r||'C2_profile_names_of_C1='||(SELECT count(*) FROM public.profile_names(ARRAY[c1]))||'; ';

  -- U: same org, no role
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := r||'U_directory='||(SELECT count(*) FROM public.seniors)||'; ';
  BEGIN INSERT INTO public.seniors(record_code, display_name) VALUES ('SYN-777','Nope'); r := r||'U_create=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'U_create=denied('||SQLSTATE||'); '; END;
  BEGIN PERFORM public.admin_set_membership(u, o2); r := r||'U_change_own_org=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'U_change_own_org=denied; '; END;
  BEGIN PERFORM public.admin_create_org('Evil'); r := r||'U_create_org=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'U_create_org=denied; '; END;
  BEGIN INSERT INTO public.organization_members(user_id, org_id) VALUES (u,o2); r := r||'U_direct_membership=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'U_direct_membership=denied('||SQLSTATE||'); '; END;

  RESET ROLE; SET LOCAL ROLE anon;
  BEGIN PERFORM count(*) FROM public.seniors; r := r||'anon_seniors=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'anon_seniors=denied('||SQLSTATE||'); '; END;

  RESET ROLE;
  r := r||'audit='||(SELECT string_agg(action, ',' ORDER BY id) FROM public.audit_events WHERE actor_id IN (c1,c2))||'; ';
  RAISE EXCEPTION 'TEST_RESULTS(rolled back): %', r;
END $$;
