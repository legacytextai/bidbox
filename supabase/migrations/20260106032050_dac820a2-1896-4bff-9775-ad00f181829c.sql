-- Drop the overly permissive policy that grants universal access
-- (Service role bypasses RLS anyway, so this policy is both redundant and dangerous)
DROP POLICY IF EXISTS "Service role can manage subscriptions" 
ON public.subscriptions;