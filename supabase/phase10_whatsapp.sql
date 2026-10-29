-- =========================================================================
-- Sahaara — Phase 10: WhatsApp Integration Schema (Identity & Messaging)
-- =========================================================================
--
-- Trust Model & Security Guardrails:
--  * Clients hold SELECT grants only.
--  * All mutations go through SECURITY DEFINER functions with SET search_path = public.
--  * Actor is derived from auth.uid() for user actions; service_role for verified webhooks.
--  * Every state transition is recorded in public.audit_events and whatsapp_audit_transitions.
--  * Plaintext PINs and provider credentials are NEVER stored.
--  * Phone numbers are strictly constrained to ITU-T E.164 (+[1-9]\d{6,14}).
--  * Shared phones are supported safely: matching a phone number NEVER automatically
--    identifies a senior without explicit authorized relationship verification.
--
-- Rollback Considerations:
--  To roll back this migration in a staging environment:
--    DROP TABLE IF EXISTS public.whatsapp_audit_transitions CASCADE;
--    DROP TABLE IF EXISTS public.whatsapp_messages CASCADE;
--    DROP TABLE IF EXISTS public.whatsapp_conversations CASCADE;
--    DROP TABLE IF EXISTS public.whatsapp_verification_challenges CASCADE;
--    DROP TABLE IF EXISTS public.whatsapp_identities CASCADE;
--    DROP FUNCTION IF EXISTS public.request_whatsapp_verification(uuid, text, text, text, text);
--    DROP FUNCTION IF EXISTS public.confirm_whatsapp_verification(uuid, text);
--    DROP FUNCTION IF EXISTS public.revoke_whatsapp_identity(uuid, text);
--    DROP FUNCTION IF EXISTS public.record_whatsapp_inbound_message(uuid, text, text, text, text, text, jsonb, text);

-- -------------------------------------------------------------------------
-- 1. Verified Phone Identities
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  phone_number text NOT NULL CHECK (phone_number ~ '^\+[1-9]\d{6,14}$'),
  whatsapp_address text GENERATED ALWAYS AS ('whatsapp:' || phone_number) STORED,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  senior_id uuid REFERENCES public.seniors(id) ON DELETE SET NULL,
  relationship_type text NOT NULL CHECK (relationship_type IN ('senior', 'family_member', 'coordinator', 'caregiver', 'other')),
  display_name text CHECK (display_name IS NULL OR length(btrim(display_name)) <= 100),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked', 'expired')),
  verification_method text NOT NULL CHECK (verification_method IN ('otp_pin', 'coordinator_manual', 'family_invitation')),
  verified_at timestamptz,
  verified_by uuid REFERENCES public.profiles(id),
  consent_status text NOT NULL DEFAULT 'granted' CHECK (consent_status IN ('granted', 'withdrawn', 'pending')),
  consent_granted_at timestamptz NOT NULL DEFAULT now(),
  consent_withdrawn_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.profiles(id),
  revocation_reason text CHECK (revocation_reason IS NULL OR length(btrim(revocation_reason)) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique index for active links: allows a phone to be linked to different seniors/roles,
-- but prevents duplicate active links for the same (phone, org, senior, role) tuple.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_identities_unique_active_link
  ON public.whatsapp_identities (phone_number, org_id, COALESCE(senior_id, '00000000-0000-0000-0000-000000000000'::uuid), relationship_type)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS whatsapp_identities_lookup_idx
  ON public.whatsapp_identities (phone_number, status);

CREATE INDEX IF NOT EXISTS whatsapp_identities_org_idx
  ON public.whatsapp_identities (org_id, status);

CREATE INDEX IF NOT EXISTS whatsapp_identities_senior_idx
  ON public.whatsapp_identities (senior_id, status)
  WHERE senior_id IS NOT NULL;

-- -------------------------------------------------------------------------
-- 2. Phone Verification Challenges (One-Time PIN Pairing)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  phone_number text NOT NULL CHECK (phone_number ~ '^\+[1-9]\d{6,14}$'),
  pin_hash text NOT NULL CHECK (length(pin_hash) = 64),
  salt text NOT NULL CHECK (length(salt) >= 16),
  target_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_senior_id uuid REFERENCES public.seniors(id) ON DELETE SET NULL,
  relationship_type text NOT NULL DEFAULT 'family_member' CHECK (relationship_type IN ('senior', 'family_member', 'coordinator', 'caregiver', 'other')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'expired', 'exhausted', 'revoked')),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts int NOT NULL DEFAULT 3 CHECK (max_attempts >= 1 AND max_attempts <= 10),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  verified_at timestamptz,
  whatsapp_identity_id uuid REFERENCES public.whatsapp_identities(id)
);

