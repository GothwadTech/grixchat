-- =========================================================================
-- STEP 1/9: GRIXCHAT CORE SCHEMA (users, chats, messages, calls, ...)
-- =========================================================================
-- Supabase Dashboard -> SQL Editor -> New query -> paste -> RUN.
-- Then continue with 02, 03, ... 09 in order (see 00_master_instructions.md).
--
-- SAFE TO RE-RUN, ON A FRESH PROJECT AND ON A LIVE ONE:
--   * nothing is dropped or truncated — no `DROP TABLE`, ever
--   * tables are created only if missing, missing columns/indexes/constraints
--     are added, policies are re-created so an updated definition replaces the
--     old one
--   * existing rows are never modified by this file
-- =========================================================================

-- 2. TABLES (created only if missing)

-- User Profiles (Integrated with auth.users)
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    email TEXT,
    phone TEXT,
    full_name TEXT,
    username TEXT UNIQUE NOT NULL,
    photo_url TEXT DEFAULT 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
    bio TEXT DEFAULT 'Available',
    is_verified BOOLEAN DEFAULT FALSE,
    profile_type TEXT DEFAULT 'personal',
    is_online BOOLEAN DEFAULT FALSE,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    settings JSONB DEFAULT '{}'::jsonb,
    lock JSONB DEFAULT NULL, -- Passcode lock hash & configuration
    blocked_users TEXT[] DEFAULT '{}'::text[],
    muted_users TEXT[] DEFAULT '{}'::text[],
    favorites TEXT[] DEFAULT '{}'::text[],
    hidden_chats TEXT[] DEFAULT '{}'::text[],
    archived_chats TEXT[] DEFAULT '{}'::text[],
    hidden_chat_settings JSONB DEFAULT '{"secretCode": null, "showMenuEntry": true}'::jsonb,
    fcm_tokens TEXT[] DEFAULT '{}'::text[],
    CONSTRAINT username_length_check CHECK (char_length(username) <= 15)
);

-- Connections / Followers / Friends
CREATE TABLE IF NOT EXISTS public.follows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    following_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT follows_unique_pair UNIQUE (follower_id, following_id)
);

-- Conversation Rooms (Direct & Group chats)
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL CHECK (type IN ('direct', 'group')),
    name TEXT,
    photo_url TEXT,
    admins UUID[] DEFAULT '{}'::uuid[],
    watch_video_url TEXT,
    watch_state JSONB DEFAULT '{}'::jsonb,
    last_message TEXT,
    last_message_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversation Roster / Members
CREATE TABLE IF NOT EXISTS public.conversation_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT conversation_participants_unique_pair UNIQUE (conversation_id, user_id)
);

-- Chat Messages
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
    sender_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    text TEXT,
    media_url TEXT,
    media_type TEXT,
    reply_to UUID REFERENCES public.messages(id) ON DELETE SET NULL,
    reactions JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT FALSE,
    is_edited BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_by UUID[] DEFAULT '{}'::UUID[], -- Tracks delete for me IDs
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stories & Status Updates 
CREATE TABLE IF NOT EXISTS public.stories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    media_url TEXT,
    type TEXT DEFAULT 'image', -- 'image', 'text', 'video'
    text_content TEXT,
    bg_color TEXT,
    music_title TEXT,
    music_artist TEXT,
    music_url TEXT,
    filter_applied TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Voice / Video Calls 
CREATE TABLE IF NOT EXISTS public.calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caller_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    receiver_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    type TEXT CHECK (type IN ('audio', 'video')) NOT NULL,
    status TEXT DEFAULT 'ringing' CHECK (status IN ('ringing', 'accepted', 'rejected', 'ended', 'error')),
    offer JSONB,
    answer JSONB,
    is_missed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- WebRTC ICE Candidates Signaling
CREATE TABLE IF NOT EXISTS public.call_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID REFERENCES public.calls(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    candidate JSONB NOT NULL,
    type TEXT NOT NULL, -- 'offer' or 'answer' candidate
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Personalized Chat Settings & Customizations
CREATE TABLE IF NOT EXISTS public.chat_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    receiver_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    nickname TEXT,
    custom_photo_url TEXT,
    is_muted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chat_settings_unique_pair UNIQUE (user_id, receiver_id)
);

-- System & Interaction Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    from_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT,
    content TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    post_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. COLUMN UPGRADES
