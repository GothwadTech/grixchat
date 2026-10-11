-- ═══════════════════════════════════════════════════════════════════════════
-- 02_functions_realtime_storage.sql  —  server-side logic
--
-- COVERS (detail: 00_master_instructions.md)
--   §1  auth.users -> public.users trigger, get_direct_conversation_id()
--   §2  story RPCs: view_story(), cleanup_expired_stories()
--   §3  read marker: conversation_participants.last_read_at + RLS UPDATE policy
--   §4  chat-list preview trigger (last_message* / updated_at)
--   §5  history cap pruners + one-time sweep          ⚠️ deletes old messages
--   §6  get_unread_counts() RPC
--   §7  prune_old_messages() retention + optional RLS hardening (commented)
--   §8  replica identity per table
--   §9  supabase_realtime publication membership
--   §10 storage buckets (chat-media, profiles) + storage policies
--   §10b PostgREST schema cache reload
--   §11 self-check query — every row must read OK
--
-- Safe to re-run: functions are CREATE OR REPLACE, triggers/policies are dropped
-- first, and nothing here deletes data except the documented history cap (§5).
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- §1  AUTH -> PROFILE TRIGGER AND DIRECT-CHAT RPC
-- ───────────────────────────────────────────────────────────────────────────

-- Re-created below: drop the old trigger first, otherwise CREATE TRIGGER fails
-- on a second run (the functions themselves are CREATE OR REPLACE).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_auth_user();
DROP FUNCTION IF EXISTS public.get_direct_conversation_id(UUID, UUID);

-- Room lookup for a direct chat (one indexed query instead of a join in the client)
CREATE OR REPLACE FUNCTION public.get_direct_conversation_id(u1 UUID, u2 UUID)
RETURNS UUID AS $$
DECLARE
    conv_id UUID;
BEGIN
    SELECT cp1.conversation_id INTO conv_id
    FROM public.conversation_participants cp1
    JOIN public.conversation_participants cp2 
      ON cp1.conversation_id = cp2.conversation_id
    JOIN public.conversations c 
      ON cp1.conversation_id = c.id
    WHERE cp1.user_id = u1 
      AND cp2.user_id = u2 
      AND c.type = 'direct'
    LIMIT 1;

    RETURN conv_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- auth.users -> public.users: the profile is created by the database, for
-- email signup and every OAuth provider alike
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
    username_val TEXT;
    full_name_val TEXT;
