-- Phase 6 review-case and follow-up-task matrix. Rolls back; any "ALLOWED!" or "LEAK!" is a failure.
-- Covers: one active case per senior, validated transitions, required reasons,
-- assignee scope, cross-tenant denial, append-only history, and audit writes.
DO $$
DECLARE
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  o1 uuid; o2 uuid; s1 uuid; s2 uuid; a1 uuid; a2 uuid;
  case1 uuid; task1 uuid; r text := ''; n int;
  res jsonb := '{"schemaVersion":"1"}'::jsonb;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) VALUES
   (c1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','t6-c1@test.invalid','{}',now(),now()),
   (c2,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','t6-c2@test.invalid','{}',now(),now()),
   (u ,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','t6-u@test.invalid','{}',now(),now());
  INSERT INTO public.organizations(name) VALUES ('TEST P6 One') RETURNING id INTO o1;
  INSERT INTO public.organizations(name) VALUES ('TEST P6 Two') RETURNING id INTO o2;
  INSERT INTO public.organization_members(user_id, org_id) VALUES (c1,o1),(c2,o2),(u,o1);
  INSERT INTO public.user_roles(user_id, role) VALUES (c1,'coordinator'),(c2,'coordinator');
  INSERT INTO public.seniors(org_id, record_code, display_name, is_synthetic) VALUES (o1,'P6-001','Synthetic P6 A',true) RETURNING id INTO s1;
  INSERT INTO public.seniors(org_id, record_code, display_name, is_synthetic) VALUES (o2,'P6-002','Synthetic P6 B',true) RETURNING id INTO s2;
  INSERT INTO public.risk_assessments(senior_id, org_id, reference_time, engine_version, ruleset_version, config_fingerprint, input_digest, priority, data_quality, result, created_by)
    VALUES (s1, o1, now(), 'e', 'r', 'cfg-0123456789abcdef', 'in-0123456789abcdef', 'review_recommended', 'adequate', res, c1) RETURNING id INTO a1;
  INSERT INTO public.risk_assessments(senior_id, org_id, reference_time, engine_version, ruleset_version, config_fingerprint, input_digest, priority, data_quality, result, created_by)
    VALUES (s2, o2, now(), 'e', 'r', 'cfg-0123456789abcdef', 'in-0123456789abcdef', 'review_suggested', 'adequate', res, c2) RETURNING id INTO a2;

  -- ===== C1 (coordinator, org 1) =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Open a case: allowed, audited, history row written.
  SELECT public.open_review_case(s1, a1) INTO case1;
  r := r||'C1_open_case='||(case1 IS NOT NULL)||'; ';
  r := r||'open_audited='||(EXISTS(SELECT 1 FROM public.audit_events WHERE action='review_case.opened' AND resource_id=case1::text AND actor_id=c1))||'; ';
  r := r||'open_event='||(EXISTS(SELECT 1 FROM public.review_case_events WHERE case_id=case1 AND from_status IS NULL AND to_status='needs_review'))||'; ';

  -- Idempotent reopen returns the same case (no duplicate active case).
  r := r||'reopen_idempotent='||(public.open_review_case(s1, a1)=case1)||'; ';

  -- Assessment from another tenant's senior cannot open a case here.
  BEGIN PERFORM public.open_review_case(s1, a2); r := r||'cross_assessment=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'cross_assessment=denied('||SQLSTATE||'); '; END;

  -- Invalid transition: needs_review -> resolved is not permitted.
  BEGIN PERFORM public.transition_review_case(case1, 'resolved', 'done'); r := r||'skip_transition=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'skip_transition=denied; '; END;

  -- Valid transitions; dismissal without a reason is refused.
  PERFORM public.transition_review_case(case1, 'in_review', NULL);
  BEGIN PERFORM public.transition_review_case(case1, 'dismissed', NULL); r := r||'dismiss_no_reason=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'dismiss_no_reason=denied; '; END;
  BEGIN PERFORM public.transition_review_case(case1, 'resolved', NULL); r := r||'resolve_no_outcome=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'resolve_no_outcome=denied; '; END;
  PERFORM public.transition_review_case(case1, 'follow_up_required', NULL);
  PERFORM public.transition_review_case(case1, 'resolved', 'Family visited; doing well.');
  r := r||'resolved='||(EXISTS(SELECT 1 FROM public.review_cases WHERE id=case1 AND status='resolved'))||'; ';
  r := r||'resolve_audited='||(EXISTS(SELECT 1 FROM public.audit_events WHERE action='review_case.resolved' AND resource_id=case1::text))||'; ';

  -- Closed cases are terminal.
  BEGIN PERFORM public.transition_review_case(case1, 'in_review', NULL); r := r||'reopen_closed=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'reopen_closed=denied; '; END;

  -- A new case can open after the old one closed (history preserved).
  r := r||'new_case_after_close='||(public.open_review_case(s1, a1)<>case1)||'; ';

  -- Assignee must be a coordinator/admin in the same org.
  BEGIN PERFORM public.assign_review_case(case1, c2); r := r||'cross_tenant_assignee=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'cross_tenant_assignee=denied; '; END;
  BEGIN PERFORM public.assign_review_case(case1, u); r := r||'no_role_assignee=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'no_role_assignee=denied; '; END;
  PERFORM public.assign_review_case(case1, c1);
  r := r||'self_assign_ok='||(EXISTS(SELECT 1 FROM public.review_cases WHERE id=case1 AND assigned_to=c1))||'; ';
  SELECT count(*) INTO n FROM public.org_assignees();
  r := r||'C1_assignees='||n||'; ';

  -- Tasks: create, invalid assignee, completion requires an outcome.
  SELECT public.create_follow_up_task(s1, 'Call family', NULL, case1, c1, now()+interval '1 day') INTO task1;
  r := r||'task_created='||(task1 IS NOT NULL)||'; ';
  r := r||'task_audited='||(EXISTS(SELECT 1 FROM public.audit_events WHERE action='follow_up_task.created' AND resource_id=task1::text))||'; ';
  BEGIN PERFORM public.create_follow_up_task(s1, 'Bad assignee', NULL, NULL, c2, NULL); r := r||'task_cross_assignee=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'task_cross_assignee=denied; '; END;
  BEGIN PERFORM public.transition_follow_up_task(task1, 'completed', NULL); r := r||'complete_no_outcome=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'complete_no_outcome=denied; '; END;
  PERFORM public.transition_follow_up_task(task1, 'in_progress', NULL);
  PERFORM public.transition_follow_up_task(task1, 'completed', 'Spoke with family; all well.');
  r := r||'task_completed='||(EXISTS(SELECT 1 FROM public.follow_up_tasks WHERE id=task1 AND status='completed' AND completed_at IS NOT NULL))||'; ';
  -- Completing the task must not close the case.
  r := r||'case_still_open_after_task='||(EXISTS(SELECT 1 FROM public.review_cases WHERE senior_id=s1 AND status IN ('needs_review','in_review','follow_up_required')))||'; ';

  -- Direct table writes are not granted to authenticated clients.
  BEGIN INSERT INTO public.review_cases(senior_id, org_id, priority_at_open, opened_by_assessment_id, latest_assessment_id, opened_by)
    VALUES (s1, o1, 'review_suggested', a1, a1, c1); r := r||'C1_direct_case_insert=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'C1_direct_case_insert=denied('||SQLSTATE||'); '; END;
  BEGIN UPDATE public.follow_up_tasks SET status='completed' WHERE id=task1;
    GET DIAGNOSTICS n = ROW_COUNT; r := r||CASE WHEN n>0 THEN 'C1_direct_task_update=ALLOWED!; ' ELSE 'C1_direct_task_update=0rows; ' END;
  EXCEPTION WHEN others THEN r := r||'C1_direct_task_update=denied('||SQLSTATE||'); '; END;

  -- History tables are append-only even for privileged roles.
  RESET ROLE;
  BEGIN UPDATE public.review_case_events SET reason='x' WHERE case_id=case1; r := r||'case_events_update=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'case_events_update=blocked; '; END;
  BEGIN DELETE FROM public.follow_up_task_events WHERE task_id=task1; r := r||'task_events_delete=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'task_events_delete=blocked; '; END;

  -- ===== C2 (coordinator, org 2): cross-tenant denial =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub',c2,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.review_cases WHERE senior_id=s1;
  r := r||CASE WHEN n>0 THEN 'C2_case_read=LEAK!; ' ELSE 'C2_case_read=0; ' END;
  SELECT count(*) INTO n FROM public.follow_up_tasks WHERE senior_id=s1;
  r := r||CASE WHEN n>0 THEN 'C2_task_read=LEAK!; ' ELSE 'C2_task_read=0; ' END;
  SELECT count(*) INTO n FROM public.review_case_events WHERE case_id=case1;
  r := r||CASE WHEN n>0 THEN 'C2_event_read=LEAK!; ' ELSE 'C2_event_read=0; ' END;
  BEGIN PERFORM public.transition_review_case(case1, 'dismissed', 'not my org'); r := r||'C2_transition=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'C2_transition=denied; '; END;
  BEGIN PERFORM public.create_follow_up_task(s1, 'intrusion', NULL, NULL, NULL, NULL); r := r||'C2_task_create=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'C2_task_create=denied; '; END;
  RESET ROLE;

  -- ===== U (org member, no care role) =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.review_cases WHERE senior_id=s1;
  r := r||CASE WHEN n>0 THEN 'U_case_read=LEAK!; ' ELSE 'U_case_read=0; ' END;
  BEGIN PERFORM public.open_review_case(s1, a1); r := r||'U_open_case=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'U_open_case=denied; '; END;
  RESET ROLE;

  -- ===== anon =====
  SET LOCAL ROLE anon;
  BEGIN SELECT count(*) INTO n FROM public.review_cases; r := r||'anon_case_read=LEAK!; ';
  EXCEPTION WHEN others THEN r := r||'anon_case_read=denied('||SQLSTATE||'); '; END;
  BEGIN SELECT count(*) INTO n FROM public.follow_up_tasks; r := r||'anon_task_read=LEAK!; ';
  EXCEPTION WHEN others THEN r := r||'anon_task_read=denied('||SQLSTATE||'); '; END;
  BEGIN PERFORM public.open_review_case(s1, a1); r := r||'anon_open=ALLOWED!; ';
  EXCEPTION WHEN others THEN r := r||'anon_open=denied('||SQLSTATE||'); '; END;
  RESET ROLE;

  RAISE EXCEPTION 'TEST_RESULTS(rolled back): %', r;
END $$;
