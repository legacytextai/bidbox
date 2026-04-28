## Goal

Bypass email verification for the user `test@bidbox.com` so they can sign in immediately without clicking a verification link.

## Current State

- User exists in `auth.users`:
  - id: `2ad0a491-0986-489c-88e2-f18b73f9ef1b`
  - email: `test@bidbox.com`
  - `email_confirmed_at`: `NULL` (unverified — blocks login)

## Change

Run a one-off SQL migration that sets `email_confirmed_at = now()` for this single user. This is the standard Supabase way to manually confirm an account without sending or clicking a verification email.

```sql
UPDATE auth.users
SET email_confirmed_at = now(),
    confirmed_at = now()
WHERE email = 'test@bidbox.com'
  AND email_confirmed_at IS NULL;
```

Scoped to that one email. Idempotent (the `IS NULL` guard makes re-runs a no-op). No app code changes, no RLS changes, no auth-config changes — global signup verification stays ON for everyone else.

## Verification

After the migration runs, the user can go to `/auth`, enter `test@bidbox.com` + their password, and sign in directly. I'll also re-query `auth.users` to confirm `email_confirmed_at` is now populated.

## Not Doing

- Not disabling email verification globally (would weaken security for all future signups).
- Not changing the user's password — only confirming the email.
- Not touching any other user.
