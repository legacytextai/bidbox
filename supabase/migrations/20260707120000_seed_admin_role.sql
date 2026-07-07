-- ============================================================
-- Admin role grant for the BidBox internal administration UI.
--
-- Authorization architecture: the existing role system
-- (user_roles + app_role enum + has_role(), migration
-- 20251130211130). Admin access is NEVER keyed to a hardcoded
-- email in application code — the frontend checks
-- has_role(auth.uid(), 'admin'). This migration only performs
-- the initial grant; additional admins are added with the same
-- idempotent INSERT (or via a future role-management UI).
--
-- Idempotent: safe to re-run; no-op if the user already has the
-- role or the account does not exist yet (NOTICE raised so the
-- skip is visible in migration output).
-- ============================================================

DO $$
DECLARE
  target_user_id uuid;
BEGIN
  SELECT id INTO target_user_id
  FROM auth.users
  WHERE lower(email) = lower('constructionaisolutions.co@gmail.com')
  LIMIT 1;

  IF target_user_id IS NULL THEN
    RAISE NOTICE 'seed_admin_role: no auth.users row for constructionaisolutions.co@gmail.com — grant skipped; re-run after the account signs up';
    RETURN;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  RAISE NOTICE 'seed_admin_role: admin role ensured for %', target_user_id;
END $$;
