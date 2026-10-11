-- =========================================================================
-- STEP 5/9: REALTIME PUBLICATION, PREVIEW TRIGGERS, HISTORY CAP
-- =========================================================================
-- Run in the Supabase SQL Editor after 04_triggers_functions_and_rpc.sql.
-- Safe to re-run: functions are CREATE OR REPLACE, triggers are dropped first,
-- replica identity and publication membership are re-asserted.
--
-- ⚠️ READ THIS BEFORE RUNNING — sections 1 and 6 DELETE MESSAGE HISTORY:
--   every chat is capped at 60 rows, pruned back to the newest 40, on every
--   insert. It keeps a free-tier project small, but it also means chat history
--   is not kept. To keep history instead: do NOT run sections 1 and 6, and use
--   the time-based pruner in 09_egress_optimizations.sql (`prune_old_messages`).
-- =========================================================================

-- 1. MESSAGE CAP PRUNER (LIMITS ROOMS TO LAST 60 MESSAGES - PRUNES TO 40)
CREATE OR REPLACE FUNCTION prune_past_messages()
RETURNS TRIGGER AS $$
DECLARE
    msg_count INT;
BEGIN
    SELECT COUNT(*) INTO msg_count 
    FROM public.messages 
    WHERE conversation_id = NEW.conversation_id;

    IF msg_count >= 60 THEN
        DELETE FROM public.messages
        WHERE conversation_id = NEW.conversation_id
          AND id NOT IN (
              SELECT subquery.id FROM (
                  SELECT id FROM public.messages
                  WHERE conversation_id = NEW.conversation_id
                  ORDER BY created_at DESC, id DESC
                  LIMIT 40
              ) subquery
          );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_prune_past_messages ON public.messages;
CREATE TRIGGER trg_prune_past_messages
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION prune_past_messages();


-- 2. AUTOMATICALLY SYNC NEW MESSAGES WITH CONVERSATIONS PREVIEWS
CREATE OR REPLACE FUNCTION update_conversation_timestamp_and_last_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.conversations
    SET 
        updated_at = NEW.created_at,
        last_message = COALESCE(NEW.text, CASE WHEN NEW.media_type IS NOT NULL THEN 'Sent a ' || NEW.media_type ELSE 'Sent an attachment' END),
        last_message_at = NEW.created_at
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_conversation_on_message ON public.messages;
CREATE TRIGGER trg_update_conversation_on_message
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_timestamp_and_last_message();


-- 3. INTERACTIVE CALLS RECUPERATOR PRUNER (LIMITS CHRONO CALLS TO LAST 60)
CREATE OR REPLACE FUNCTION prune_past_calls()
RETURNS TRIGGER AS $$
DECLARE
    caller_call_count INT;
    receiver_call_count INT;
BEGIN
    SELECT COUNT(*) INTO caller_call_count 
    FROM public.calls 
    WHERE caller_id = NEW.caller_id OR receiver_id = NEW.caller_id;

    IF caller_call_count >= 60 THEN
        DELETE FROM public.calls
        WHERE (caller_id = NEW.caller_id OR receiver_id = NEW.caller_id)
          AND id NOT IN (
              SELECT subquery.id FROM (
                  SELECT id FROM public.calls
                  WHERE caller_id = NEW.caller_id OR receiver_id = NEW.caller_id
                  ORDER BY created_at DESC, id DESC
                  LIMIT 40
              ) subquery
          );
    END IF;

    IF NEW.receiver_id IS NOT NULL AND NEW.receiver_id <> NEW.caller_id THEN
        SELECT COUNT(*) INTO receiver_call_count 
        FROM public.calls 
        WHERE caller_id = NEW.receiver_id OR receiver_id = NEW.receiver_id;

        IF receiver_call_count >= 60 THEN
            DELETE FROM public.calls
            WHERE (caller_id = NEW.receiver_id OR receiver_id = NEW.receiver_id)
              AND id NOT IN (
                  SELECT subquery.id FROM (
                      SELECT id FROM public.calls
                      WHERE caller_id = NEW.receiver_id OR receiver_id = NEW.receiver_id
                      ORDER BY created_at DESC, id DESC
                      LIMIT 40
                  ) subquery
              );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_prune_past_calls ON public.calls;
