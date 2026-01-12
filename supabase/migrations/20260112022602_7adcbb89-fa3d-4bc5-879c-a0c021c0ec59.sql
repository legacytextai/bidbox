-- Security Hardening: Fix cslb_cache RLS policies
-- Problem: "Anyone can read" allows anonymous bulk scraping
-- Solution: Restrict to authenticated users only

-- Drop old overly permissive policies
DROP POLICY IF EXISTS "Anyone can read cslb_cache" ON public.cslb_cache;
DROP POLICY IF EXISTS "Service role can manage cslb_cache" ON public.cslb_cache;

-- Create new policy: Only authenticated users can read cache
-- Note: Service role automatically bypasses RLS, so lookup-cslb edge function still works
CREATE POLICY "Authenticated users can read cslb_cache"
ON public.cslb_cache
FOR SELECT
TO authenticated
USING (true);