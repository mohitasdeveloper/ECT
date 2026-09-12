-- ============================================================
-- ECampus Messages v2 — schema migration
-- Adds: replies, reactions, delivered/unsend/delete-for-me,
--       online presence (last_active_at)
-- Safe to run once on your existing Supabase project.
-- Run this whole file in the Supabase SQL editor.
-- ============================================================

-- 1. New columns on messages ----------------------------------
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_unsent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_for_sender boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_for_receiver boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to_id ON public.messages(reply_to_id);

-- Full row images on UPDATE (needed so realtime payloads carry
-- old + new values for things like is_unsent / delivered_at changes)
ALTER TABLE public.messages REPLICA IDENTITY FULL;

-- 2. last_active_at on users (for "Last seen ..." in chat) -----
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

-- 3. message_reactions table ------------------------------------
CREATE TABLE IF NOT EXISTS public.message_reactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_reactions_pkey PRIMARY KEY (id),
  CONSTRAINT message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE,
  CONSTRAINT message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT message_reactions_unique UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id ON public.message_reactions(message_id);

-- One reaction per person per message; DELETE payloads need full
-- old row so the client knows which (message_id, user_id) was removed.
ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "message_reactions_select_participant" ON public.message_reactions;
CREATE POLICY "message_reactions_select_participant" ON public.message_reactions
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_reactions.message_id
      AND (
        m.sender_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
        OR m.receiver_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
      )
  )
);

DROP POLICY IF EXISTS "message_reactions_insert_participant" ON public.message_reactions;
CREATE POLICY "message_reactions_insert_participant" ON public.message_reactions
FOR INSERT WITH CHECK (
  user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_reactions.message_id
      AND (
        m.sender_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
        OR m.receiver_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
      )
  )
);

DROP POLICY IF EXISTS "message_reactions_update_own" ON public.message_reactions;
CREATE POLICY "message_reactions_update_own" ON public.message_reactions
FOR UPDATE USING (user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid()))
WITH CHECK (user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "message_reactions_delete_own" ON public.message_reactions;
CREATE POLICY "message_reactions_delete_own" ON public.message_reactions
FOR DELETE USING (user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid()));

-- 4. messages UPDATE policy — widen to sender OR receiver --------
-- (receiver needs to set is_read/delivered_at/deleted_for_receiver;
--  sender needs to set is_unsent/deleted_for_sender)
DROP POLICY IF EXISTS "messages_update_receiver_only" ON public.messages;
CREATE POLICY "messages_update_participant" ON public.messages
FOR UPDATE
USING (
  sender_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
  OR receiver_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
)
WITH CHECK (
  sender_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
  OR receiver_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
);

-- NOTE ON SECURITY TRADE-OFF:
-- This policy trusts the app's own update calls (it never exposes raw
-- SQL to the client) rather than locking down which columns each side
-- may touch — Postgres RLS can't do column-level checks without a
-- trigger. The trigger below independently enforces the one rule that
-- actually matters: only the sender can unsend, and only within the
-- time window, no matter what the client sends.

-- 5. Server-side enforcement of the unsend window -----------------
CREATE OR REPLACE FUNCTION public.enforce_unsend_window()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_unsent = true AND OLD.is_unsent = false THEN
    IF OLD.sender_id <> (SELECT id FROM public.users WHERE auth_user_id = auth.uid()) THEN
      RAISE EXCEPTION 'Only the sender can unsend a message';
    END IF;
    IF OLD.created_at < now() - interval '10 minutes' THEN
      RAISE EXCEPTION 'The unsend window for this message has expired';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_unsend_window ON public.messages;
CREATE TRIGGER trg_enforce_unsend_window
BEFORE UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_unsend_window();

-- 6. Make sure realtime is actually publishing these tables --------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'message_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
  END IF;
END $$;

-- ============================================================
-- Done. After running this, redeploy the updated messages.js,
-- index.html and style.css.
-- ============================================================
