-- ==============================================
-- SECURITY FIX: Lock down subcontractors table
-- Remove public access to sensitive contact data
-- ==============================================

-- Step 1: Remove the permissive public SELECT policy
DROP POLICY IF EXISTS "Anyone can view network subcontractors" ON public.subcontractors;

-- Step 2: Create authenticated-only SELECT policy
CREATE POLICY "Authenticated users can view network subcontractors"
ON public.subcontractors
FOR SELECT
USING (auth.uid() IS NOT NULL);