CREATE INDEX IF NOT EXISTS whatsapp_challenges_lookup_idx
  ON public.whatsapp_verification_challenges (phone_number, status, expires_at);

-- -------------------------------------------------------------------------
-- 3. WhatsApp Conversations
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  whatsapp_identity_id uuid NOT NULL REFERENCES public.whatsapp_identities(id) ON DELETE RESTRICT,
  senior_id uuid REFERENCES public.seniors(id) ON DELETE SET NULL,
  phone_number text NOT NULL CHECK (phone_number ~ '^\+[1-9]\d{6,14}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed', 'blocked')),
  last_message_at timestamptz,
  last_message_preview text CHECK (last_message_preview IS NULL OR length(last_message_preview) <= 160),
  unread_count int NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_conversations_org_idx
  ON public.whatsapp_conversations (org_id, status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_conversations_identity_idx
  ON public.whatsapp_conversations (whatsapp_identity_id);

CREATE INDEX IF NOT EXISTS whatsapp_conversations_senior_idx
  ON public.whatsapp_conversations (senior_id)
  WHERE senior_id IS NOT NULL;

-- -------------------------------------------------------------------------
-- 4. WhatsApp Messages (Inbound & Outbound)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  whatsapp_identity_id uuid REFERENCES public.whatsapp_identities(id) ON DELETE SET NULL,
  provider_message_sid text NOT NULL UNIQUE CHECK (length(provider_message_sid) BETWEEN 8 AND 80),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_number text NOT NULL CHECK (from_number ~ '^\+[1-9]\d{6,14}$'),
  to_number text NOT NULL CHECK (to_number ~ '^\+[1-9]\d{6,14}$'),
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'audio', 'image', 'document', 'template', 'system')),
  body_text text CHECK (body_text IS NULL OR length(body_text) <= 4000),
  media_meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(media_meta) <= 2048),
  provider_status text NOT NULL DEFAULT 'received' CHECK (provider_status IN ('received', 'queued', 'sent', 'delivered', 'read', 'failed', 'undelivered')),
  processing_status text NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processed', 'duplicate', 'ignored', 'failed')),
  error_code text CHECK (error_code IS NULL OR length(error_code) <= 64),
  processed_at timestamptz,
  raw_payload_checksum text CHECK (raw_payload_checksum IS NULL OR length(raw_payload_checksum) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_messages_conv_idx
  ON public.whatsapp_messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_messages_pending_idx
  ON public.whatsapp_messages (processing_status, created_at)
  WHERE processing_status = 'pending';

-- -------------------------------------------------------------------------
-- 5. WhatsApp Audit Transitions (Append-Only)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_audit_transitions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id uuid REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE,
  provider_message_sid text NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  triggered_by text NOT NULL CHECK (triggered_by IN ('webhook_inbound', 'webhook_status', 'system_worker', 'coordinator_action')),
  actor_id uuid REFERENCES public.profiles(id),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(details) <= 2048),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_audit_msg_idx
  ON public.whatsapp_audit_transitions (provider_message_sid, occurred_at DESC);

-- Prevent mutation or deletion of audit transitions
DROP TRIGGER IF EXISTS whatsapp_audit_transitions_no_mutation ON public.whatsapp_audit_transitions;
CREATE TRIGGER whatsapp_audit_transitions_no_mutation
  BEFORE UPDATE OR DELETE ON public.whatsapp_audit_transitions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_mutation();

-- -------------------------------------------------------------------------
-- 6. Row-Level Security (RLS) Grants & Policies
-- -------------------------------------------------------------------------
REVOKE ALL ON public.whatsapp_identities,
              public.whatsapp_verification_challenges,
              public.whatsapp_conversations,
              public.whatsapp_messages,
              public.whatsapp_audit_transitions
  FROM anon, authenticated;

GRANT SELECT ON public.whatsapp_identities,
                public.whatsapp_verification_challenges,
                public.whatsapp_conversations,
                public.whatsapp_messages,
                public.whatsapp_audit_transitions
  TO authenticated;

