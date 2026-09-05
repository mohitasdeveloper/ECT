-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE,
  student_id character varying NOT NULL UNIQUE,
  full_name text NOT NULL,
  course text,
  email text NOT NULL UNIQUE,
  mobile text,
  gender text,
  profile_img_url text DEFAULT 'https://t4.ftcdn.net/jpg/05/89/93/27/360_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.jpg'::text,
  tick_type text DEFAULT 'none'::text,
  role text DEFAULT 'student'::text,
  is_volunteer boolean DEFAULT false,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  joined_at timestamp with time zone DEFAULT now(),
  college text,
  bio text DEFAULT ''::text,
  social_links jsonb DEFAULT '{}'::jsonb,
  is_private boolean DEFAULT false,
  connection_count integer DEFAULT 0,
  special_post boolean DEFAULT false,
  fcm_token text,
  is_deleted boolean DEFAULT false,
  is_deactivated boolean DEFAULT false,
  mention_privacy text DEFAULT 'connections'::text CHECK (mention_privacy = ANY (ARRAY['connections'::text, 'none'::text])),
  push_settings jsonb DEFAULT '{}'::jsonb,
  verification_status text DEFAULT 'unverified'::text CHECK (verification_status = ANY (ARRAY['unverified'::text, 'pending'::text, 'verified'::text, 'rejected'::text])),
  custom_voters_list ARRAY DEFAULT '{}'::uuid[],
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.colleges (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL UNIQUE,
  is_verified boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT colleges_pkey PRIMARY KEY (id)
);
CREATE TABLE public.campus_updates (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  title text NOT NULL,
  content text,
  category text NOT NULL,
  author_name text DEFAULT 'Admin Office'::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT campus_updates_pkey PRIMARY KEY (id)
);
CREATE TABLE public.reports (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  reporter_id uuid NOT NULL,
  reported_user_id uuid,
  reason text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending_review'::text,
  created_at timestamp with time zone DEFAULT now(),
  reported_post_id uuid,
  CONSTRAINT reports_pkey PRIMARY KEY (id),
  CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id),
  CONSTRAINT reports_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES public.users(id)
);
CREATE TABLE public.connections (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_one_id uuid NOT NULL,
  user_two_id uuid NOT NULL,
  status text NOT NULL CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'blocked'::text])),
  action_user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT connections_pkey PRIMARY KEY (id),
  CONSTRAINT connections_user_one_id_fkey FOREIGN KEY (user_one_id) REFERENCES public.users(id),
  CONSTRAINT connections_user_two_id_fkey FOREIGN KEY (user_two_id) REFERENCES public.users(id),
  CONSTRAINT connections_action_user_id_fkey FOREIGN KEY (action_user_id) REFERENCES public.users(id)
);
CREATE TABLE public.hotposts (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  media_url text NOT NULL,
  media_type text DEFAULT 'image'::text,
  caption text,
  visibility text DEFAULT 'everyone'::text,
  created_at timestamp with time zone DEFAULT now(),
  is_deleted boolean DEFAULT false,
  allow_rewatch boolean DEFAULT false,
  CONSTRAINT hotposts_pkey PRIMARY KEY (id),
  CONSTRAINT hotposts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.hotpost_views (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  hotpost_id uuid NOT NULL,
  viewer_id uuid NOT NULL,
  viewed_at timestamp with time zone DEFAULT now(),
  is_deleted boolean DEFAULT false,
  CONSTRAINT hotpost_views_pkey PRIMARY KEY (id),
  CONSTRAINT hotpost_views_hotpost_id_fkey FOREIGN KEY (hotpost_id) REFERENCES public.hotposts(id),
  CONSTRAINT hotpost_views_viewer_id_fkey FOREIGN KEY (viewer_id) REFERENCES public.users(id)
);
CREATE TABLE public.hotpost_replies (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  hotpost_id uuid NOT NULL,
  replier_id uuid NOT NULL,
  author_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  is_deleted boolean DEFAULT false,
  CONSTRAINT hotpost_replies_pkey PRIMARY KEY (id),
  CONSTRAINT hotpost_replies_hotpost_id_fkey FOREIGN KEY (hotpost_id) REFERENCES public.hotposts(id),
  CONSTRAINT hotpost_replies_replier_id_fkey FOREIGN KEY (replier_id) REFERENCES public.users(id),
  CONSTRAINT hotpost_replies_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id)
);
CREATE TABLE public.hotpost_likes (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  hotpost_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  is_deleted boolean DEFAULT false,
  CONSTRAINT hotpost_likes_pkey PRIMARY KEY (id),
  CONSTRAINT hotpost_likes_hotpost_id_fkey FOREIGN KEY (hotpost_id) REFERENCES public.hotposts(id),
  CONSTRAINT hotpost_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  type text NOT NULL,
  message text,
  target_id uuid,
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT notifications_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id)
);
CREATE TABLE public.page_followers (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  page_id uuid NOT NULL,
  follower_id uuid NOT NULL,
  receive_notifications boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT page_followers_pkey PRIMARY KEY (id),
  CONSTRAINT page_followers_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.users(id),
  CONSTRAINT page_followers_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES public.users(id)
);
CREATE TABLE public.posts (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  post_type text NOT NULL CHECK (post_type = ANY (ARRAY['text'::text, 'image'::text, 'poll'::text, 'event'::text])),
  content text NOT NULL,
  media_url text,
  mentioned_user_ids ARRAY DEFAULT '{}'::uuid[],
  expires_at timestamp with time zone NOT NULL,
  viewers_access text NOT NULL DEFAULT 'all'::text CHECK (viewers_access = ANY (ARRAY['all'::text, 'connections'::text, 'selected'::text])),
  allowed_viewer_ids ARRAY DEFAULT '{}'::uuid[],
  is_verified boolean DEFAULT false,
  is_deleted boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  hide_likes boolean DEFAULT false,
  disable_comments boolean DEFAULT false,
  is_archived boolean DEFAULT false,
  is_anonymous boolean DEFAULT false,
  CONSTRAINT posts_pkey PRIMARY KEY (id),
  CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.post_polls (
  post_id uuid NOT NULL,
  options jsonb NOT NULL,
  is_multiple_choice boolean DEFAULT false,
  voters_access text NOT NULL DEFAULT 'all'::text CHECK (voters_access = ANY (ARRAY['all'::text, 'connections'::text, 'selected'::text])),
  allowed_voter_ids ARRAY DEFAULT '{}'::uuid[],
  voters_list_visibility text NOT NULL DEFAULT 'public'::text CHECK (voters_list_visibility = ANY (ARRAY['public'::text, 'hidden'::text])),
  deadline_type text NOT NULL DEFAULT 'time'::text CHECK (deadline_type = ANY (ARRAY['time'::text, 'voter_count'::text, 'selected_users_completion'::text])),
  deadline_time timestamp with time zone,
  deadline_count integer,
  can_undo_vote boolean DEFAULT false,
  is_ended_early boolean DEFAULT false,
  extra_info text,
  is_quiz boolean DEFAULT false,
  correct_option_id text,
  CONSTRAINT post_polls_pkey PRIMARY KEY (post_id),
  CONSTRAINT post_polls_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id)
);
CREATE TABLE public.post_poll_votes (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  post_id uuid NOT NULL,
  user_id uuid NOT NULL,
  option_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT post_poll_votes_pkey PRIMARY KEY (id),
  CONSTRAINT post_poll_votes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id),
  CONSTRAINT post_poll_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.post_events (
  post_id uuid NOT NULL,
  event_date timestamp with time zone NOT NULL,
  event_location text,
  event_image_url text,
  show_register_btn boolean DEFAULT false,
  register_url text,
  enable_rsvp boolean DEFAULT false,
  rsvp_list_visibility text NOT NULL DEFAULT 'public'::text CHECK (rsvp_list_visibility = ANY (ARRAY['public'::text, 'hidden'::text])),
  CONSTRAINT post_events_pkey PRIMARY KEY (post_id),
  CONSTRAINT post_events_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id)
);
CREATE TABLE public.post_event_rsvps (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  post_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL CHECK (status = ANY (ARRAY['attending'::text, 'maybe'::text])),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT post_event_rsvps_pkey PRIMARY KEY (id),
  CONSTRAINT post_event_rsvps_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id),
  CONSTRAINT post_event_rsvps_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.post_likes (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  post_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT post_likes_pkey PRIMARY KEY (id),
  CONSTRAINT post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id),
  CONSTRAINT post_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.post_comments (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  post_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  is_deleted boolean DEFAULT false,
  mentioned_user_ids ARRAY DEFAULT '{}'::uuid[],
  parent_comment_id uuid,
  CONSTRAINT post_comments_pkey PRIMARY KEY (id),
  CONSTRAINT post_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id),
  CONSTRAINT post_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT post_comments_parent_comment_id_fkey FOREIGN KEY (parent_comment_id) REFERENCES public.post_comments(id)
);
CREATE TABLE public.comment_likes (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  comment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT comment_likes_pkey PRIMARY KEY (id),
  CONSTRAINT comment_likes_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.post_comments(id),
  CONSTRAINT comment_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.saved_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  post_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT saved_posts_pkey PRIMARY KEY (id),
  CONSTRAINT saved_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT saved_posts_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id)
);
CREATE TABLE public.student_verifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE,
  legal_name text NOT NULL,
  student_id text NOT NULL,
  course text NOT NULL,
  id_card_url text NOT NULL,
  status text DEFAULT 'pending'::text,
  rejection_reason text,
  created_at timestamp with time zone DEFAULT now(),
  selfie_url text,
  CONSTRAINT student_verifications_pkey PRIMARY KEY (id),
  CONSTRAINT student_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.user_feedbacks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  type text NOT NULL CHECK (type = ANY (ARRAY['feedback'::text, 'issue'::text])),
  description text NOT NULL,
  media_url text,
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'resolved'::text])),
  admin_reply text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_feedbacks_pkey PRIMARY KEY (id),
  CONSTRAINT user_feedbacks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.page_services (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  icon_name text DEFAULT 'link'::text,
  open_in_app boolean DEFAULT true,
  is_active boolean DEFAULT true,
  order_index integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  description character varying,
  CONSTRAINT page_services_pkey PRIMARY KEY (id),
  CONSTRAINT page_services_page_id_fkey FOREIGN KEY (page_id) REFERENCES public.users(id)
);
CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL,
  receiver_id uuid NOT NULL,
  content text NOT NULL CHECK (char_length(btrim(content)) > 0),
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id),
  CONSTRAINT messages_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES public.users(id)
);

-- ============================================================
-- Row Level Security: messages
-- NOTE: sender_id/receiver_id reference public.users(id), which is
-- NOT the same id space as auth.uid() (that returns auth.users(id)).
-- Every policy below maps auth.uid() -> public.users.id via
-- public.users.auth_user_id before comparing, since a direct
-- "sender_id = auth.uid()" comparison would never match.
-- ============================================================
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- SELECT: only the sender or the receiver of a message can read it
CREATE POLICY "messages_select_participant" ON public.messages
FOR SELECT
USING (
  sender_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
  OR receiver_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
);

-- INSERT: only as yourself, and only to a user you have an accepted connection with
CREATE POLICY "messages_insert_connected_sender" ON public.messages
FOR INSERT
WITH CHECK (
  sender_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.connections c
    WHERE c.status = 'accepted'
      AND (
        (c.user_one_id = sender_id AND c.user_two_id = receiver_id)
        OR (c.user_one_id = receiver_id AND c.user_two_id = sender_id)
      )
  )
);

-- UPDATE: only the receiver can update a message (e.g. marking is_read)
CREATE POLICY "messages_update_receiver_only" ON public.messages
FOR UPDATE
USING (receiver_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid()))
WITH CHECK (receiver_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid()));
