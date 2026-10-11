-- =========================================================================
-- STEP 2/9: POSTS, LIKES AND COMMENTS
-- =========================================================================
-- Run in the Supabase SQL Editor after 01_core_schema.sql.
-- Safe to re-run: nothing is dropped, missing tables/columns/policies are
-- created, existing rows are untouched.
-- =========================================================================

-- 1. Create Posts Table
CREATE TABLE IF NOT EXISTS public.posts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    caption TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS for public.posts
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- Post Policies
DROP POLICY IF EXISTS "Allow public read access for posts" ON public.posts;
CREATE POLICY "Allow public read access for posts" ON public.posts FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert for posts" ON public.posts;
CREATE POLICY "Allow authenticated insert for posts" ON public.posts FOR INSERT 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow users to delete their own posts" ON public.posts;
CREATE POLICY "Allow users to delete their own posts" ON public.posts FOR DELETE 
USING (auth.uid() = user_id);


-- 2. Create Post Likes Table (Tracking active likes)
CREATE TABLE IF NOT EXISTS public.post_likes (
    post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (post_id, user_id)
);

-- Enable RLS for public.post_likes
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;

-- Post Likes Policies
DROP POLICY IF EXISTS "Allow public read access for post likes" ON public.post_likes;
CREATE POLICY "Allow public read access for post likes" ON public.post_likes FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert for post likes" ON public.post_likes;
CREATE POLICY "Allow authenticated insert for post likes" ON public.post_likes FOR INSERT 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow users to remove their likes" ON public.post_likes;
CREATE POLICY "Allow users to remove their likes" ON public.post_likes FOR DELETE 
USING (auth.uid() = user_id);


-- 3. Create Post Comments Table
CREATE TABLE IF NOT EXISTS public.post_comments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS for public.post_comments
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

-- Post Comments Policies
DROP POLICY IF EXISTS "Allow public read access for post comments" ON public.post_comments;
CREATE POLICY "Allow public read access for post comments" ON public.post_comments FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert for post comments" ON public.post_comments;
CREATE POLICY "Allow authenticated insert for post comments" ON public.post_comments FOR INSERT 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow users to delete their own comments" ON public.post_comments;
CREATE POLICY "Allow users to delete their own comments" ON public.post_comments FOR DELETE 
USING (auth.uid() = user_id);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON public.posts(user_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON public.post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON public.post_comments(post_id);

-- Column upgrades: a project created from an older version of this file may be
-- missing columns added later. No existing row is touched.
ALTER TABLE public.posts
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS image_url TEXT,
    ADD COLUMN IF NOT EXISTS caption TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());

ALTER TABLE public.post_likes
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());

ALTER TABLE public.post_comments
    ADD COLUMN IF NOT EXISTS post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS text TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());

-- Primary key of post_likes is (post_id, user_id); add it only if it is absent.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'post_likes_pkey'
                      AND conrelid = 'public.post_likes'::regclass) THEN
        ALTER TABLE public.post_likes ADD CONSTRAINT post_likes_pkey PRIMARY KEY (post_id, user_id);
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'post_likes primary key skipped: %', SQLERRM;
END $$;

-- Reload Schema
NOTIFY pgrst, 'reload schema';