-- ---------------------------------------------------------------------------
-- A project created from an older version of this file can be missing columns
-- that were added later. `ADD COLUMN IF NOT EXISTS` makes every install converge
-- on the same shape without touching a single existing row.
-- ---------------------------------------------------------------------------

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS full_name TEXT,
    ADD COLUMN IF NOT EXISTS username TEXT,
    ADD COLUMN IF NOT EXISTS photo_url TEXT DEFAULT 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
    ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT 'Available',
    ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS profile_type TEXT DEFAULT 'personal',
    ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS lock JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS blocked_users TEXT[] DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS muted_users TEXT[] DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS favorites TEXT[] DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS hidden_chats TEXT[] DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS archived_chats TEXT[] DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS hidden_chat_settings JSONB DEFAULT '{"secretCode": null, "showMenuEntry": true}'::jsonb,
    ADD COLUMN IF NOT EXISTS fcm_tokens TEXT[] DEFAULT '{}'::text[];

ALTER TABLE public.follows
    ADD COLUMN IF NOT EXISTS follower_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS following_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.conversations
    ADD COLUMN IF NOT EXISTS type TEXT,
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS photo_url TEXT,
    ADD COLUMN IF NOT EXISTS admins UUID[] DEFAULT '{}'::uuid[],
    ADD COLUMN IF NOT EXISTS watch_video_url TEXT,
    ADD COLUMN IF NOT EXISTS watch_state JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS last_message TEXT,
    ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.conversation_participants
    ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS sender_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS text TEXT,
    ADD COLUMN IF NOT EXISTS media_url TEXT,
    ADD COLUMN IF NOT EXISTS media_type TEXT,
    ADD COLUMN IF NOT EXISTS reply_to UUID REFERENCES public.messages(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reactions JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS deleted_by UUID[] DEFAULT '{}'::UUID[],
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.stories
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS media_url TEXT,
    ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'image',
    ADD COLUMN IF NOT EXISTS text_content TEXT,
    ADD COLUMN IF NOT EXISTS bg_color TEXT,
    ADD COLUMN IF NOT EXISTS music_title TEXT,
    ADD COLUMN IF NOT EXISTS music_artist TEXT,
    ADD COLUMN IF NOT EXISTS music_url TEXT,
    ADD COLUMN IF NOT EXISTS filter_applied TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.calls
    ADD COLUMN IF NOT EXISTS caller_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS receiver_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS type TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ringing',
    ADD COLUMN IF NOT EXISTS offer JSONB,
    ADD COLUMN IF NOT EXISTS answer JSONB,
    ADD COLUMN IF NOT EXISTS is_missed BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.call_candidates
    ADD COLUMN IF NOT EXISTS call_id UUID REFERENCES public.calls(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS candidate JSONB,
    ADD COLUMN IF NOT EXISTS type TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.chat_settings
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS receiver_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS nickname TEXT,
    ADD COLUMN IF NOT EXISTS custom_photo_url TEXT,
    ADD COLUMN IF NOT EXISTS is_muted BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS from_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS type TEXT,
    ADD COLUMN IF NOT EXISTS title TEXT,
    ADD COLUMN IF NOT EXISTS content TEXT,
    ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS post_id TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- NOT NULL is enforced only when the data already satisfies it, so an old table
-- with stray NULLs never makes this script abort.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE username IS NULL) THEN
        ALTER TABLE public.users ALTER COLUMN username SET NOT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.follows WHERE follower_id IS NULL OR following_id IS NULL) THEN
        ALTER TABLE public.follows ALTER COLUMN follower_id SET NOT NULL;
        ALTER TABLE public.follows ALTER COLUMN following_id SET NOT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.conversations WHERE type IS NULL) THEN
        ALTER TABLE public.conversations ALTER COLUMN type SET NOT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id IS NULL OR user_id IS NULL) THEN
        ALTER TABLE public.conversation_participants ALTER COLUMN conversation_id SET NOT NULL;
        ALTER TABLE public.conversation_participants ALTER COLUMN user_id SET NOT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.messages WHERE conversation_id IS NULL OR sender_id IS NULL) THEN
        ALTER TABLE public.messages ALTER COLUMN conversation_id SET NOT NULL;
        ALTER TABLE public.messages ALTER COLUMN sender_id SET NOT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.stories WHERE user_id IS NULL) THEN
        ALTER TABLE public.stories ALTER COLUMN user_id SET NOT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.calls WHERE caller_id IS NULL OR receiver_id IS NULL OR type IS NULL) THEN
        ALTER TABLE public.calls ALTER COLUMN caller_id SET NOT NULL;
        ALTER TABLE public.calls ALTER COLUMN receiver_id SET NOT NULL;
        ALTER TABLE public.calls ALTER COLUMN type SET NOT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.chat_settings WHERE user_id IS NULL OR receiver_id IS NULL) THEN
        ALTER TABLE public.chat_settings ALTER COLUMN user_id SET NOT NULL;
        ALTER TABLE public.chat_settings ALTER COLUMN receiver_id SET NOT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id IS NULL OR type IS NULL) THEN
        ALTER TABLE public.notifications ALTER COLUMN user_id SET NOT NULL;
        ALTER TABLE public.notifications ALTER COLUMN type SET NOT NULL;
    END IF;