GRANT ALL ON public.whatsapp_identities,
             public.whatsapp_verification_challenges,
             public.whatsapp_conversations,
             public.whatsapp_messages,
             public.whatsapp_audit_transitions
  TO service_role;

ALTER TABLE public.whatsapp_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_verification_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_audit_transitions ENABLE ROW LEVEL SECURITY;

-- 6a. Identities RLS
DROP POLICY IF EXISTS whatsapp_identities_read ON public.whatsapp_identities;
CREATE POLICY whatsapp_identities_read ON public.whatsapp_identities
  FOR SELECT TO authenticated
  USING (
    public.can_access_org(org_id)
    OR (senior_id IS NOT NULL AND public.can_access_senior_as_family(senior_id))
    OR user_id = auth.uid()
  );

-- 6b. Verification Challenges RLS
DROP POLICY IF EXISTS whatsapp_challenges_read ON public.whatsapp_verification_challenges;
CREATE POLICY whatsapp_challenges_read ON public.whatsapp_verification_challenges
  FOR SELECT TO authenticated
  USING (
    public.can_access_org(org_id)
    OR target_user_id = auth.uid()
  );

-- 6c. Conversations RLS
DROP POLICY IF EXISTS whatsapp_conversations_read ON public.whatsapp_conversations;
CREATE POLICY whatsapp_conversations_read ON public.whatsapp_conversations
  FOR SELECT TO authenticated
  USING (
    public.can_access_org(org_id)
    OR (senior_id IS NOT NULL AND public.can_access_senior_as_family(senior_id))
    OR EXISTS (
      SELECT 1 FROM public.whatsapp_identities i
      WHERE i.id = whatsapp_conversations.whatsapp_identity_id
        AND i.user_id = auth.uid()
    )
  );

-- 6d. Messages RLS
DROP POLICY IF EXISTS whatsapp_messages_read ON public.whatsapp_messages;
CREATE POLICY whatsapp_messages_read ON public.whatsapp_messages
  FOR SELECT TO authenticated
  USING (
    public.can_access_org(org_id)
    OR EXISTS (
      SELECT 1 FROM public.whatsapp_conversations c
      WHERE c.id = whatsapp_messages.conversation_id
        AND (
          (c.senior_id IS NOT NULL AND public.can_access_senior_as_family(c.senior_id))
          OR public.can_access_org(c.org_id)
        )
    )
  );

-- 6e. Audit Transitions RLS
DROP POLICY IF EXISTS whatsapp_audit_read ON public.whatsapp_audit_transitions;
CREATE POLICY whatsapp_audit_read ON public.whatsapp_audit_transitions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.whatsapp_messages m
      WHERE m.id = whatsapp_audit_transitions.message_id
        AND public.can_access_org(m.org_id)
    )
  );

-- -------------------------------------------------------------------------
-- 7. SECURITY DEFINER Mutation Functions
-- -------------------------------------------------------------------------

