-- ═══════════════════════════════════════════════════════════════════════════
-- 09 — Egress optimizations
--
-- Apply this in the Supabase SQL editor:  Database → SQL Editor → New query.
-- It is idempotent, so running it twice is safe.
--
-- Why: the app consumed 5 GB of egress in under a month with 2–3 active users.
-- The client-side cause (a full conversation-list refetch per realtime event)
-- is fixed in code — see docs/EGRESS_AUDIT.md. This file fixes the database
-- half, which cannot be changed from the repository:
--
--   1. `last_read_at` — read receipts become ONE row update instead of one per
--      unread message (each of which was broadcast to every client).
--   2. Denormalized `last_message*` maintained by trigger, so the chat list
--      never has to fetch message rows just to draw a one-line preview.
--   3. REPLICA IDENTITY: stop broadcasting whole rows (including the passcode
--      hash and FCM tokens in `users`) on every UPDATE.
--   4. Indexes for the hot paths.
--   5. Optional retention pruner for old messages.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Read marker ─────────────────────────────────────────────────────────
-- Unread is a comparison: conversations.last_message_at > my last_read_at.
-- One UPDATE per "I opened/read this chat" instead of one row per message.

-- Existing rows are stamped with the moment this runs, so history starts
-- "read" and nobody gets a fake 400-message unread badge.
ALTER TABLE public.conversation_participants
    ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ DEFAULT NOW();

-- The client updates ITS OWN row to say "I have read up to here". Without this
-- policy the UPDATE matches no policy, affects 0 rows, and returns no error —
-- the read marker would silently never move. (RLS is on for this table, and
-- 01_core_schema.sql only defined SELECT/INSERT/DELETE.)
DROP POLICY IF EXISTS "Participants can update their own membership" ON public.conversation_participants;
CREATE POLICY "Participants can update their own membership"
    ON public.conversation_participants
    FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_participants_user_last_read
    ON public.conversation_participants(user_id, last_read_at DESC);

-- Realtime: the client subscribes with `user_id=eq.<me>` and must also receive
-- DELETEs (a participant removed from a group). DEFAULT identity only carries
-- the primary key in the `old` record, so the server cannot evaluate the filter
-- for deletes. These rows are tiny and rarely written, so FULL is cheap here.
ALTER TABLE public.conversation_participants REPLICA IDENTITY FULL;


-- ── 2. `last_message*` is maintained by the database ───────────────────────
-- The chat list shows `last_message` / `last_message_at` / (for ticks) the
-- sender. Writers already set the first two; the trigger also covers edits,
-- deletes and direct SQL inserts, so the client never needs to re-read the
-- newest messages for every conversation.

ALTER TABLE public.conversations
    ADD COLUMN IF NOT EXISTS last_message_sender_id UUID;

CREATE OR REPLACE FUNCTION public.sync_conversation_last_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_conversation UUID;
    newest RECORD;
BEGIN
    target_conversation := COALESCE(NEW.conversation_id, OLD.conversation_id);
    IF target_conversation IS NULL THEN
        RETURN NULL;
    END IF;

    -- Fast path: a new (or edited) message that is not older than what the
    -- conversation already shows IS the newest one, so write it across without
    -- looking at the table. Appends are the hot path: no extra index scan.
    IF TG_OP <> 'DELETE' AND NEW.is_deleted = false THEN
        UPDATE public.conversations
           SET last_message = COALESCE(NEW.text,
                                       'Sent a ' || COALESCE(NEW.media_type, 'file')),
               last_message_at = NEW.created_at,
               last_message_sender_id = NEW.sender_id
         WHERE id = target_conversation
           AND (last_message_at IS NULL OR NEW.created_at >= last_message_at);
        IF FOUND THEN
            RETURN NULL;
        END IF;
    END IF;

    -- Slow path: a delete, a soft delete, or an edit of an older message. The
    -- preview has to be re-derived from what is left.
    SELECT m.text, m.media_type, m.created_at, m.sender_id, m.is_deleted
      INTO newest
      FROM public.messages m
     WHERE m.conversation_id = target_conversation
       AND m.is_deleted = false
     ORDER BY m.created_at DESC
     LIMIT 1;

    IF NOT FOUND THEN
        UPDATE public.conversations
           SET last_message = NULL,
               last_message_at = NULL,
               last_message_sender_id = NULL
         WHERE id = target_conversation;
    ELSE
        UPDATE public.conversations
           SET last_message = COALESCE(newest.text,
                                       'Sent a ' || COALESCE(newest.media_type, 'file')),
               last_message_at = newest.created_at,
               last_message_sender_id = newest.sender_id
         WHERE id = target_conversation;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_conversation_last_message ON public.messages;
CREATE TRIGGER trg_sync_conversation_last_message
    AFTER INSERT OR UPDATE OF text, media_type, is_deleted OR DELETE
    ON public.messages
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_conversation_last_message();

