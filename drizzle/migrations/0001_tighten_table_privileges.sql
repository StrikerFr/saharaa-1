-- Remove default schema privileges, then grant exactly what the policies need.
REVOKE ALL ON public.profiles, public.user_roles, public.consent_records, public.audit_events FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (display_name) ON public.profiles TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT ON public.consent_records TO authenticated;
GRANT SELECT ON public.audit_events TO authenticated;
REVOKE ALL ON FUNCTION public.prevent_audit_mutation(), public.touch_updated_at(), public.consent_immutable_fields() FROM PUBLIC, anon, authenticated;