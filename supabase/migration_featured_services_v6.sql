-- ============================================================
-- Featured Services — curated grid on the Search page (replaces
-- "Suggested for you" on the default/empty-query view).
--
-- Fully independent from the existing `page_services` table (which
-- page owners manage themselves on their own profile) — this one is
-- meant to be managed entirely by you, directly in the Supabase
-- table editor, matching how is_verified etc. already work in this
-- app (no in-app admin UI).
--
-- Run this whole file in the Supabase SQL editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.featured_services (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Group header ("By ClassCount"). provider_user_id is who the CARD
  -- (anything except a specific icon) opens — leave it null until you
  -- link it to that provider's real Page account; the card just shows
  -- a "not linked yet" toast until then.
  provider_name    text NOT NULL,
  provider_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,

  -- One icon+label item within that group. Tapping the ICON opens
  -- link_url directly (does not open the provider's page).
  label            text NOT NULL,
  icon_name        text NOT NULL DEFAULT 'link',   -- any Material Symbols Outlined name
  icon_bg          text NOT NULL DEFAULT '#E3F2FD', -- pastel background, hex
  icon_color       text NOT NULL DEFAULT '#1976D2', -- icon color, hex
  link_url         text NOT NULL,
  open_in_app      boolean NOT NULL DEFAULT true,   -- same convention as page_services.open_in_app

  -- Ordering / visibility
  group_order      integer NOT NULL DEFAULT 0,  -- order of the provider groups themselves
  item_order       integer NOT NULL DEFAULT 0,  -- order of items within a group
  is_active        boolean NOT NULL DEFAULT true,

  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_featured_services_active_order
  ON public.featured_services (is_active, group_order, item_order);

ALTER TABLE public.featured_services ENABLE ROW LEVEL SECURITY;

-- Read-only from the client, for every logged-in user. No INSERT/UPDATE/
-- DELETE policy is defined at all, so those stay fully locked to you
-- managing this table directly (as the Supabase Studio / service role
-- connection, which bypasses RLS) — matching "manage completely".
DROP POLICY IF EXISTS "featured_services_select_authenticated" ON public.featured_services;
CREATE POLICY "featured_services_select_authenticated" ON public.featured_services
FOR SELECT USING (auth.uid() IS NOT NULL);

GRANT SELECT ON public.featured_services TO authenticated;

-- ============================================================
-- Seed data — matches the reference screenshot exactly. All
-- provider_user_id values are left NULL since these are example
-- provider names with no real Page account yet in your database.
-- Once each provider has a real account, run:
--   UPDATE public.featured_services SET provider_user_id = '<uuid>'
--   WHERE provider_name = '<name>';
-- to wire up "tap the card -> open their page".
-- ============================================================

INSERT INTO public.featured_services
  (provider_name, label, icon_name, icon_bg, icon_color, link_url, group_order, item_order)
VALUES
  -- By ClassCount
  ('ClassCount', 'Schedule',    'calendar_month', '#E3F2FD', '#1976D2', 'https://example.com/classcount/schedule',   0, 0),
  ('ClassCount', 'Attendance',  'how_to_reg',      '#E8F5E9', '#2E7D32', 'https://example.com/classcount/attendance', 0, 1),
  ('ClassCount', 'TimeTable',   'schedule',        '#EDE7F6', '#5E35B1', 'https://example.com/classcount/timetable',  0, 2),

  -- By GreenClub
  ('GreenClub', 'Challenges',   'eco',        '#F1F8E9', '#558B2F', 'https://example.com/greenclub/challenges', 1, 0),
  ('GreenClub', 'Plastic Log',  'recycling',  '#F9FBE7', '#9E9D24', 'https://example.com/greenclub/plastic-log', 1, 1),
  ('GreenClub', 'Leaderboard',  'emoji_events','#FFF8E1', '#F9A825', 'https://example.com/greenclub/leaderboard', 1, 2),

  -- By BAFs App
  ('BAFs App', 'Question Bank', 'quiz',        '#EDE7F6', '#5E35B1', 'https://example.com/bafs/question-bank', 2, 0),
  ('BAFs App', 'Paper Pattern', 'description', '#FCE4EC', '#C2185B', 'https://example.com/bafs/paper-pattern', 2, 1),
  ('BAFs App', 'Exam Central',  'school',      '#FFF3E0', '#EF6C00', 'https://example.com/bafs/exam-central',  2, 2),

  -- By ECampus
  ('ECampus', 'Send',    'upload',              '#E3F2FD', '#1565C0', 'https://example.com/ecampus/send',    3, 0),
  ('ECampus', 'Receive', 'download',            '#E3F2FD', '#1565C0', 'https://example.com/ecampus/receive', 3, 1),
  ('ECampus', 'Redeem',  'confirmation_number', '#EDE7F6', '#5E35B1', 'https://example.com/ecampus/redeem',  3, 2),

  -- By Kalamandal
  ('Kalamandal', 'Register',    'person_add', '#FCE4EC', '#D81B60', 'https://example.com/kalamandal/register',    4, 0),
  ('Kalamandal', 'Talent Hunt', 'star',       '#FCE4EC', '#E53935', 'https://mohitmali5489.github.io/HUNT/',      4, 1),
  ('Kalamandal', 'Events',      'event',      '#FFF3E0', '#EF6C00', 'https://example.com/kalamandal/events',      4, 2);

-- ============================================================
-- After this, deploy the updated search.js and index.html.
-- Replace the example link_url values above with real ones (and
-- provider_user_id once those Page accounts exist) whenever you're
-- ready — this table is yours to edit freely, nothing else in the
-- app writes to it.
-- ============================================================