-- The fast path above needs no lookup at all; only edits/deletes of older
-- messages touch the index below, and they resolve it in one index scan.

CREATE INDEX IF NOT EXISTS idx_messages_conv_created
    ON public.messages(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at
    ON public.conversations(last_message_at DESC NULLS LAST);

-- Legacy path only (used until the client detects `last_read_at`).
CREATE INDEX IF NOT EXISTS idx_messages_unread
    ON public.messages(conversation_id)
    WHERE is_read = false;


-- ── 3. Stop broadcasting whole rows on UPDATE ──────────────────────────────
-- `REPLICA IDENTITY FULL` makes every UPDATE emit the complete OLD row and the
-- complete NEW row to every subscribed client. On `users` that payload includes
-- `settings`, `lock` (passcode hash!) and `fcm_tokens`. DEFAULT sends the new
-- row plus the primary key only — smaller, and no private columns on the wire.
--
-- `messages` is deliberately NOT in this list. `useChatMessages` listens for
-- DELETE events with a `conversation_id=eq.…` filter, and the filter column is
-- only present in the `old` record when the identity is FULL — with DEFAULT the
-- event cannot be matched and "delete for everyone" would stop propagating.
-- The read-marker change (section 1) is what removes messages UPDATE traffic;
-- deletes are rare, so FULL stays there.
--
-- `conversations`, `users` and `calls` are only ever read via `payload.new` on
-- the client (and a conversation DELETE also removes its participant rows, which
-- ARE FULL), so DEFAULT is safe for them. Calls are status-UPDATEd, never
-- deleted (`CallProvider` zombie sweep). The pair of `FULL` entries re-asserts
-- the two tables whose filtered DELETEs the client depends on, so this file
-- leaves the database correct no matter which earlier scripts were applied.

DO $$
DECLARE
    target RECORD;
BEGIN
    FOR target IN
        SELECT * FROM (VALUES
            ('users',                   'DEFAULT'),
            ('conversations',           'DEFAULT'),
            ('calls',                   'DEFAULT'),
            ('messages',                'FULL'),
            ('conversation_participants','FULL')
        ) AS t(tbl, identity)
    LOOP
        IF EXISTS (SELECT 1 FROM pg_class c
                     JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relname = target.tbl) THEN
            EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY %s',
                           target.tbl, target.identity);
        END IF;
    END LOOP;
END;
$$;


-- Advanced (optional, experimental): if messages UPDATE payloads ever matter
-- again, `ALTER TABLE public.messages REPLICA IDENTITY USING INDEX
-- messages_id_conversation_id_key;` (with a UNIQUE index on (id,
-- conversation_id)) makes the `old` record carry just those two columns. Verify
-- in the Realtime inspector that DELETE events still arrive before relying on
-- it.

-- ── 4. Unread counts without a per-message scan (optional, recommended) ────
-- Call:  supabase.rpc('get_unread_counts')
-- Returns one row per conversation with a badge, instead of one row per unread
-- message. `last_read_at` already removes the need; this is exact and cheap.

