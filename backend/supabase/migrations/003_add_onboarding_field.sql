-- Add onboarding_completed field to users table
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_onboarding_completed ON public.users(onboarding_completed);

-- Update existing users (if any) to have onboarding completed
-- This is for users who signed up before this migration
-- Comment out if you want them to go through onboarding
-- UPDATE public.users SET onboarding_completed = TRUE WHERE created_at < NOW();
