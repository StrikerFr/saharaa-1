-- Sahaara RLS / privilege-escalation matrix.
-- Creates throwaway users, exercises policies AS those users (not service role),
-- then RAISEs so the whole transaction rolls back. Read results from the error text.
-- Any "ALLOWED!" in the output is a failure.
DO $$
DECLARE
  a uuid := gen_random_uuid(); u uuid := gen_random_uuid(); v uuid := gen_random_uuid();
  r text := ''; n int; cid uuid;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-admin@test.invalid','{"display_name":"Admin T"}',now(),now()),
         (u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-user@test.invalid','{}',now(),now()),
         (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-victim@test.invalid','{}',now(),now());
  INSERT INTO public.user_roles(user_id, role) VALUES (a,'admin');
  r := r || 'profiles_auto=' || (SELECT count(*) FROM public.profiles WHERE id IN (a,u,v)) || '; ';

  PERFORM set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := r || 'U_sees_profiles=' || (SELECT count(*) FROM public.profiles) || '; ';
  r := r || 'U_sees_roles=' || (SELECT count(*) FROM public.user_roles) || '; ';
  r := r || 'U_sees_audit=' || (SELECT count(*) FROM public.audit_events) || '; ';
  BEGIN INSERT INTO public.user_roles(user_id, role) VALUES (u,'admin'); r := r || 'U_self_admin_insert=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r || 'U_self_admin_insert=denied('||SQLSTATE||'); '; END;
  BEGIN PERFORM public.admin_set_role(u,'admin',true); r := r || 'U_rpc_self_admin=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r || 'U_rpc_self_admin=denied('||SQLERRM||'); '; END;
  BEGIN PERFORM public.admin_set_role(v,'coordinator',true); r := r || 'U_rpc_role_victim=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r || 'U_rpc_role_victim=denied; '; END;
  BEGIN UPDATE public.profiles SET display_name='hacked' WHERE id=v; GET DIAGNOSTICS n = ROW_COUNT; r := r || 'U_edit_victim_rows=' || n || '; ';
  EXCEPTION WHEN others THEN r := r || 'U_edit_victim=denied; '; END;
  BEGIN UPDATE public.profiles SET account_status='active' WHERE id=u; r := r || 'U_edit_status=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r || 'U_edit_status=denied('||SQLSTATE||'); '; END;
  UPDATE public.profiles SET display_name='Me' WHERE id=u; GET DIAGNOSTICS n = ROW_COUNT; r := r || 'U_edit_own_name_rows=' || n || '; ';
  BEGIN INSERT INTO public.profiles(id) VALUES (gen_random_uuid()); r := r || 'U_insert_profile=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r || 'U_insert_profile=denied('||SQLSTATE||'); '; END;
  BEGIN DELETE FROM public.profiles WHERE id=u; r := r || 'U_delete_profile=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r || 'U_delete_profile=denied('||SQLSTATE||'); '; END;
  BEGIN INSERT INTO public.audit_events(actor_id,action,resource_type,outcome) VALUES (v,'x.y','z','success'); r := r || 'U_forge_audit=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r || 'U_forge_audit=denied('||SQLSTATE||'); '; END;
  BEGIN PERFORM public.write_audit(v,'x.y','z',null,'success','{}'); r := r || 'U_call_write_audit=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r || 'U_call_write_audit=denied('||SQLSTATE||'); '; END;
  BEGIN PERFORM public.grant_consent(v,'care_team',null,'care_coordination','alerts'); r := r || 'U_consent_for_victim=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r || 'U_consent_for_victim=denied; '; END;
  BEGIN INSERT INTO public.consent_records(subject_id,recorded_by,recipient_category,purpose,scope) VALUES (u,u,'care_team','care_coordination','alerts'); r := r || 'U_direct_consent_insert=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r || 'U_direct_consent_insert=denied('||SQLSTATE||'); '; END;
  BEGIN PERFORM public.grant_consent(u,'family_member',null,'family_updates','alerts'); r := r || 'U_family_without_recipient=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r || 'U_family_without_recipient=rejected; '; END;
  cid := public.grant_consent(u,'care_team',null,'care_coordination','alerts');
  r := r || 'U_own_consent=ok; U_sees_consents=' || (SELECT count(*) FROM public.consent_records) || '; ';
  BEGIN UPDATE public.consent_records SET status='withdrawn' WHERE id=cid; r := r || 'U_direct_consent_update=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r || 'U_direct_consent_update=denied('||SQLSTATE||'); '; END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := r || 'V_sees_U_consent=' || (SELECT count(*) FROM public.consent_records WHERE id=cid) || '; ';
  BEGIN PERFORM public.withdraw_consent(cid); r := r || 'V_withdraw_U=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r || 'V_withdraw_U=denied; '; END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.withdraw_consent(cid);
  r := r || 'U_withdraw_own=' || (SELECT status FROM public.consent_records WHERE id=cid) || '; ';

  RESET ROLE; SET LOCAL ROLE anon;
  BEGIN PERFORM count(*) FROM public.profiles; r := r || 'anon_profiles=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r || 'anon_profiles=denied('||SQLSTATE||'); '; END;
  BEGIN PERFORM public.my_roles(); r := r || 'anon_rpc=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r || 'anon_rpc=denied('||SQLSTATE||'); '; END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := r || 'A_sees_all_profiles=' || ((SELECT count(*) FROM public.profiles WHERE id IN (a,u,v)) = 3) || '; ';
  PERFORM public.admin_set_role(u,'coordinator',true);
  r := r || 'A_granted_coord=' || (SELECT count(*) FROM public.user_roles WHERE user_id=u AND role='coordinator') || '; ';
  BEGIN PERFORM public.admin_set_role(a,'admin',false); r := r || 'A_remove_own_admin=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r || 'A_remove_own_admin=denied; '; END;
  r := r || 'audit=' || (SELECT string_agg(action||':'||outcome, ',' ORDER BY id) FROM public.audit_events WHERE actor_id IN (a,u,v)) || '; ';
  RESET ROLE;
  BEGIN UPDATE public.audit_events SET outcome='success' WHERE actor_id=u; r := r || 'owner_audit_update=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r || 'owner_audit_update=blocked; '; END;

  RAISE EXCEPTION 'TEST_RESULTS(rolled back): %', r;
END $$;
