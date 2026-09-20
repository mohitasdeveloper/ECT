-- ============================================================
-- RLS + grants fix for the hotpost tables (hotposts, hotpost_views,
-- hotpost_likes).
--
-- Why: the like/unlike toggle needs UPDATE on hotpost_likes, and
-- that table was only ever INSERTed into before, so it's very
-- likely never had an UPDATE policy or grant at all. This mirrors
-- the exact issue already found and fixed for `messages` in
-- hotfix_grants.sql: RLS policies alone don't let a role touch a
-- table — the base GRANT has to exist too, or every UPDATE fails
-- with "permission denied for table X" even when the policy itself
-- is written correctly. Run this whole file once in the Supabase
-- SQL editor.
--
-- Note: hotpost_replies is NOT included here — it's defined in the
-- schema but unused anywhere in the current code (story replies go
-- through `messages` instead), so there's nothing to secure yet.
-- ============================================================

-- ---------- hotposts ----------
ALTER TABLE public.hotposts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hotposts_select_all" ON public.hotposts;
CREATE POLICY "hotposts_select_all" ON public.hotposts
    FOR SELECT TO authenticated
    USING (true);
    -- Visibility (public vs. connections-only) and blocked-user filtering
    -- are enforced client-side in getHotposts(), not at the RLS level.
    -- Locking that down server-side too is a bigger, separate task.

DROP POLICY IF EXISTS "hotposts_insert_own" ON public.hotposts;
CREATE POLICY "hotposts_insert_own" ON public.hotposts
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "hotposts_update_own" ON public.hotposts;
CREATE POLICY "hotposts_update_own" ON public.hotposts
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
    -- Needed for the soft-delete (`is_deleted = true`) fix from earlier.

GRANT SELECT, INSERT, UPDATE ON public.hotposts TO authenticated;

-- ---------- hotpost_views ----------
ALTER TABLE public.hotpost_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hotpost_views_select_all" ON public.hotpost_views;
CREATE POLICY "hotpost_views_select_all" ON public.hotpost_views
    FOR SELECT TO authenticated
    USING (true);
    -- A story's own author needs to read who viewed it (Post Activity panel).

DROP POLICY IF EXISTS "hotpost_views_insert_own" ON public.hotpost_views;
CREATE POLICY "hotpost_views_insert_own" ON public.hotpost_views
    FOR INSERT TO authenticated
    WITH CHECK (viewer_id = auth.uid());

GRANT SELECT, INSERT ON public.hotpost_views TO authenticated;

-- ---------- hotpost_likes ----------
ALTER TABLE public.hotpost_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hotpost_likes_select_all" ON public.hotpost_likes;
CREATE POLICY "hotpost_likes_select_all" ON public.hotpost_likes
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "hotpost_likes_insert_own" ON public.hotpost_likes;
CREATE POLICY "hotpost_likes_insert_own" ON public.hotpost_likes
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- 🚀 This is almost certainly the one that was missing. The unlike half of
-- the toggle needs UPDATE, and only the person who owns a like row should
-- ever be able to flip its is_deleted flag.
DROP POLICY IF EXISTS "hotpost_likes_update_own" ON public.hotpost_likes;
CREATE POLICY "hotpost_likes_update_own" ON public.hotpost_likes
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.hotpost_likes TO authenticated;

-- ============================================================
-- Sanity check — run this after. You should see SELECT, INSERT,
-- and UPDATE listed for `authenticated` on all three tables below.
-- ============================================================
-- SELECT table_name, grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN ('hotposts', 'hotpost_views', 'hotpost_likes')
--   AND grantee = 'authenticated'
-- ORDER BY table_name, privilege_type;
