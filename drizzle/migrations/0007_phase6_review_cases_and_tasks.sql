-- ============================================================================
-- Phase 6 - Coordinator operations: review cases and follow-up tasks
-- Review cases track the human review lifecycle of a senior's surfaced
-- assessments; follow-up tasks track the next human action. Clients get
-- SELECT only; every mutation goes through a SECURITY DEFINER function that
-- derives the actor from auth.uid(), validates the transition and org scope,
-- writes append-only history, and audits. Overdue is derived from due_at and
-- status at query time - never stored.
-- ============================================================================

CREATE TYPE public.review_case_status AS ENUM
  ('needs_review', 'in_review', 'follow_up_required', 'resolved', 'dismissed');
CREATE TYPE public.follow_up_task_status AS ENUM
  ('open', 'in_progress', 'completed', 'cancelled');

-- ===== Review cases =====
CREATE TABLE public.review_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id uuid NOT NULL REFERENCES public.seniors(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  status public.review_case_status NOT NULL DEFAULT 'needs_review',
  priority_at_open text NOT NULL CHECK (priority_at_open IN
    ('unable_to_assess','no_signal_detected','review_suggested','review_recommended','prompt_review_recommended')),
  opened_by_assessment_id uuid NOT NULL REFERENCES public.risk_assessments(id) ON DELETE RESTRICT,
  latest_assessment_id uuid NOT NULL REFERENCES public.risk_assessments(id) ON DELETE RESTRICT,
  assigned_to uuid REFERENCES public.profiles(id),
  opened_by uuid NOT NULL REFERENCES public.profiles(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX review_cases_one_active_per_senior ON public.review_cases (senior_id)
  WHERE status IN ('needs_review', 'in_review', 'follow_up_required');
CREATE INDEX review_cases_org_status_idx ON public.review_cases (org_id, status, opened_at DESC);
CREATE INDEX review_cases_assignee_idx ON public.review_cases (assigned_to) WHERE assigned_to IS NOT NULL;

REVOKE ALL ON public.review_cases FROM anon, authenticated;
GRANT SELECT ON public.review_cases TO authenticated;
GRANT ALL ON public.review_cases TO service_role;
ALTER TABLE public.review_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Care team reads org review cases" ON public.review_cases FOR SELECT TO authenticated
  USING (public.can_access_org(org_id));

-- Append-only review status history
CREATE TABLE public.review_case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.review_cases(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  from_status public.review_case_status,
  to_status public.review_case_status NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 2 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_case_events_case_idx ON public.review_case_events (case_id, created_at ASC, id ASC);

REVOKE ALL ON public.review_case_events FROM anon, authenticated;
GRANT SELECT ON public.review_case_events TO authenticated;
GRANT SELECT, INSERT ON public.review_case_events TO service_role;
ALTER TABLE public.review_case_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Care team reads org review events" ON public.review_case_events FOR SELECT TO authenticated
  USING (public.can_access_org(org_id));

CREATE OR REPLACE FUNCTION public.review_case_events_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'review_case_events is append-only';
END $$;
CREATE TRIGGER review_case_events_no_update BEFORE UPDATE OR DELETE ON public.review_case_events
  FOR EACH ROW EXECUTE FUNCTION public.review_case_events_immutable();
CREATE TRIGGER review_case_events_no_truncate BEFORE TRUNCATE ON public.review_case_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.review_case_events_immutable();

-- ===== Follow-up tasks =====
CREATE TABLE public.follow_up_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id uuid NOT NULL REFERENCES public.seniors(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  review_case_id uuid REFERENCES public.review_cases(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 160),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  assigned_to uuid REFERENCES public.profiles(id),
  due_at timestamptz,
  status public.follow_up_task_status NOT NULL DEFAULT 'open',
  outcome_note text CHECK (outcome_note IS NULL OR length(btrim(outcome_note)) BETWEEN 2 AND 2000),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX follow_up_tasks_org_status_due_idx ON public.follow_up_tasks (org_id, status, due_at);
CREATE INDEX follow_up_tasks_senior_idx ON public.follow_up_tasks (senior_id, created_at DESC);
CREATE INDEX follow_up_tasks_case_idx ON public.follow_up_tasks (review_case_id) WHERE review_case_id IS NOT NULL;
CREATE INDEX follow_up_tasks_assignee_idx ON public.follow_up_tasks (assigned_to) WHERE assigned_to IS NOT NULL;

REVOKE ALL ON public.follow_up_tasks FROM anon, authenticated;
GRANT SELECT ON public.follow_up_tasks TO authenticated;
GRANT ALL ON public.follow_up_tasks TO service_role;
ALTER TABLE public.follow_up_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Care team reads org tasks" ON public.follow_up_tasks FOR SELECT TO authenticated
  USING (public.can_access_org(org_id));

CREATE TABLE public.follow_up_task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.follow_up_tasks(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  from_status public.follow_up_task_status,
  to_status public.follow_up_task_status NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 2 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX follow_up_task_events_task_idx ON public.follow_up_task_events (task_id, created_at ASC, id ASC);

REVOKE ALL ON public.follow_up_task_events FROM anon, authenticated;
GRANT SELECT ON public.follow_up_task_events TO authenticated;
GRANT SELECT, INSERT ON public.follow_up_task_events TO service_role;
ALTER TABLE public.follow_up_task_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Care team reads org task events" ON public.follow_up_task_events FOR SELECT TO authenticated
  USING (public.can_access_org(org_id));

CREATE OR REPLACE FUNCTION public.follow_up_task_events_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'follow_up_task_events is append-only';
END $$;
CREATE TRIGGER follow_up_task_events_no_update BEFORE UPDATE OR DELETE ON public.follow_up_task_events
  FOR EACH ROW EXECUTE FUNCTION public.follow_up_task_events_immutable();
CREATE TRIGGER follow_up_task_events_no_truncate BEFORE TRUNCATE ON public.follow_up_task_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.follow_up_task_events_immutable();

-- ===== Shared guards =====
CREATE OR REPLACE FUNCTION public.require_care_actor(_senior uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid := auth.uid(); _org uuid;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT org_id INTO _org FROM public.seniors WHERE id = _senior;
  IF _org IS NULL OR NOT public.can_access_org(_org) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN _actor;
END $$;
REVOKE ALL ON FUNCTION public.require_care_actor(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_valid_assignee(_assignee uuid, _org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _assignee IS NOT NULL AND _org IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = _assignee AND org_id = _org)
     AND (public.has_role(_assignee, 'coordinator') OR public.has_role(_assignee, 'admin'))
$$;
REVOKE ALL ON FUNCTION public.is_valid_assignee(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Helper for assignee selector in task form
CREATE OR REPLACE FUNCTION public.org_assignees()
RETURNS TABLE (id uuid, display_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.display_name
  FROM public.profiles p
  JOIN public.organization_members m ON m.user_id = p.id
  WHERE m.org_id = public.current_org()
    AND public.can_access_org(m.org_id)
    AND (public.has_role(p.id, 'coordinator') OR public.has_role(p.id, 'admin'))
  ORDER BY p.display_name ASC;
$$;
REVOKE ALL ON FUNCTION public.org_assignees() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_assignees() TO authenticated;

-- ===== Review case mutations =====
CREATE OR REPLACE FUNCTION public.open_review_case(_senior uuid, _assessment uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid; _org uuid; _priority text; _case uuid;
BEGIN
  _actor := public.require_care_actor(_senior);
  SELECT org_id INTO _org FROM public.seniors WHERE id = _senior;
  SELECT priority INTO _priority FROM public.risk_assessments
    WHERE id = _assessment AND senior_id = _senior AND public.can_access_senior(_senior);
  IF _priority IS NULL THEN RAISE EXCEPTION 'assessment not found for this senior' USING ERRCODE = '23503'; END IF;

  SELECT id INTO _case FROM public.review_cases
    WHERE senior_id = _senior AND status IN ('needs_review', 'in_review', 'follow_up_required');
  IF _case IS NOT NULL THEN
    UPDATE public.review_cases SET latest_assessment_id = _assessment, updated_at = now()
      WHERE id = _case;
    RETURN _case;
  END IF;

  INSERT INTO public.review_cases
    (senior_id, org_id, status, priority_at_open, opened_by_assessment_id, latest_assessment_id, opened_by)
    VALUES (_senior, _org, 'needs_review', _priority, _assessment, _assessment, _actor)
    RETURNING id INTO _case;
  INSERT INTO public.review_case_events (case_id, org_id, from_status, to_status, actor_id, reason)
    VALUES (_case, _org, NULL, 'needs_review', _actor, NULL);
  PERFORM public.write_audit(_actor, 'review_case.opened', 'review_case', _case::text, 'success',
    jsonb_build_object('senior_id', _senior, 'assessment_id', _assessment, 'priority', _priority));
  RETURN _case;
END $$;
REVOKE ALL ON FUNCTION public.open_review_case(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_review_case(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.transition_review_case(
  _case uuid, _to public.review_case_status, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid; _from public.review_case_status; _senior uuid; _org uuid;
BEGIN
  SELECT senior_id, org_id, status INTO _senior, _org, _from FROM public.review_cases WHERE id = _case;
  IF _senior IS NULL THEN RAISE EXCEPTION 'case not found' USING ERRCODE = '23503'; END IF;
  _actor := public.require_care_actor(_senior);

  IF _from IN ('resolved', 'dismissed') THEN
    RAISE EXCEPTION 'case is already closed' USING ERRCODE = '23514';
  END IF;
  IF _to = _from THEN
    RAISE EXCEPTION 'case is already in this status' USING ERRCODE = '23514';
  END IF;

  IF NOT ((_from = 'needs_review' AND _to IN ('in_review', 'dismissed'))
       OR (_from = 'in_review' AND _to IN ('follow_up_required', 'resolved', 'dismissed'))
       OR (_from = 'follow_up_required' AND _to IN ('resolved', 'dismissed'))) THEN
    RAISE EXCEPTION 'invalid status transition' USING ERRCODE = '23514';
  END IF;
  IF _to = 'dismissed' AND (_reason IS NULL OR length(btrim(_reason)) < 2) THEN
    RAISE EXCEPTION 'dismissal requires a reason' USING ERRCODE = '23514';
  END IF;
  IF _to = 'resolved' AND (_reason IS NULL OR length(btrim(_reason)) < 2) THEN
    RAISE EXCEPTION 'resolution requires an outcome note' USING ERRCODE = '23514';
  END IF;

  UPDATE public.review_cases
    SET status = _to, updated_at = now(), version = version + 1
    WHERE id = _case AND status = _from;
  IF NOT FOUND THEN RAISE EXCEPTION 'case changed while you worked; reload and try again' USING ERRCODE = '23514'; END IF;

  INSERT INTO public.review_case_events (case_id, org_id, from_status, to_status, actor_id, reason)
    VALUES (_case, _org, _from, _to, _actor, _reason);
  PERFORM public.write_audit(_actor, 'review_case.' || _to::text, 'review_case', _case::text, 'success',
    jsonb_build_object('senior_id', _senior, 'from', _from, 'to', _to));
END $$;
REVOKE ALL ON FUNCTION public.transition_review_case(uuid, public.review_case_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_review_case(uuid, public.review_case_status, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_review_case(_case uuid, _assignee uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid; _senior uuid; _org uuid; _status public.review_case_status;
BEGIN
  SELECT senior_id, org_id, status INTO _senior, _org, _status FROM public.review_cases WHERE id = _case;
  IF _senior IS NULL THEN RAISE EXCEPTION 'case not found' USING ERRCODE = '23503'; END IF;
  _actor := public.require_care_actor(_senior);
  IF _assignee IS NOT NULL AND NOT public.is_valid_assignee(_assignee, _org) THEN
    RAISE EXCEPTION 'assignee must be a coordinator or admin in this organisation' USING ERRCODE = '42501';
  END IF;
  UPDATE public.review_cases SET assigned_to = _assignee, updated_at = now(), version = version + 1
    WHERE id = _case;
  PERFORM public.write_audit(_actor, 'review_case.assigned', 'review_case', _case::text, 'success',
    jsonb_build_object('senior_id', _senior, 'assignee', _assignee));
END $$;
REVOKE ALL ON FUNCTION public.assign_review_case(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_review_case(uuid, uuid) TO authenticated;

-- ===== Follow-up task mutations =====
CREATE OR REPLACE FUNCTION public.create_follow_up_task(
  _senior uuid, _title text, _notes text DEFAULT NULL, _case uuid DEFAULT NULL,
  _assignee uuid DEFAULT NULL, _due_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid; _org uuid; _case_senior uuid; _task uuid;
BEGIN
  _actor := public.require_care_actor(_senior);
  SELECT org_id INTO _org FROM public.seniors WHERE id = _senior;
  IF _title IS NULL OR length(btrim(_title)) < 2 THEN
    RAISE EXCEPTION 'title is required' USING ERRCODE = '23514';
  END IF;
  IF _case IS NOT NULL THEN
    SELECT senior_id INTO _case_senior FROM public.review_cases WHERE id = _case;
    IF _case_senior IS NULL OR _case_senior <> _senior THEN
      RAISE EXCEPTION 'review case does not belong to this senior' USING ERRCODE = '23503';
    END IF;
  END IF;
  IF _assignee IS NOT NULL AND NOT public.is_valid_assignee(_assignee, _org) THEN
    RAISE EXCEPTION 'assignee must be a coordinator or admin in this organisation' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.follow_up_tasks
    (senior_id, org_id, review_case_id, title, notes, assigned_to, due_at, status, created_by)
    VALUES (_senior, _org, _case, btrim(_title), _notes, _assignee, _due_at, 'open', _actor)
    RETURNING id INTO _task;
  INSERT INTO public.follow_up_task_events (task_id, org_id, from_status, to_status, actor_id, note)
    VALUES (_task, _org, NULL, 'open', _actor, NULL);
  PERFORM public.write_audit(_actor, 'follow_up_task.created', 'follow_up_task', _task::text, 'success',
    jsonb_build_object('senior_id', _senior, 'case_id', _case, 'assignee', _assignee, 'due_at', _due_at));
  RETURN _task;
END $$;
REVOKE ALL ON FUNCTION public.create_follow_up_task(uuid, text, text, uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_follow_up_task(uuid, text, text, uuid, uuid, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.transition_follow_up_task(
  _task uuid, _to public.follow_up_task_status, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid; _from public.follow_up_task_status; _senior uuid; _org uuid;
BEGIN
  SELECT senior_id, org_id, status INTO _senior, _org, _from FROM public.follow_up_tasks WHERE id = _task;
  IF _senior IS NULL THEN RAISE EXCEPTION 'task not found' USING ERRCODE = '23503'; END IF;
  _actor := public.require_care_actor(_senior);

  IF _from IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'task is already closed' USING ERRCODE = '23514';
  END IF;

  IF NOT ((_from = 'open' AND _to IN ('in_progress', 'completed', 'cancelled'))
       OR (_from = 'in_progress' AND _to IN ('completed', 'cancelled', 'open'))) THEN
    RAISE EXCEPTION 'invalid status transition' USING ERRCODE = '23514';
  END IF;
  IF _to = 'completed' AND (_note IS NULL OR length(btrim(_note)) < 2) THEN
    RAISE EXCEPTION 'completion requires an outcome note' USING ERRCODE = '23514';
  END IF;

  UPDATE public.follow_up_tasks
    SET status = _to,
        outcome_note = CASE WHEN _to = 'completed' THEN btrim(_note) ELSE outcome_note END,
        completed_at = CASE WHEN _to = 'completed' THEN now() ELSE completed_at END,
        updated_at = now(), version = version + 1
    WHERE id = _task AND status = _from;
  IF NOT FOUND THEN RAISE EXCEPTION 'task changed while you worked; reload and try again' USING ERRCODE = '23514'; END IF;

  INSERT INTO public.follow_up_task_events (task_id, org_id, from_status, to_status, actor_id, note)
    VALUES (_task, _org, _from, _to, _actor, _note);
  PERFORM public.write_audit(_actor, 'follow_up_task.' || _to::text, 'follow_up_task', _task::text, 'success',
    jsonb_build_object('senior_id', _senior, 'from', _from, 'to', _to));
END $$;
REVOKE ALL ON FUNCTION public.transition_follow_up_task(uuid, public.follow_up_task_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_follow_up_task(uuid, public.follow_up_task_status, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_follow_up_task(_task uuid, _assignee uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor uuid; _senior uuid; _org uuid;
BEGIN
  SELECT senior_id, org_id INTO _senior, _org FROM public.follow_up_tasks WHERE id = _task;
  IF _senior IS NULL THEN RAISE EXCEPTION 'task not found' USING ERRCODE = '23503'; END IF;
  _actor := public.require_care_actor(_senior);
  IF _assignee IS NOT NULL AND NOT public.is_valid_assignee(_assignee, _org) THEN
    RAISE EXCEPTION 'assignee must be a coordinator or admin in this organisation' USING ERRCODE = '42501';
  END IF;
  UPDATE public.follow_up_tasks SET assigned_to = _assignee, updated_at = now(), version = version + 1
    WHERE id = _task;
  PERFORM public.write_audit(_actor, 'follow_up_task.assigned', 'follow_up_task', _task::text, 'success',
    jsonb_build_object('senior_id', _senior, 'assignee', _assignee));
END $$;
REVOKE ALL ON FUNCTION public.assign_follow_up_task(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_follow_up_task(uuid, uuid) TO authenticated;

