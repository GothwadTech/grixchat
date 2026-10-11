-- =========================================================================
-- STEP 6/9: STORAGE BUCKETS (chat-media, profiles) AND THEIR POLICIES
-- =========================================================================
-- Run in the Supabase SQL Editor after 05_advanced_optimizations_and_realtime.sql.
-- Safe to re-run: buckets are inserted with ON CONFLICT DO NOTHING and every
-- policy is dropped and re-created, so an updated definition always wins.
--
-- ⚠️ These policies are deliberately permissive (public read, any authenticated
-- user may upload/update/delete in these buckets) because the app uploads to
-- `chat-media/images/<random>_<timestamp>.<ext>` — paths carry no user id, so
-- ownership cannot be checked from the path. Hardening notes:
-- docs/EGRESS_AUDIT.md §6 and the commented block in 09_egress_optimizations.sql.
-- =========================================================================

-- 1. PROVISION BUCKETS (If they do not already exist)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('chat-media', 'chat-media', true, 52428800, NULL), -- 50 MB limit
  ('profiles', 'profiles', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']) -- 5 MB limit
ON CONFLICT (id) DO NOTHING;


-- 2. RE-ENABLE AND RESET STRATEGIC POLICIES FOR STORAGE OBJECTS
-- Clean up any conflicting pre-existing policies for these buckets
DROP POLICY IF EXISTS "Public Access to chat-media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Users can upload to chat-media" ON storage.objects;
DROP POLICY IF EXISTS "Owners can update their own chat-media objects" ON storage.objects;
DROP POLICY IF EXISTS "Owners can delete their own chat-media objects" ON storage.objects;

DROP POLICY IF EXISTS "Public Access to profiles" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Users can upload to profiles" ON storage.objects;
DROP POLICY IF EXISTS "Owners can update their own profiles" ON storage.objects;
DROP POLICY IF EXISTS "Owners can delete their own profiles" ON storage.objects;


-- 3. APPLY SECURITY POLICIES FOR 'chat-media' BUCKET

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


-- 4. APPLY SECURITY POLICIES FOR 'profiles' BUCKET

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


-- 5. RELOAD POSTGRES SCHEMA CACHE
NOTIFY pgrst, 'reload schema';