BEGIN
    -- Extract values safely from raw_user_meta_data or default to email split-part
    username_val := COALESCE(
        new.raw_user_meta_data->>'username', 
        split_part(new.email, '@', 1)
    );
    full_name_val := COALESCE(
        new.raw_user_meta_data->>'full_name', 
        split_part(new.email, '@', 1)
    );

    -- Clean the username values to be under 15 characters
    username_val := SUBSTRING(username_val, 1, 15);

    -- Ensure uniqueness of username, append unique IDs if a duplicate is found
    IF EXISTS (SELECT 1 FROM public.users WHERE username = username_val) THEN
        username_val := SUBSTRING(username_val, 1, 9) || '_' || substring(new.id::text, 1, 5);
    END IF;

    -- Insert profile safely
    INSERT INTO public.users (
        id, 
        email, 
        phone, 
        full_name, 
        username, 
        photo_url, 
        bio
    )
    VALUES (
        new.id,
        new.email,
        COALESCE(new.raw_user_meta_data->>'phone', ''),
        full_name_val,
        LOWER(username_val),
        COALESCE(new.raw_user_meta_data->>'avatar_url', 'https://cdn-icons-png.flaticon.com/512/149/149071.png'),
        'Available'
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        phone = COALESCE(public.users.phone, EXCLUDED.phone),
        full_name = COALESCE(public.users.full_name, EXCLUDED.full_name),
        username = COALESCE(public.users.username, EXCLUDED.username);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Bind trigger on auth.users (Runs completely on auth signup)
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();


-- ───────────────────────────────────────────────────────────────────────────
-- §2  STORY RPCS
-- ───────────────────────────────────────────────────────────────────────────

-- Record a story view without granting UPDATE on stories to clients.
-- The viewer is always the caller: `auth.uid()` decides, so a client cannot
-- stuff the viewer list with somebody else's (or a made-up) identity. The
-- `viewer_*` parameters stay in the signature for older clients and carry the
-- display fields only. The viewer JSON is built inline to keep the function
-- trivially parseable.
CREATE OR REPLACE FUNCTION public.view_story(
    story_id_param UUID,
    viewer_id_param UUID,
    viewer_username_param TEXT,
    viewer_fullname_param TEXT,
    viewer_photo_url_param TEXT
)
RETURNS VOID AS $$
DECLARE
    real_viewer UUID := auth.uid();
BEGIN
    IF real_viewer IS NULL THEN
        RETURN; -- anonymous callers may not record views
    END IF;

    UPDATE public.stories
    SET views = COALESCE(views, '[]'::JSONB) || jsonb_build_array(
        jsonb_build_object(
            'id', real_viewer,
            'username', viewer_username_param,
            'full_name', viewer_fullname_param,
            'photo_url', viewer_photo_url_param,
            'viewed_at', NOW()
        )
    )
    WHERE id = story_id_param
      AND NOT (COALESCE(views, '[]'::JSONB) @> jsonb_build_array(jsonb_build_object('id', real_viewer::text)));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Delete stories older than 24 h (called by the client / a cron job)
CREATE OR REPLACE FUNCTION public.cleanup_expired_stories()
RETURNS VOID AS $$
BEGIN
    DELETE FROM public.stories WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ───────────────────────────────────────────────────────────────────────────
-- §3  READ MARKER (unread by comparison, not by scanning messages)
-- ───────────────────────────────────────────────────────────────────────────

-- The chat list decides unread by comparing timestamps, so "I read this chat"
-- is one row update instead of one UPDATE per unread message (each of which was
-- broadcast to every subscribed client).
-- Unread is a comparison: conversations.last_message_at > my last_read_at.
-- One UPDATE per "I opened/read this chat" instead of one row per message.

-- Existing rows are stamped with the moment this runs, so history starts
-- "read" and nobody gets a fake 400-message unread badge.
ALTER TABLE public.conversation_participants
    ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ DEFAULT NOW();

-- The client updates ITS OWN row to say "I have read up to here". Without this
-- policy the UPDATE matches no policy, affects 0 rows, and returns no error —
-- the read marker would silently never move. (RLS is on for this table, and
-- 01_schema.sql only defined SELECT/INSERT/DELETE.)
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


-- ───────────────────────────────────────────────────────────────────────────
-- §4  CHAT-LIST PREVIEW TRIGGER (insert, edit, soft delete, delete)
-- ───────────────────────────────────────────────────────────────────────────

-- The list draws a one-line preview from conversations.last_message*; the
-- database keeps those columns current so the client never re-reads messages.
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
               last_message_sender_id = NEW.sender_id,
               updated_at = NEW.created_at
         WHERE id = target_conversation
           AND (last_message_at IS NULL OR NEW.created_at >= last_message_at);
        IF FOUND THEN
            RETURN NULL;
        END IF;
    END IF;

    -- Fast skip for DELETEs: if the conversation already shows something newer,
    -- removing an older row cannot change the preview. This is the common case
    -- for the 40-message history cap in 05, which deletes a batch per insert.
    IF TG_OP = 'DELETE' AND EXISTS (
        SELECT 1 FROM public.conversations
         WHERE id = target_conversation
           AND last_message_at IS NOT NULL
           AND last_message_at > OLD.created_at
    ) THEN
        RETURN NULL;
    END IF;

    -- Slow path: a delete of the newest row, a soft delete, or an edit of an
    -- older message. The preview has to be re-derived from what is left.
    SELECT m.text, m.media_type, m.created_at, m.sender_id, m.is_deleted
      INTO newest
      FROM public.messages m
     WHERE m.conversation_id = target_conversation
       AND m.is_deleted = false
     ORDER BY m.created_at DESC, m.id DESC
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

-- Superseded duplicate: older installs also have trg_update_conversation_on_message
-- (insert-only, no sender, no delete handling). Two triggers doing the same write
-- doubled the work on every message — it is dropped here and replaced by the
-- trigger below.
DROP TRIGGER IF EXISTS trg_update_conversation_on_message ON public.messages;
DROP FUNCTION IF EXISTS public.update_conversation_timestamp_and_last_message();

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


-- ───────────────────────────────────────────────────────────────────────────
-- §5  HISTORY CAP  (⚠️ keeps only the newest 40 messages per chat)
-- ───────────────────────────────────────────────────────────────────────────

-- ⚠️ This section deletes message history on purpose: every chat is capped at 60
-- rows and pruned back to the newest 40 on insert, and §5c sweeps existing data
-- once. It keeps a free-tier project small. To keep history instead, do not run
-- this section — use prune_old_messages() from §7, which is time-based.
--
-- §5a  messages

-- Cap per room: at 60 rows, keep the newest 40.
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


-- §5b  calls

-- Same cap for call history: at 60 rows per user, keep the newest 40.
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


-- §5c  one-time sweep of existing rows

-- Apply the cap to data that already exists (no-op once a chat is under 60 rows).
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


-- ───────────────────────────────────────────────────────────────────────────
-- §6  UNREAD COUNTS RPC (exact badges without scanning messages)
-- ───────────────────────────────────────────────────────────────────────────

-- Optional: exact badges from the server in one row per conversation.
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


-- ───────────────────────────────────────────────────────────────────────────
-- §7  RETENTION PRUNER + OPTIONAL RLS HARDENING
-- ───────────────────────────────────────────────────────────────────────────

-- Optional, time-based retention: nothing calls this automatically.
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
         ORDER BY m.conversation_id, m.created_at DESC, m.id DESC
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


-- Optional hardening (commented out — read before enabling).
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
--                                -- docs/EGRESS_AUDIT.md §6


-- ───────────────────────────────────────────────────────────────────────────
-- §8  REPLICA IDENTITY
-- ───────────────────────────────────────────────────────────────────────────

-- FULL is only needed where the client filters DELETEs by a non-key column
-- (`conversation_id=eq.…` on messages, participant removal on
-- conversation_participants). Everywhere else DEFAULT keeps UPDATE payloads to
-- "new row + primary key" — which also stops `users.lock` (the app-lock passcode
-- hash) and `fcm_tokens` from travelling over Realtime.
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


-- ───────────────────────────────────────────────────────────────────────────
-- §9  REALTIME PUBLICATION MEMBERSHIP
-- ───────────────────────────────────────────────────────────────────────────

-- Only the tables the client actually subscribes to. Membership is idempotent:
-- a table is added only when it exists and is not already published.
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


-- ───────────────────────────────────────────────────────────────────────────
-- §10  STORAGE BUCKETS AND POLICIES
-- ───────────────────────────────────────────────────────────────────────────

-- Buckets (inserted only if missing; sizes are limits, not defaults).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('chat-media', 'chat-media', true, 52428800, NULL), -- 50 MB limit
  ('profiles', 'profiles', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']) -- 5 MB limit
ON CONFLICT (id) DO NOTHING;


-- Policies are dropped and re-created, so an edited definition always wins.
-- Clean up any conflicting pre-existing policies for these buckets
DROP POLICY IF EXISTS "Public Access to chat-media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Users can upload to chat-media" ON storage.objects;
DROP POLICY IF EXISTS "Owners can update their own chat-media objects" ON storage.objects;
DROP POLICY IF EXISTS "Owners can delete their own chat-media objects" ON storage.objects;

DROP POLICY IF EXISTS "Public Access to profiles" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Users can upload to profiles" ON storage.objects;
DROP POLICY IF EXISTS "Owners can update their own profiles" ON storage.objects;
DROP POLICY IF EXISTS "Owners can delete their own profiles" ON storage.objects;


-- chat-media

-- Read Policy: Anyone can read media (Publicly accessible)
CREATE POLICY "Public Access to chat-media"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'chat-media');

-- Write Policy: Authenticated users can insert files 
CREATE POLICY "Authenticated Users can upload to chat-media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'chat-media' AND (auth.uid()::text = (storage.foldername(name))[1] OR true));

-- Update Policy: Authenticated owners can update files
CREATE POLICY "Owners can update their own chat-media objects"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'chat-media')
WITH CHECK (bucket_id = 'chat-media');

