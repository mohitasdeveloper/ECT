-- ============================================================
-- Adds connection_request / connection_accepted notifications directly into
-- manage_connection, in the same transaction as the request/accept itself.
-- This REPLACES a client-side hook that fired createNotification() off this
-- function's return value from main.js — that hook has been removed from the
-- app now that this exists, so don't re-add it or connection actions will
-- create two notifications instead of one.
--
-- Run this whole file in the Supabase SQL editor. Only the 'request' and
-- 'accept' branches change — everything else in the function is untouched,
-- reproduced here only because CREATE OR REPLACE FUNCTION needs the full body.
-- ============================================================

CREATE OR REPLACE FUNCTION public.manage_connection(p_target_user_id uuid, p_action text)
RETURNS text AS $$
DECLARE
    v_current_user_id uuid;
    v_user_one_id uuid;
    v_user_two_id uuid;
    v_existing_status text;
    v_existing_action_user_id uuid;
BEGIN
    -- 1. Securely identify the current user making the request
    SELECT id INTO v_current_user_id FROM public.users WHERE auth_user_id = auth.uid();
    IF v_current_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF v_current_user_id = p_target_user_id THEN RAISE EXCEPTION 'Cannot perform action on yourself'; END IF;

    -- 2. Enforce the user_one_id < user_two_id rule for querying
    IF v_current_user_id < p_target_user_id THEN
        v_user_one_id := v_current_user_id;
        v_user_two_id := p_target_user_id;
    ELSE
        v_user_one_id := p_target_user_id;
        v_user_two_id := v_current_user_id;
    END IF;

    -- 3. Fetch existing connection state
    SELECT status, action_user_id INTO v_existing_status, v_existing_action_user_id
    FROM public.connections
    WHERE user_one_id = v_user_one_id AND user_two_id = v_user_two_id;

    -- 4. State Machine Logic
    IF p_action = 'request' THEN
        IF v_existing_status = 'blocked' THEN RAISE EXCEPTION 'Action not permitted'; END IF;
        IF v_existing_status = 'accepted' THEN RAISE EXCEPTION 'Already connected'; END IF;
        IF v_existing_status = 'pending' THEN RAISE EXCEPTION 'Request already exists'; END IF;
        
        INSERT INTO public.connections (user_one_id, user_two_id, status, action_user_id)
        VALUES (v_user_one_id, v_user_two_id, 'pending', v_current_user_id);

        -- 🚀 NEW: notify the target that a request came in, in the same
        -- transaction as the request itself.
        INSERT INTO public.notifications (user_id, sender_id, type)
        VALUES (p_target_user_id, v_current_user_id, 'connection_request');

        RETURN 'request_sent';

    ELSIF p_action = 'accept' THEN
        IF v_existing_status != 'pending' OR v_existing_action_user_id = v_current_user_id THEN
            RAISE EXCEPTION 'No valid request to accept';
        END IF;
        
        UPDATE public.connections 
        SET status = 'accepted', action_user_id = v_current_user_id, updated_at = now()
        WHERE user_one_id = v_user_one_id AND user_two_id = v_user_two_id;
        
        -- Increment connection counts
        UPDATE public.users SET connection_count = connection_count + 1 WHERE id IN (v_user_one_id, v_user_two_id);

        -- 🚀 NEW: notify the original requester (p_target_user_id here — the
        -- person whose earlier request v_current_user_id is now accepting)
        -- that their request was accepted.
        INSERT INTO public.notifications (user_id, sender_id, type)
        VALUES (p_target_user_id, v_current_user_id, 'connection_accepted');

        RETURN 'accepted';

    ELSIF p_action IN ('cancel', 'decline', 'unfriend') THEN
        IF v_existing_status IS NULL THEN RETURN 'success'; END IF;
        
        DELETE FROM public.connections WHERE user_one_id = v_user_one_id AND user_two_id = v_user_two_id;
        
        IF v_existing_status = 'accepted' THEN
            UPDATE public.users SET connection_count = GREATEST(0, connection_count - 1) WHERE id IN (v_user_one_id, v_user_two_id);
            RETURN 'unfriended';
        END IF;
        
        IF p_action = 'cancel' THEN RETURN 'cancelled'; END IF;
        RETURN 'declined';

    ELSIF p_action = 'block' THEN
        IF v_existing_status = 'accepted' THEN
            -- Decrement counts if they were previously friends
            UPDATE public.users SET connection_count = GREATEST(0, connection_count - 1) WHERE id IN (v_user_one_id, v_user_two_id);
        END IF;
        
        INSERT INTO public.connections (user_one_id, user_two_id, status, action_user_id)
        VALUES (v_user_one_id, v_user_two_id, 'blocked', v_current_user_id)
        ON CONFLICT (user_one_id, user_two_id) 
        DO UPDATE SET status = 'blocked', action_user_id = v_current_user_id, updated_at = now();
        RETURN 'blocked';

    ELSIF p_action = 'unblock' THEN
        IF v_existing_status != 'blocked' OR v_existing_action_user_id != v_current_user_id THEN
            RAISE EXCEPTION 'Cannot unblock';
        END IF;
        
        DELETE FROM public.connections WHERE user_one_id = v_user_one_id AND user_two_id = v_user_two_id;
        RETURN 'unblocked';
        
    ELSE
        RAISE EXCEPTION 'Invalid action';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
