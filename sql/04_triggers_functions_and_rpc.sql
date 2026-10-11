-- =========================================================================
-- STEP 4/9: RPC FUNCTIONS, TRIGGERS & AUTH -> PROFILE AUTO-SYNC
-- =========================================================================
-- Run in the Supabase SQL Editor after 03_support_tickets_schema.sql.
-- Safe to re-run: the trigger and the functions are dropped and re-created, so
-- an updated definition always replaces the old one. No row is ever deleted.
-- (`DROP FUNCTION` cannot lose the trigger's target: the trigger is dropped
-- first, in the same run.)
-- =========================================================================

-- Clear existing Triggers & Functions
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_auth_user();
DROP FUNCTION IF EXISTS public.get_direct_conversation_id(UUID, UUID);

-- 1. Direct Conversation Match RPC (Guarantees Instant Room Lookups)
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


-- 2. Auth to Public user profiles sync (Essential for Signup and OAuth sign-in)
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

-- Clear Schema cache
NOTIFY pgrst, 'reload schema';
