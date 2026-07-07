DO $$
DECLARE
  target_user_id uuid;
BEGIN
  SELECT id INTO target_user_id
  FROM auth.users
  WHERE lower(email) = lower('constructionaisolutions.co@gmail.com')
  LIMIT 1;

  IF target_user_id IS NULL THEN
    RAISE NOTICE 'seed_admin_role: no auth.users row — skipped';
    RETURN;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  RAISE NOTICE 'seed_admin_role: admin role ensured for %', target_user_id;
END $$;