-- ============================================================
-- Page-post / page-hotpost fan-out notifications.
-- Run this whole file in the Supabase SQL editor.
--
-- Why a trigger and not client-side code: a page account can have a lot of
-- followers, and fanning that out with a client-side loop of inserts is the
-- kind of thing that half-completes if the tab closes, the network blips, or
-- the app gets backgrounded mid-loop. A trigger runs once, server-side, as
-- part of the same transaction as the post/hotpost insert — either the whole
-- thing lands or none of it does.
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_page_followers()
RETURNS TRIGGER AS $$
DECLARE
    poster_role text;
    notif_type text;
BEGIN
    -- Only fan out for Page accounts — regular students' posts/hotposts use
    -- the connections system, not a one-way "followers" list, so there's no
    -- equivalent broadcast for them here.
    SELECT role INTO poster_role FROM public.users WHERE id = NEW.user_id;
    IF poster_role IS DISTINCT FROM 'page' THEN
        RETURN NEW;
    END IF;

    notif_type := CASE TG_TABLE_NAME
        WHEN 'posts' THEN 'page_new_post'
        WHEN 'hotposts' THEN 'page_new_hotpost'
    END;

    INSERT INTO public.notifications (user_id, sender_id, type, target_id)
    SELECT follower_id, NEW.user_id, notif_type, NEW.id
    FROM public.page_followers
    WHERE page_id = NEW.user_id
      AND receive_notifications = true
      AND follower_id != NEW.user_id; -- belt-and-suspenders; shouldn't happen, but never self-notify

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_notify_followers_on_post ON public.posts;
CREATE TRIGGER trg_notify_followers_on_post
    AFTER INSERT ON public.posts
    FOR EACH ROW EXECUTE FUNCTION public.notify_page_followers();

DROP TRIGGER IF EXISTS trg_notify_followers_on_hotpost ON public.hotposts;
CREATE TRIGGER trg_notify_followers_on_hotpost
    AFTER INSERT ON public.hotposts
    FOR EACH ROW EXECUTE FUNCTION public.notify_page_followers();

-- ============================================================
-- No client-side changes needed for this part — it's fully server-side.
-- ============================================================
