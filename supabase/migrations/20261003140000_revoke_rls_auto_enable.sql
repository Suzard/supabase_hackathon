-- rls_auto_enable() is Supabase's event-trigger helper (trigger `ensure_rls`) that turns on
-- RLS for new tables in public. It is SECURITY DEFINER and was callable over the REST API by
-- anon and authenticated (advisor lints 0028/0029). Event triggers don't check EXECUTE when
-- they fire, so revoking it keeps the trigger working.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