END $$;

-- 4. CONSTRAINTS
-- Added only when absent; a duplicate row in an old table produces a NOTICE
-- (never an abort) so the rest of the script still runs.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'username_length_check'
                      AND conrelid = 'public.users'::regclass) THEN
        ALTER TABLE public.users ADD CONSTRAINT username_length_check CHECK (char_length(username) <= 15);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'follows_unique_pair'
                      AND conrelid = 'public.follows'::regclass) THEN
        ALTER TABLE public.follows ADD CONSTRAINT follows_unique_pair UNIQUE (follower_id, following_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'conversation_participants_unique_pair'
                      AND conrelid = 'public.conversation_participants'::regclass) THEN
        ALTER TABLE public.conversation_participants ADD CONSTRAINT conversation_participants_unique_pair UNIQUE (conversation_id, user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'chat_settings_unique_pair'
                      AND conrelid = 'public.chat_settings'::regclass) THEN
        ALTER TABLE public.chat_settings ADD CONSTRAINT chat_settings_unique_pair UNIQUE (user_id, receiver_id);
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Constraint skipped (%): existing rows violate it', SQLERRM;
END $$;

-- 5. ENABLE ROW LEVEL SECURITY (CORE PRIVACY)

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 6. RLS POLICIES (re-created on every run, so edits apply)

-- profiles
DROP POLICY IF EXISTS "Allow public read access on profiles" ON public.users;
CREATE POLICY "Allow public read access on profiles" ON public.users FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow users to update own profile" ON public.users;
CREATE POLICY "Allow users to update own profile" ON public.users FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Allow users to insert own profile" ON public.users;
CREATE POLICY "Allow users to insert own profile" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);

-- connections
DROP POLICY IF EXISTS "Allow users to view all follows" ON public.follows;
CREATE POLICY "Allow users to view all follows" ON public.follows FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow users to follow others" ON public.follows;
CREATE POLICY "Allow users to follow others" ON public.follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
DROP POLICY IF EXISTS "Allow users to unfollow others" ON public.follows;
CREATE POLICY "Allow users to unfollow others" ON public.follows FOR DELETE USING (auth.uid() = follower_id);

-- conversations
DROP POLICY IF EXISTS "Allow auth users to make conversations" ON public.conversations;
CREATE POLICY "Allow auth users to make conversations" ON public.conversations FOR INSERT WITH CHECK (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Allow members to see conversations" ON public.conversations;
CREATE POLICY "Allow members to see conversations" ON public.conversations FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.conversation_participants 
        WHERE conversation_participants.conversation_id = conversations.id 
          AND conversation_participants.user_id = auth.uid()
    )
);
DROP POLICY IF EXISTS "Allow participants to edit conversations" ON public.conversations;
CREATE POLICY "Allow participants to edit conversations" ON public.conversations FOR UPDATE USING (
    EXISTS (
        SELECT 1 FROM public.conversation_participants 
        WHERE conversation_participants.conversation_id = conversations.id 
          AND conversation_participants.user_id = auth.uid()
    )
);
DROP POLICY IF EXISTS "Allow participants to delete conversations" ON public.conversations;
CREATE POLICY "Allow participants to delete conversations" ON public.conversations FOR DELETE USING (
    EXISTS (
        SELECT 1 FROM public.conversation_participants 
        WHERE conversation_participants.conversation_id = conversations.id 
          AND conversation_participants.user_id = auth.uid()
    )
);

