-- Step 1: Drop the permissive public policy
DROP POLICY IF EXISTS "Anyone can view sub_trade_mappings" 
ON public.sub_trade_mappings;

-- Step 2: Create authenticated-only SELECT policy
CREATE POLICY "Authenticated users can read sub_trade_mappings"
ON public.sub_trade_mappings
FOR SELECT
USING (auth.uid() IS NOT NULL);