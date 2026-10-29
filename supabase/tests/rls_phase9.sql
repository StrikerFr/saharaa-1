-- =========================================================================
-- Sahaara — Phase 9 RLS & Security Verification Matrix (Self-Rolling-Back)
-- =========================================================================

BEGIN;

DO $test$
DECLARE
  _org uuid := '7e570000-0000-4000-8000-0000000000a1';
  _senior uuid := 'ec348932-ca90-5457-aa49-34355dedd3c7';
  _other_senior uuid := 'f04d791b-755d-5b24-8776-a62354e4de37';
  _coord uuid := 'b6a65591-e29c-4f63-acf4-b3ccdc977fdb';
  _family_user uuid := '11111111-1111-4111-a111-111111111111';
  _unauthorized_user uuid := '22222222-2222-4222-a222-222222222222';
  _token_hash text := 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  _inv_id uuid;
  _grant_id uuid;
  _can_access boolean;
  _r text := '';
  _cnt int;
BEGIN
  -- 1. Setup mock profiles
  INSERT INTO public.profiles (id, display_name) VALUES
    (_family_user, 'Authorized Family Member'),
    (_unauthorized_user, 'Unauthorized Stranger')
  ON CONFLICT (id) DO NOTHING;

  -- 2. Test create invitation as coordinator
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _coord::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  _inv_id := public.create_family_invitation(_senior, 'family@example.test', 'Daughter', _token_hash);
  IF _inv_id IS NOT NULL THEN
    _r := _r || 'invitation_created=ok; ';
  ELSE
    _r := _r || 'invitation_created=failed; ';
  END IF;

  -- 3. Test unauthorized user cannot create invitation
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _unauthorized_user::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.create_family_invitation(_senior, 'stranger@example.test', 'None', 'fakehash12345678901234567890123456789012345678901234567890123456');
    _r := _r || 'stranger_invite=ALLOWED!; ';
  EXCEPTION WHEN OTHERS THEN
    _r := _r || 'stranger_invite=denied; ';
  END;

  -- 4. Accept invitation as family member
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _family_user::text, 'role', 'authenticated')::text, true);
  PERFORM public.accept_family_invitation(_token_hash);

  -- Check access to linked senior
  SELECT public.can_access_senior_as_family(_senior, _family_user) INTO _can_access;
  IF _can_access THEN
    _r := _r || 'family_linked_senior_access=ok; ';
  ELSE
    _r := _r || 'family_linked_senior_access=failed; ';
  END IF;

  -- Check access to unlinked senior is denied
  SELECT public.can_access_senior_as_family(_other_senior, _family_user) INTO _can_access;
  IF NOT _can_access THEN
    _r := _r || 'family_unlinked_senior_denied=ok; ';
  ELSE
    _r := _r || 'family_unlinked_senior_denied=ALLOWED!; ';
  END IF;

  -- 5. Revoke access as coordinator
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _coord::text, 'role', 'authenticated')::text, true);
  PERFORM public.revoke_family_access(_senior, _family_user, 'Family requested removal');

  -- Verify access is revoked
  SELECT public.can_access_senior_as_family(_senior, _family_user) INTO _can_access;
  IF NOT _can_access THEN
    _r := _r || 'revoked_access_denied=ok; ';
  ELSE
    _r := _r || 'revoked_access_denied=ALLOWED!; ';
  END IF;

  RAISE NOTICE 'PHASE 9 RLS RESULTS: %', _r;
  IF _r LIKE '%ALLOWED!%' OR _r LIKE '%failed%' THEN
    RAISE EXCEPTION 'RLS check failed: %', _r;
  END IF;

  RESET ROLE;
END $test$;

ROLLBACK;

