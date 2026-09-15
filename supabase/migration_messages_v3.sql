-- ============================================================
-- ECampus Messages v3 — Pin / Mute / Archive / Delete chat
-- Run this whole file in the Supabase SQL editor.
-- (Grants are included explicitly this time — see the v2
--  hotfix notes on why that matters.)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.conversation_settings (
  user_id      uuid NOT NULL,
  partner_id   uuid NOT NULL,
  pinned       boolean NOT NULL DEFAULT false,
  pinned_at    timestamptz,
  muted_until  timestamptz,          -- null = not muted; a future timestamp = muted until then
  archived     boolean NOT NULL DEFAULT false,
  archived_at  timestamptz,
  deleted_at   timestamptz,          -- "delete chat": hides everything up to this point for me;
                                      -- a new incoming message after this brings the thread back
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_settings_pkey PRIMARY KEY (user_id, partner_id),
  CONSTRAINT conversation_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT conversation_settings_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.users(id) ON DELETE CASCADE
);

ALTER TABLE public.conversation_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversation_settings_select_own" ON public.conversation_settings;
CREATE POLICY "conversation_settings_select_own" ON public.conversation_settings
FOR SELECT USING (user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "conversation_settings_insert_own" ON public.conversation_settings;
CREATE POLICY "conversation_settings_insert_own" ON public.conversation_settings
FOR INSERT WITH CHECK (user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "conversation_settings_update_own" ON public.conversation_settings;
CREATE POLICY "conversation_settings_update_own" ON public.conversation_settings
FOR UPDATE USING (user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid()))
WITH CHECK (user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "conversation_settings_delete_own" ON public.conversation_settings;
CREATE POLICY "conversation_settings_delete_own" ON public.conversation_settings
FOR DELETE USING (user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid()));

-- Explicit base-privilege GRANT — learned this the hard way last time:
-- RLS policies alone are not enough, the role needs the underlying
-- SQL-standard grant too, or every request 403s with
-- "permission denied for table conversation_settings".
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_settings TO authenticated;

-- Realtime is intentionally NOT enabled for this table — pin/mute/
-- archive/delete are private per-user preferences with no cross-user
-- fan-out need, so there's nothing for another client to subscribe to.

-- ============================================================
-- Done. After running this, deploy the updated messages.js,
-- index.html and main.js.
-- ============================================================
