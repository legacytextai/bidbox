UPDATE auth.users 
SET email_confirmed_at = NOW(),
    raw_user_meta_data = raw_user_meta_data || '{"email_verified": true}'::jsonb
WHERE id = 'ba52c49e-c723-4bd0-bd30-30e7cb344241'
  AND email = 'estimating@fecgc.com';