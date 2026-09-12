-- ============================================================
-- Share a post directly into a chat (Instagram-style "Send to")
-- Run this whole file in the Supabase SQL editor.
-- ============================================================

-- New nullable column: when set, this message IS a shared post
-- rather than a plain text message. Mirrors messages.hotpost_reply_id
-- (see migration_hotpost_replies_v5.sql) exactly, for the same reason:
-- no RLS/GRANT changes needed here either — this reuses the existing
-- messages_insert_connected_sender policy, so "you can only share a
-- post into a chat with a connection" is already true automatically
-- once sharing goes through a normal messages insert.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS shared_post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_shared_post_id ON public.messages(shared_post_id);

-- ============================================================
-- After this, deploy the updated main.js, feed.js and messages.js.
-- ============================================================
