-- ============================================================
-- Posts v4 — reported posts hide from everyone until re-verified
-- Run this whole file in the Supabase SQL editor.
-- ============================================================

-- 1. New column: tracks whether a post currently has a pending report
--    against it. Separate from is_verified (which is the moderator's
--    "this is fine" signal) so a never-reported post is unaffected.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS is_reported boolean NOT NULL DEFAULT false;

-- 2. Whenever a report is filed against a post, flag it immediately.
--    SECURITY DEFINER so this works regardless of the reporter's own
--    UPDATE rights on someone else's post (they normally have none —
--    this is a narrow, well-scoped exception for exactly this purpose,
--    same pattern as the unsend-window trigger from the messages work).
CREATE OR REPLACE FUNCTION public.flag_post_on_report()
RETURNS trigger AS $$
BEGIN
  IF NEW.reported_post_id IS NOT NULL THEN
    UPDATE public.posts SET is_reported = true WHERE id = NEW.reported_post_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_flag_post_on_report ON public.reports;
CREATE TRIGGER trg_flag_post_on_report
AFTER INSERT ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.flag_post_on_report();

-- This is intentionally additive — it does NOT touch or replace your
-- existing report_post RPC. Whatever that function already does, this
-- trigger fires afterward on the resulting INSERT into `reports` and
-- only acts when reported_post_id is set (never for user-only reports).

-- 3. Marking a post verified (however you do that today — e.g. via the
--    Supabase table editor) automatically clears the report flag, so
--    reviewing a report and clearing it is a single action.
CREATE OR REPLACE FUNCTION public.clear_report_flag_on_verify()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_verified = true AND OLD.is_verified IS DISTINCT FROM true THEN
    NEW.is_reported := false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clear_report_flag_on_verify ON public.posts;
CREATE TRIGGER trg_clear_report_flag_on_verify
BEFORE UPDATE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.clear_report_flag_on_verify();

-- ============================================================
-- After this, deploy the updated main.js and feed.js — every place
-- posts are fetched now adds:
--   .or('is_reported.eq.false,is_verified.eq.true')
-- so a post is hidden the moment it's reported, and reappears the
-- moment you set is_verified = true on it (which also auto-clears
-- is_reported via the trigger above).
--
-- No GRANT changes needed — UPDATE on posts already works, and both
-- triggers here are DB-side, not client-facing.
-- ============================================================