-- 7a. Request verification challenge (by coordinator/admin)
CREATE OR REPLACE FUNCTION public.request_whatsapp_verification(
  _senior uuid,
  _phone text,
  _relationship text,
  _pin_hash text,
  _salt text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid; _org uuid; _challenge_id uuid;
BEGIN
  _actor := public.require_care_actor(_senior);
  SELECT org_id INTO _org FROM public.seniors WHERE id = _senior;
  IF _org IS NULL THEN RAISE EXCEPTION 'senior not found' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.whatsapp_verification_challenges (
    org_id,
    phone_number,
    pin_hash,
    salt,
    target_senior_id,
    relationship_type,
    created_by
  )
  VALUES (
    _org,
    btrim(_phone),
    _pin_hash,
    _salt,
    _senior,
    _relationship,
    _actor
  )
  RETURNING id INTO _challenge_id;

  PERFORM public.write_audit(
    _actor,
    'whatsapp.challenge_created',
    'whatsapp_verification_challenge',
    _challenge_id::text,
    'success',
    jsonb_build_object('senior_id', _senior, 'phone_masked', substring(btrim(_phone) from 1 for 4) || '***', 'relationship', _relationship)
  );

  RETURN _challenge_id;
END $$;
REVOKE ALL ON FUNCTION public.request_whatsapp_verification(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_whatsapp_verification(uuid, text, text, text, text) TO authenticated;

-- 7b. Confirm verification challenge (single-use, rate-limited, pairing)
CREATE OR REPLACE FUNCTION public.confirm_whatsapp_verification(
  _challenge_id uuid,
  _pin_hash text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid := auth.uid();
  _ch record;
  _identity_id uuid;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;

  SELECT * INTO _ch FROM public.whatsapp_verification_challenges
  WHERE id = _challenge_id
  FOR UPDATE;

  IF _ch.id IS NULL THEN
    RAISE EXCEPTION 'verification challenge not found' USING ERRCODE = 'P0002';
  END IF;

  IF _ch.status <> 'pending' THEN
    RAISE EXCEPTION 'challenge already %', _ch.status USING ERRCODE = '42501';
  END IF;

  IF now() > _ch.expires_at THEN
    UPDATE public.whatsapp_verification_challenges SET status = 'expired' WHERE id = _ch.id;
    RAISE EXCEPTION 'verification challenge expired' USING ERRCODE = '42501';
  END IF;

  IF _ch.attempts >= _ch.max_attempts THEN
    UPDATE public.whatsapp_verification_challenges SET status = 'exhausted' WHERE id = _ch.id;
    RAISE EXCEPTION 'verification attempts exhausted' USING ERRCODE = '42501';
  END IF;

  -- Validate cryptographic PIN hash
  IF _ch.pin_hash <> _pin_hash THEN
    UPDATE public.whatsapp_verification_challenges
    SET attempts = attempts + 1,
        status = CASE WHEN attempts + 1 >= max_attempts THEN 'exhausted' ELSE status END
    WHERE id = _ch.id;

    PERFORM public.write_audit(
      _actor,
      'whatsapp.challenge_failed',
      'whatsapp_verification_challenge',
      _ch.id::text,
      'denied',
      jsonb_build_object('attempts', _ch.attempts + 1)
    );

    RAISE EXCEPTION 'invalid_pin' USING ERRCODE = '42501';
  END IF;

  -- Successfully verified! Create or activate identity
  INSERT INTO public.whatsapp_identities (
    org_id,
    phone_number,
    user_id,
    senior_id,
    relationship_type,
    status,
    verification_method,
    verified_at,
    verified_by,
    consent_status
  )
  VALUES (
    _ch.org_id,
    _ch.phone_number,
    _actor,
    _ch.target_senior_id,
    _ch.relationship_type,
    'active',
    'otp_pin',
    now(),
    _actor,
    'granted'
  )
  ON CONFLICT (phone_number, org_id, COALESCE(senior_id, '00000000-0000-0000-0000-000000000000'::uuid), relationship_type)
  DO UPDATE SET
    status = 'active',
    user_id = EXCLUDED.user_id,
    verification_method = 'otp_pin',
    verified_at = now(),
    verified_by = _actor,
    consent_status = 'granted',
    revoked_at = NULL,
    revoked_by = NULL,
    updated_at = now()
  RETURNING id INTO _identity_id;

  -- Mark challenge verified and link identity
  UPDATE public.whatsapp_verification_challenges
  SET status = 'verified',
      verified_at = now(),
      whatsapp_identity_id = _identity_id
  WHERE id = _ch.id;

  PERFORM public.write_audit(
    _actor,
    'whatsapp.identity_verified',
    'whatsapp_identity',
    _identity_id::text,
    'success',
    jsonb_build_object('org_id', _ch.org_id, 'senior_id', _ch.target_senior_id, 'challenge_id', _ch.id)
  );

  RETURN _identity_id;
END $$;
REVOKE ALL ON FUNCTION public.confirm_whatsapp_verification(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_whatsapp_verification(uuid, text) TO authenticated;

-- 7c. Revoke WhatsApp identity (by coordinator/admin)
CREATE OR REPLACE FUNCTION public.revoke_whatsapp_identity(
  _identity_id uuid,
  _reason text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor uuid := auth.uid();
  _id record;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;

  SELECT * INTO _id FROM public.whatsapp_identities WHERE id = _identity_id;
  IF _id.id IS NULL THEN RAISE EXCEPTION 'identity not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT public.can_access_org(_id.org_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.whatsapp_identities
  SET status = 'revoked',
      revoked_by = _actor,
      revoked_at = now(),
      revocation_reason = btrim(_reason),
      updated_at = now()
  WHERE id = _id.id;

  -- Pause or close open conversations
  UPDATE public.whatsapp_conversations
  SET status = 'closed', updated_at = now()
  WHERE whatsapp_identity_id = _id.id AND status = 'active';

  PERFORM public.write_audit(
    _actor,
    'whatsapp.identity_revoked',
    'whatsapp_identity',
    _id.id::text,
    'success',
    jsonb_build_object('org_id', _id.org_id, 'senior_id', _id.senior_id, 'reason', _reason)
  );
END $$;
REVOKE ALL ON FUNCTION public.revoke_whatsapp_identity(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_whatsapp_identity(uuid, text) TO authenticated;

-- 7d. Record Inbound WhatsApp Message (Idempotent - service role only)
CREATE OR REPLACE FUNCTION public.record_whatsapp_inbound_message(
  _org_id uuid,
  _provider_sid text,
  _from_number text,
  _to_number text,
  _body text,
  _media jsonb DEFAULT '{}'::jsonb,
  _raw_checksum text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _existing_id uuid;
  _identity_id uuid;
  _senior_id uuid;
  _conv_id uuid;
  _msg_id uuid;
BEGIN
  -- Idempotency check: if this Twilio MessageSid was already recorded, return immediately
  SELECT id INTO _existing_id FROM public.whatsapp_messages
  WHERE provider_message_sid = btrim(_provider_sid);

  IF _existing_id IS NOT NULL THEN
    -- Record duplicate transition event for idempotency audit
    INSERT INTO public.whatsapp_audit_transitions (
      message_id,
      provider_message_sid,
      from_status,
      to_status,
      triggered_by,
      details
    )
    VALUES (
      _existing_id,
      btrim(_provider_sid),
      'received',
      'duplicate',
      'webhook_inbound',
      jsonb_build_object('reason', 'idempotent_duplicate_sid')
    );

    RETURN _existing_id;
  END IF;

  -- Match active identity if registered
  SELECT id, senior_id INTO _identity_id, _senior_id
  FROM public.whatsapp_identities
  WHERE phone_number = btrim(_from_number)
    AND org_id = _org_id
    AND status = 'active'
    AND consent_status = 'granted'
  LIMIT 1;

  -- Find or create conversation
  IF _identity_id IS NOT NULL THEN
    SELECT id INTO _conv_id FROM public.whatsapp_conversations
    WHERE whatsapp_identity_id = _identity_id AND status = 'active'
    LIMIT 1;
  END IF;

  IF _conv_id IS NULL AND _identity_id IS NOT NULL THEN
    INSERT INTO public.whatsapp_conversations (
      org_id,
      whatsapp_identity_id,
      senior_id,
      phone_number,
      last_message_at,
      last_message_preview,
      unread_count
    )
    VALUES (
      _org_id,
      _identity_id,
      _senior_id,
      btrim(_from_number),
      now(),
      substring(btrim(_body) from 1 for 150),
      1
    )
    RETURNING id INTO _conv_id;
  END IF;

  -- If no identity was paired, conversation is null or temporary (requires pairing challenge)
  -- For messages with paired conversation:
  IF _conv_id IS NOT NULL THEN
    INSERT INTO public.whatsapp_messages (
      org_id,
      conversation_id,
      whatsapp_identity_id,
      provider_message_sid,
      direction,
      from_number,
      to_number,
      message_type,
      body_text,
      media_meta,
      provider_status,
      processing_status,
      raw_payload_checksum
    )
    VALUES (
      _org_id,
      _conv_id,
      _identity_id,
      btrim(_provider_sid),
      'inbound',
      btrim(_from_number),
      btrim(_to_number),
      'text',
      btrim(_body),
      COALESCE(_media, '{}'::jsonb),
      'received',
      'pending',
      _raw_checksum
    )
    RETURNING id INTO _msg_id;

    -- Update conversation preview and timestamp
    UPDATE public.whatsapp_conversations
    SET last_message_at = now(),
        last_message_preview = substring(btrim(_body) from 1 for 150),
        unread_count = unread_count + 1,
        updated_at = now()
    WHERE id = _conv_id;

    -- Record initial audit transition
    INSERT INTO public.whatsapp_audit_transitions (
      message_id,
      provider_message_sid,
      from_status,
      to_status,
      triggered_by,
      details
    )
    VALUES (
      _msg_id,
      btrim(_provider_sid),
      'none',
      'received',
      'webhook_inbound',
      jsonb_build_object('from', btrim(_from_number), 'has_identity', true)
    );

    RETURN _msg_id;
  END IF;

  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.record_whatsapp_inbound_message(uuid, text, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_inbound_message(uuid, text, text, text, text, jsonb, text) TO service_role;