-- members
DROP POLICY IF EXISTS "Allow auth users to inspect participants" ON public.conversation_participants;
CREATE POLICY "Allow auth users to inspect participants" ON public.conversation_participants FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow members to join rooms" ON public.conversation_participants;
CREATE POLICY "Allow members to join rooms" ON public.conversation_participants FOR INSERT WITH CHECK (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Allow participants to leave rooms" ON public.conversation_participants;
CREATE POLICY "Allow participants to leave rooms" ON public.conversation_participants FOR DELETE USING (auth.role() = 'authenticated');

-- messages
DROP POLICY IF EXISTS "Allow conversation members to view messages" ON public.messages;
CREATE POLICY "Allow conversation members to view messages" ON public.messages FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.conversation_participants 
        WHERE conversation_participants.conversation_id = messages.conversation_id 
          AND conversation_participants.user_id = auth.uid()
    )
);
DROP POLICY IF EXISTS "Allow active members to insert messages" ON public.messages;
CREATE POLICY "Allow active members to insert messages" ON public.messages FOR INSERT WITH CHECK (
    auth.uid() = sender_id 
    AND EXISTS (
        SELECT 1 FROM public.conversation_participants 
        WHERE conversation_participants.conversation_id = messages.conversation_id 
          AND conversation_participants.user_id = auth.uid()
    )
);
DROP POLICY IF EXISTS "Allow participants to update messages" ON public.messages;
CREATE POLICY "Allow participants to update messages" ON public.messages FOR UPDATE USING (
    EXISTS (
        SELECT 1 FROM public.conversation_participants 
        WHERE conversation_participants.conversation_id = messages.conversation_id 
          AND conversation_participants.user_id = auth.uid()
    )
);
DROP POLICY IF EXISTS "Allow participants to delete messages" ON public.messages;
CREATE POLICY "Allow participants to delete messages" ON public.messages FOR DELETE USING (
    EXISTS (
        SELECT 1 FROM public.conversation_participants 
        WHERE conversation_participants.conversation_id = messages.conversation_id 
          AND conversation_participants.user_id = auth.uid()
    )
);

-- stories
DROP POLICY IF EXISTS "Allow auth users to view stories" ON public.stories;
CREATE POLICY "Allow auth users to view stories" ON public.stories FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Allow owners to publish stories" ON public.stories;
CREATE POLICY "Allow owners to publish stories" ON public.stories FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Allow owners to delete stories" ON public.stories;
CREATE POLICY "Allow owners to delete stories" ON public.stories FOR DELETE USING (auth.uid() = user_id);

-- calling
DROP POLICY IF EXISTS "Allow view access to call records" ON public.calls;
CREATE POLICY "Allow view access to call records" ON public.calls FOR SELECT USING (auth.uid() = caller_id OR auth.uid() = receiver_id);
DROP POLICY IF EXISTS "Allow calls insertion to caller" ON public.calls;
CREATE POLICY "Allow calls insertion to caller" ON public.calls FOR INSERT WITH CHECK (auth.uid() = caller_id);
DROP POLICY IF EXISTS "Allow call updates on participants" ON public.calls;
CREATE POLICY "Allow call updates on participants" ON public.calls FOR UPDATE USING (auth.uid() = caller_id OR auth.uid() = receiver_id);

-- signaling Candidates
DROP POLICY IF EXISTS "Allow select on candidates to call members" ON public.call_candidates;
CREATE POLICY "Allow select on candidates to call members" ON public.call_candidates FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.calls 
        WHERE calls.id = call_candidates.call_id 
          AND (calls.caller_id = auth.uid() OR calls.receiver_id = auth.uid())
    )
);
DROP POLICY IF EXISTS "Allow call participants to insert candidates" ON public.call_candidates;
CREATE POLICY "Allow call participants to insert candidates" ON public.call_candidates FOR INSERT WITH CHECK (
    auth.uid() = user_id 
    AND EXISTS (
        SELECT 1 FROM public.calls 
        WHERE calls.id = call_candidates.call_id 
          AND (calls.caller_id = auth.uid() OR calls.receiver_id = auth.uid())
    )
);

-- custom chat settings
DROP POLICY IF EXISTS "Allow users to read own chat settings" ON public.chat_settings;
CREATE POLICY "Allow users to read own chat settings" ON public.chat_settings FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Allow users to modify own chat settings" ON public.chat_settings;
CREATE POLICY "Allow users to modify own chat settings" ON public.chat_settings FOR ALL USING (auth.uid() = user_id);

-- user notifications
DROP POLICY IF EXISTS "Allow users to read own notifications" ON public.notifications;
CREATE POLICY "Allow users to read own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Allow auth users system to insert notifications" ON public.notifications;
CREATE POLICY "Allow auth users system to insert notifications" ON public.notifications FOR INSERT WITH CHECK (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Allow users to update own notifications" ON public.notifications;
CREATE POLICY "Allow users to update own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Allow users to delete own notifications" ON public.notifications;
CREATE POLICY "Allow users to delete own notifications" ON public.notifications FOR DELETE USING (auth.uid() = user_id);

-- 7. PERFORMANCE AND SEARCH INDEXES
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_participants_user ON public.conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_participants_conversation ON public.conversation_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_users_username_lowered ON public.users(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_follows_follower ON public.follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON public.follows(following_id);
CREATE INDEX IF NOT EXISTS idx_stories_user ON public.stories(user_id);
CREATE INDEX IF NOT EXISTS idx_calls_participants ON public.calls(caller_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_chat_settings_user ON public.chat_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);

-- Notification sound configuration
NOTIFY pgrst, 'reload schema';