CREATE TRIGGER trg_prune_past_calls
AFTER INSERT ON public.calls
FOR EACH ROW
EXECUTE FUNCTION prune_past_calls();


-- 4. REPLICA IDENTITY
-- ---------------------------------------------------------------------------
-- FULL is only needed where the client filters DELETEs by a non-key column
-- (`conversation_id=eq.…` on messages and conversation_participants). Everywhere
-- else DEFAULT keeps UPDATE payloads to "new row + primary key", which stops
-- whole rows — including `users.lock`, the app-lock passcode hash, and
-- `fcm_tokens` — from being broadcast to every subscribed client.
-- 09_egress_optimizations.sql re-asserts the same values, so either file leaves
-- the database in this state.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    target RECORD;
BEGIN
    FOR target IN
        SELECT * FROM (VALUES
            ('users',                    'DEFAULT'),
            ('conversations',            'DEFAULT'),
            ('calls',                    'DEFAULT'),
            ('call_candidates',          'DEFAULT'),
            ('messages',                 'FULL'),
            ('conversation_participants','FULL')
        ) AS t(tbl, identity)
    LOOP
        IF EXISTS (SELECT 1 FROM pg_class c
                     JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relname = target.tbl) THEN
            EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY %s', target.tbl, target.identity);
        END IF;
    END LOOP;
END;
$$;


-- 5. SUPABASE REALTIME PUBLICATION MEMBERSHIP
-- ---------------------------------------------------------------------------
-- Only the tables the client actually subscribes to. Membership is idempotent:
-- a table is added only when it exists and is not already published, so a run
-- over an existing project changes nothing and a fork that dropped a table
-- (e.g. call_candidates) does not abort the script.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    tbl TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;

    FOREACH tbl IN ARRAY ARRAY[
        'messages', 'conversations', 'users', 'calls',
        'call_candidates', 'conversation_participants'
    ] LOOP
        IF to_regclass('public.' || tbl) IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                            WHERE pubname = 'supabase_realtime'
                              AND schemaname = 'public'
                              AND tablename = tbl) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
        END IF;
    END LOOP;
END;
$$;

-- Also enable Realtime in the dashboard for these tables:
--   Database -> Replication -> supabase_realtime
-- The SQL above registers the tables; the dashboard toggle is what actually
-- streams them.


-- 6. RETROACTIVE SWEEP (trims pre-existing high-volume tables down to 40 rows)
-- Same policy as section 1: it keeps the newest 40 messages per chat and the
-- newest 40 calls per user. Skip this section if you skipped section 1.
DO $$
DECLARE
    u_rec RECORD;
    conv_rec RECORD;
BEGIN
    -- Prune existing calls back to newest 40 for every user
    FOR u_rec IN (SELECT DISTINCT id FROM public.users) LOOP
        DELETE FROM public.calls
        WHERE (caller_id = u_rec.id OR receiver_id = u_rec.id)
          AND id NOT IN (
              SELECT subquery.id FROM (
                  SELECT id FROM public.calls
                  WHERE caller_id = u_rec.id OR receiver_id = u_rec.id
                  ORDER BY created_at DESC, id DESC
                  LIMIT 40
              ) subquery
          );
    END LOOP;

    -- Prune existing messages back to newest 40 for every conversation room
    FOR conv_rec IN (SELECT DISTINCT id FROM public.conversations) LOOP
        DELETE FROM public.messages
        WHERE conversation_id = conv_rec.id
          AND id NOT IN (
              SELECT subquery.id FROM (
                  SELECT id FROM public.messages
                  WHERE conversation_id = conv_rec.id
                  ORDER BY created_at DESC, id DESC
                  LIMIT 40
              ) subquery
          );
    END LOOP;
END;
$$;

-- Reload Schema and notify PostgREST
NOTIFY pgrst, 'reload schema';
