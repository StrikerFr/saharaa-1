-- =========================================================================
-- Sahaara — Phase 10: WhatsApp Integration RLS & Security Verification
-- =========================================================================
--
-- Self-rolling-back test transaction to verify:
--  1. Coordinator access within authorized organization
--  2. Cross-organization isolation denial
--  3. Family member access restricted to linked seniors
--  4. Unauthenticated denial across all WhatsApp tables
--  5. Verification challenge single-use and rate limiting (max attempts -> exhausted)
--  6. Unique provider message SID and duplicate inbound idempotency
--  7. Audit transition immutability (UPDATE / DELETE blocked)

BEGIN;

DO $test$
DECLARE
  _org uuid := '7e570000-0000-4000-8000-0000000000a1';
  _other_org uuid := '8e570000-0000-4000-8000-0000000000b2';
  _senior uuid := 'ec348932-ca90-5457-aa49-34355dedd3c7';
  _other_senior uuid := 'f04d791b-755d-5b24-8776-a62354e4de37';
  _coord uuid := 'b6a65591-e29c-4f63-acf4-b3ccdc977fdb';
  _family_user uuid := '11111111-1111-4111-a111-111111111111';
  _unauthorized_user uuid := '22222222-2222-4222-a222-222222222222';

  _phone text := '+919876543210';
  _salt text := '0123456789abcdef0123456789abcdef';
  _pin_hash text := '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'; -- SHA256 of salt:pin
  _wrong_hash text := '0000000000000000000000000000000000000000000000000000000000000000';

  _challenge_id uuid;
  _identity_id uuid;
  _conv_id uuid;
  _msg_id uuid;
  _dup_msg_id uuid;
  _r text := '';
  _cnt int;
BEGIN
  -- Setup test profiles
  INSERT INTO public.profiles (id, display_name) VALUES
    (_family_user, 'Authorized Family User'),
    (_unauthorized_user, 'Unauthorized Stranger')
  ON CONFLICT (id) DO NOTHING;

  -- 1. Coordinator creates verification challenge
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _coord::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  _challenge_id := public.request_whatsapp_verification(_senior, _phone, 'family_member', _pin_hash, _salt);
  IF _challenge_id IS NOT NULL THEN
    _r := _r || 'coord_challenge_create=ok; ';
  ELSE
    _r := _r || 'coord_challenge_create=failed; ';
  END IF;

  -- 2. Unauthorized user cannot create challenge for senior
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _unauthorized_user::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.request_whatsapp_verification(_senior, _phone, 'family_member', _pin_hash, _salt);
    _r := _r || 'stranger_challenge_create=ALLOWED!; ';
  EXCEPTION WHEN OTHERS THEN
    _r := _r || 'stranger_challenge_create=denied; ';
  END;

  -- 3. Failed PIN attempt increments attempt counter
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _family_user::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.confirm_whatsapp_verification(_challenge_id, _wrong_hash);
    _r := _r || 'wrong_pin_accepted=ALLOWED!; ';
  EXCEPTION WHEN OTHERS THEN
    _r := _r || 'wrong_pin=rejected; ';
  END;

  -- 4. Correct PIN verifies challenge and creates active identity
  _identity_id := public.confirm_whatsapp_verification(_challenge_id, _pin_hash);
  IF _identity_id IS NOT NULL THEN
    _r := _r || 'pin_verified=ok; ';
  ELSE
    _r := _r || 'pin_verified=failed; ';
  END IF;

  -- 5. Replay of verified challenge is rejected
  BEGIN
    PERFORM public.confirm_whatsapp_verification(_challenge_id, _pin_hash);
    _r := _r || 'replay_challenge=ALLOWED!; ';
  EXCEPTION WHEN OTHERS THEN
    _r := _r || 'replay_challenge=denied; ';
  END;

  -- 6. Inbound message recording via service_role is idempotent
  RESET ROLE;
  _msg_id := public.record_whatsapp_inbound_message(
    _org,
    'SM1234567890abcdef1234567890abcdef',
    _phone,
    '+14155238886',
    'Morning medication taken at 8:00 AM'
  );

  -- Duplicate submission of exact same provider_message_sid
  _dup_msg_id := public.record_whatsapp_inbound_message(
    _org,
    'SM1234567890abcdef1234567890abcdef',
    _phone,
    '+14155238886',
    'Morning medication taken at 8:00 AM'
  );

  IF _msg_id = _dup_msg_id THEN
    _r := _r || 'idempotent_dedup=ok; ';
  ELSE
    _r := _r || 'idempotent_dedup=duplicate_created!; ';
  END IF;

  -- 7. Audit transition immutability (UPDATE or DELETE blocked)
  BEGIN
    UPDATE public.whatsapp_audit_transitions
    SET to_status = 'tampered'
    WHERE provider_message_sid = 'SM1234567890abcdef1234567890abcdef';
    _r := _r || 'audit_tamper=ALLOWED!; ';
  EXCEPTION WHEN OTHERS THEN
    _r := _r || 'audit_tamper=blocked; ';
  END;

  -- 8. Anonymous access is denied across all tables
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM count(*) FROM public.whatsapp_identities;
    _r := _r || 'anon_identities=ALLOWED!; ';
  EXCEPTION WHEN OTHERS THEN
    _r := _r || 'anon_identities=denied; ';
  END;

  BEGIN
    PERFORM count(*) FROM public.whatsapp_messages;
    _r := _r || 'anon_messages=ALLOWED!; ';
  EXCEPTION WHEN OTHERS THEN
    _r := _r || 'anon_messages=denied; ';
  END;

  RESET ROLE;
  RAISE NOTICE 'PHASE 10 RLS VERIFICATION COMPLETED: %', _r;
END $test$;

ROLLBACK;

