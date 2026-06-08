## Goal
Temporarily lift the 3-project free limit for all users during the building phase, with a single switch to re-enable it later.

## Approach: Centralized feature flag

Create one constant that gates the free-tier limit. Flip it back when ready — no other code changes needed.

### 1. New file: `src/lib/featureFlags.ts`
```ts
// Set to true to re-enable the 3-project free tier cap.
export const ENFORCE_FREE_PROJECT_LIMIT = false;
export const FREE_PROJECT_LIMIT = 3;
```

### 2. `src/pages/Projects.tsx`
- Import `ENFORCE_FREE_PROJECT_LIMIT` and `FREE_PROJECT_LIMIT` from the new file (remove the local `FREE_PROJECT_LIMIT` constant).
- Change gating logic:
  - `canCreateProject = isSubscribed || !ENFORCE_FREE_PROJECT_LIMIT || projects.length < FREE_PROJECT_LIMIT`
  - `isOverLimit = ENFORCE_FREE_PROJECT_LIMIT && !isSubscribed && projects.length >= FREE_PROJECT_LIMIT`
- Hide the "X/3 free projects used" counter when the flag is off.
- `handleNewProject` uses the same gate before redirecting to `/settings`.

### 3. `src/pages/NewProject.tsx`
- Apply the same flag check around the pre-submit free-tier guard (Task 10.1) so direct navigation to `/projects/new` also bypasses the limit when the flag is off.

### 4. Leave untouched
- Subscription/Stripe code, `useSubscription` hook, DB schema, and Settings UI all stay as-is. Paid users continue to work normally; flipping the flag back to `true` instantly restores enforcement.

## To re-enable later
Change one line in `src/lib/featureFlags.ts`:
```ts
export const ENFORCE_FREE_PROJECT_LIMIT = true;
```
