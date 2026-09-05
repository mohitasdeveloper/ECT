-- ============================================================
-- Hotfix: grant UPDATE on messages (and full access on the new
-- message_reactions table) to the authenticated role.
--
-- RLS policies only decide WHICH rows a role can touch — the role
-- still needs the base SQL-standard GRANT to touch the table at
-- all. That grant was missing for UPDATE on `messages`, which is
-- why is_read/delivered_at/unsend/delete all fail with
-- "permission denied for table messages" even though the RLS
-- policies themselves are correct.
-- ============================================================

GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reactions TO authenticated;

-- Optional sanity check — run this after, you should see UPDATE
-- listed for authenticated on both tables:
-- SELECT table_name, grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public' AND table_name IN ('messages','message_reactions')
-- ORDER BY table_name, grantee, privilege_type;
