-- ============================================================
-- Hotpost replies -> Messages (Instagram-style)
-- Run this whole file in the Supabase SQL editor.
-- ============================================================

-- New nullable column: when set, this message IS a reply to that
-- story. No RLS/GRANT changes needed — this reuses the existing
-- messages_insert_connected_sender policy, which already only allows
-- an INSERT when sender and receiver have an accepted connection.
-- That's what makes "only connections can reply" true automatically
-- once story replies go through a normal messages insert.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS hotpost_reply_id uuid REFERENCES public.hotposts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_hotpost_reply_id ON public.messages(hotpost_reply_id);

-- Note: the old public.hotpost_replies table is left in place (not
-- dropped) — no new replies get written to it after this deploy, but
-- any historical rows stay intact in case you want to look back at
-- them. Safe to drop later once you've confirmed you don't need it.

-- ============================================================
-- After this, deploy the updated hotposts.js, messages.js and
-- index.html.
-- ============================================================
