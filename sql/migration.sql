-- ==============================================================================
-- SecureShare Database Schema Migration (Supabase PostgreSQL)
-- Semester 5 Project: Secure File Sharing Platform + Personal Vault
-- ==============================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- Table: profiles
-- Stores registered users, hashed passwords, and verification status.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Index for rapid email lookups during login and registration checks
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (email);

-- ==============================================================================
-- Table: otp_codes
-- Stores 6-digit hashed OTPs for registration verification and password security.
-- Expires in 10 minutes, tracks failed attempts (max 5), and records consumption.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.otp_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INT DEFAULT 0,
    consumed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Index on (email, created_at desc) to quickly fetch the latest active OTP code
CREATE INDEX IF NOT EXISTS idx_otp_codes_email_created 
    ON public.otp_codes (email, created_at DESC);

-- ==============================================================================
-- Table: files
-- Stores metadata for files uploaded to Supabase Storage bucket 'vault'.
-- Note: Binary content lives in the 'vault' storage bucket, NEVER on the server disk.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    file_type TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Index for filtering a user's vault files quickly
CREATE INDEX IF NOT EXISTS idx_files_user_id ON public.files (user_id);
CREATE INDEX IF NOT EXISTS idx_files_created_at ON public.files (created_at DESC);

-- ==============================================================================
-- Table: shares
-- Manages public and protected sharing links for vault files.
-- Includes optional bcrypt password hash, expiration date, download counters.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    share_token TEXT UNIQUE NOT NULL,
    password_hash TEXT DEFAULT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    is_revoked BOOLEAN DEFAULT FALSE,
    download_count INT DEFAULT 0,
    max_downloads INT DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Unique index on share_token for instant O(1) link resolution
CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_token ON public.shares (share_token);
CREATE INDEX IF NOT EXISTS idx_shares_user_id ON public.shares (user_id);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Protect data so users can only access their own records.
-- Backend Netlify functions connect via SUPABASE_SERVICE_ROLE_KEY to bypass
-- RLS when running server-authoritative validations and share lookups.
-- ==============================================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shares ENABLE ROW LEVEL SECURITY;

-- 1. Profiles Policies
-- Allow service_role full control, and allow users to read their own profile
CREATE POLICY "Users can view own profile" 
    ON public.profiles FOR SELECT 
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
    ON public.profiles FOR UPDATE 
    USING (auth.uid() = id);

-- 2. Files Policies
CREATE POLICY "Users can select own files" 
    ON public.files FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own files" 
    ON public.files FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own files" 
    ON public.files FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own files" 
    ON public.files FOR DELETE 
    USING (auth.uid() = user_id);

-- 3. Shares Policies
CREATE POLICY "Users can view own shares" 
    ON public.shares FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own shares" 
    ON public.shares FOR ALL 
    USING (auth.uid() = user_id);

-- ==============================================================================
-- SUPABASE STORAGE CONFIGURATION: "vault" Bucket
-- ==============================================================================
-- In the Supabase Dashboard:
-- 1. Go to "Storage" in the left sidebar
-- 2. Click "New Bucket"
-- 3. Name: "vault"
-- 4. Set Public bucket: OFF (Keep private!)
-- 5. Set File size limit: 52428800 (50 MB)
-- 6. Allowed MIME types: leave empty to allow all or restrict to safe types
--
-- Alternatively, execute the following SQL to ensure the bucket exists:
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vault', 'vault', false, 52428800, null)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policy: Ensure authenticated users can only access their user folder
-- Pattern: <userId>/<timestamp>_<filename>
CREATE POLICY "User storage folder isolation"
ON storage.objects FOR ALL
USING (
    bucket_id = 'vault' 
    AND (auth.uid())::text = (storage.foldername(name))[1]
)
WITH CHECK (
    bucket_id = 'vault' 
    AND (auth.uid())::text = (storage.foldername(name))[1]
);
