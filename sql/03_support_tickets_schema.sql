-- =========================================================================
-- STEP 3/9: SUPPORT TICKETS
-- =========================================================================
-- Run in the Supabase SQL Editor after 02_posts_and_interactions_schema.sql.
-- Safe to re-run: nothing is dropped, existing tickets are kept.
-- =========================================================================

-- Create support tickets Table
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    category TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Column upgrades for older installs (no existing row is touched).
ALTER TABLE public.support_tickets
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS category TEXT,
    ADD COLUMN IF NOT EXISTS subject TEXT,
    ADD COLUMN IF NOT EXISTS message TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Enable Row Level Security (RLS)
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- 1. Anonymous and Authenticated submittals
DROP POLICY IF EXISTS "Allow anonymous and authenticated ticket insertion" ON public.support_tickets;
CREATE POLICY "Allow anonymous and authenticated ticket insertion" ON public.support_tickets 
    FOR INSERT 
    WITH CHECK (true);

-- 2. Fetch logged tickets
DROP POLICY IF EXISTS "Allow users to view own tickets" ON public.support_tickets;
CREATE POLICY "Allow users to view own tickets" ON public.support_tickets 
    FOR SELECT 
    USING (auth.uid() = user_id);

-- Performance Indexing
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON public.support_tickets(user_id);

-- Reload Schema Cache
NOTIFY pgrst, 'reload schema';