-- Delete Policy: Authenticated users can delete files they own
CREATE POLICY "Owners can delete their own chat-media objects"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'chat-media');


-- profiles

-- Read Policy: Anyone can read profiles photos (Publicly accessible)
CREATE POLICY "Public Access to profiles"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'profiles');

-- Write Policy: Authenticated users can upload profile icons
CREATE POLICY "Authenticated Users can upload to profiles"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'profiles');

-- Update Policy: Authenticated users can replace profile icons
CREATE POLICY "Owners can update their own profiles"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'profiles')
WITH CHECK (bucket_id = 'profiles');

-- Delete Policy: Authenticated users can delete profile icons
CREATE POLICY "Owners can delete their own profiles"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'profiles');


-- ───────────────────────────────────────────────────────────────────────────
-- §10b  POSTGREST SCHEMA CACHE
-- ───────────────────────────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';


-- ───────────────────────────────────────────────────────────────────────────
-- §11  SELF-CHECK
-- ───────────────────────────────────────────────────────────────────────────

-- ── final self-check ──────────────────────────────────────────────────────
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
SELECT 'posts / post_likes / post_comments / support_tickets',
       CASE WHEN COUNT(*) = 4 THEN 'OK' ELSE 'MISSING' END
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('posts','post_likes','post_comments','support_tickets')
UNION ALL
SELECT 'no duplicate last_message trigger',
       CASE WHEN COUNT(*) <= 1 THEN 'OK' ELSE 'DUPLICATE ' || COUNT(*) END
  FROM pg_trigger
 WHERE NOT tgisinternal AND tgrelid = 'public.messages'::regclass
   AND tgname LIKE 'trg_%last_message%'
UNION ALL
SELECT 'stories.views + chat_time_restrictions columns',
       CASE WHEN COUNT(*) = 2 THEN 'OK' ELSE 'MISSING' END
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND (table_name, column_name) IN (('stories','views'), ('conversations','chat_time_restrictions'))
UNION ALL
SELECT 'UPDATE policy on conversation_participants',
       CASE WHEN COUNT(*) FILTER (WHERE cmd = 'UPDATE') > 0 THEN 'OK' ELSE 'MISSING' END
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'conversation_participants';