CREATE OR REPLACE FUNCTION public.get_unread_counts()
RETURNS TABLE (conversation_id UUID, unread_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT m.conversation_id, COUNT(*) AS unread_count
      FROM public.messages m
      JOIN public.conversation_participants cp
        ON cp.conversation_id = m.conversation_id
       AND cp.user_id = auth.uid()
     WHERE m.sender_id <> auth.uid()
       AND m.is_deleted = false
       AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
     GROUP BY m.conversation_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_unread_counts() TO authenticated;


-- ── 5. Retention (run when you want it — nothing calls it automatically) ───
-- Egress is paid on read, not on storage, but a smaller table keeps the
-- unread/latest queries from degrading. Deletes soft-deleted rows and anything
-- older than `keep_days` for conversations that are inactive.

CREATE OR REPLACE FUNCTION public.prune_old_messages(keep_days INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    removed INTEGER := 0;
    affected UUID[];
BEGIN
    SELECT array_agg(DISTINCT conversation_id) INTO affected
      FROM (
        SELECT m.conversation_id
          FROM public.messages m
          JOIN public.conversations c ON c.id = m.conversation_id
         WHERE m.created_at < NOW() - make_interval(days => keep_days)
           AND c.updated_at < NOW() - make_interval(days => keep_days)
         ORDER BY m.created_at
         LIMIT 5000
      ) t;

    IF affected IS NULL THEN
        RETURN 0;
    END IF;

    -- The per-row last_message trigger would fire once per deleted row (5000
    -- index scans); the last_message of these inactive conversations is
    -- recomputed in one pass below instead. DDL is transactional, so this rolls
    -- back with the function if anything fails.
    BEGIN
        ALTER TABLE public.messages DISABLE TRIGGER trg_sync_conversation_last_message;
    EXCEPTION WHEN OTHERS THEN
        NULL;  -- not the table owner; the trigger just stays on
    END;

    DELETE FROM public.messages m
     USING (
        SELECT m2.id
          FROM public.messages m2
          JOIN public.conversations c ON c.id = m2.conversation_id
         WHERE m2.created_at < NOW() - make_interval(days => keep_days)
           AND c.updated_at < NOW() - make_interval(days => keep_days)
         ORDER BY m2.created_at
         LIMIT 5000
     ) stale
     WHERE m.id = stale.id;

    GET DIAGNOSTICS removed = ROW_COUNT;

    BEGIN
        ALTER TABLE public.messages ENABLE TRIGGER trg_sync_conversation_last_message;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    UPDATE public.conversations c
       SET last_message = x.text,
           last_message_at = x.created_at,
           last_message_sender_id = x.sender_id
      FROM (
        SELECT DISTINCT ON (m.conversation_id)
               m.conversation_id, m.text, m.created_at, m.sender_id
          FROM public.messages m
         WHERE m.conversation_id = ANY(affected)
           AND m.is_deleted = false
         ORDER BY m.conversation_id, m.created_at DESC
      ) x
     WHERE c.id = x.conversation_id;

    RETURN removed;
END;
$$;

-- Example: keep the last 90 days.
--   SELECT public.prune_old_messages(90);
-- Scheduled (needs the pg_cron extension enabled in Dashboard → Database →
-- Extensions):
--   SELECT cron.schedule('prune-messages', '0 4 * * *', $$SELECT public.prune_old_messages(90)$$);


-- ── 5b. Optional hardening (commented out — read before enabling) ──────────
-- `conversation_participants` is readable by EVERY authenticated user
-- (`FOR SELECT USING (true)`), which leaks who-talks-to-whom, and `users` is
-- readable the same way, which leaks `email`, `phone`, `lock` (passcode hash!)
-- and `fcm_tokens` of every account. Neither is an egress bug, but both are
-- foundation mistakes worth closing. The membership check below needs a
-- SECURITY DEFINER helper: a policy on the table cannot query the same table
-- (Postgres raises "infinite recursion detected in policy").
--
-- CREATE OR REPLACE FUNCTION public.is_conversation_member(conv UUID, uid UUID)
-- RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
-- AS $$ SELECT EXISTS (SELECT 1 FROM public.conversation_participants
--                       WHERE conversation_id = conv AND user_id = uid); $$;
--
-- DROP POLICY IF EXISTS "Allow auth users to inspect participants"
--     ON public.conversation_participants;
-- CREATE POLICY "Members can inspect their conversations' participants"
--     ON public.conversation_participants FOR SELECT
--     USING (public.is_conversation_member(conversation_id, auth.uid()));
--
-- DROP POLICY IF EXISTS "Allow public read access on profiles" ON public.users;
-- CREATE POLICY "Profiles are readable, secrets are not" ON public.users
--     FOR SELECT USING (true);   -- plus a view/column grants, see
--                                -- docs/EGRESS_AUDIT.md §6.4


-- ── 6. Sanity check ────────────────────────────────────────────────────────
-- Run this afterwards; every row should read like the expected value.
SELECT 'conversation_participants.last_read_at' AS what,
       CASE WHEN COUNT(*) > 0 THEN 'OK' ELSE 'MISSING' END AS state
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'conversation_participants'
   AND column_name = 'last_read_at'
UNION ALL
SELECT 'conversations.last_message_sender_id',
       CASE WHEN COUNT(*) > 0 THEN 'OK' ELSE 'MISSING' END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'conversations'
   AND column_name = 'last_message_sender_id'
UNION ALL
SELECT 'replica identity: users',
       COALESCE((SELECT CASE WHEN c.relreplident = 'f' THEN 'STILL FULL' ELSE 'OK (default)' END
                   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = 'users'), 'MISSING')
UNION ALL
SELECT 'replica identity: conversations (expect default)',
       COALESCE((SELECT CASE WHEN c.relreplident = 'f' THEN 'STILL FULL' ELSE 'OK (default)' END
                   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = 'conversations'), 'MISSING')
UNION ALL
SELECT 'replica identity: messages (expect FULL)',
       COALESCE((SELECT CASE WHEN c.relreplident = 'f' THEN 'OK (full)' ELSE 'CHANGED - deletes will stop reaching clients' END
                   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = 'messages'), 'MISSING')
UNION ALL
SELECT 'sync trigger on messages',
       CASE WHEN COUNT(*) > 0 THEN 'OK' ELSE 'MISSING' END
  FROM pg_trigger
 WHERE tgname = 'trg_sync_conversation_last_message'
UNION ALL
SELECT 'UPDATE policy on conversation_participants',
       CASE WHEN COUNT(*) FILTER (WHERE cmd = 'UPDATE') > 0 THEN 'OK' ELSE 'MISSING' END
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'conversation_participants';
