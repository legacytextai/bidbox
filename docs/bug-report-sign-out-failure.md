# Bug Report: Failed to Sign Out

## Summary
User authentication sign out functionality fails with error toast "Failed to sign out"

## Date Reported
2025-11-25 2:37 PM

## Environment
- Route: `/projects`
- Component: `SidebarNav.tsx`
- Function: `handleLogout()`

## Steps to Reproduce
1. Navigate to `/projects` page
2. Open sidebar (if collapsed)
3. Click "Logout" button in sidebar footer

## Expected Behavior
- User should be signed out successfully
- User should be redirected to `/auth` page
- Session should be cleared

## Actual Behavior
- Red error toast appears: "Error - Failed to sign out"
- User remains on `/projects` page
- User session remains active

## Technical Details

### Current Implementation
Location: `src/components/SidebarNav.tsx` lines 27-38

```typescript
const handleLogout = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) {
    toast({
      title: "Error",
      description: "Failed to log out",
      variant: "destructive",
    });
  } else {
    navigate("/auth");
  }
};
```

### Possible Causes
1. **Supabase Auth Session Issue**: The `supabase.auth.signOut()` call may be failing due to:
   - Invalid or expired session token
   - Network connectivity issues
   - Supabase service error
   - CORS or authentication configuration issues

2. **Client State Mismatch**: Local client state may not match server session state

3. **RLS Policy Conflict**: Row Level Security policies may be preventing session cleanup

## Debug Data Needed
- [ ] Console error logs showing actual Supabase error message
- [ ] Network request/response for signout endpoint
- [ ] Current auth session state at time of error
- [ ] Browser console errors

## Suggested Fixes

### Option 1: Add Error Logging
```typescript
const handleLogout = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Logout error:", error);
    toast({
      title: "Error",
      description: error.message || "Failed to log out",
      variant: "destructive",
    });
  } else {
    navigate("/auth");
  }
};
```

### Option 2: Force Local Signout
```typescript
const handleLogout = async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Logout error:", error);
      // Force local cleanup even if server signout fails
      localStorage.clear();
      sessionStorage.clear();
    }
    navigate("/auth");
  } catch (err) {
    console.error("Unexpected logout error:", err);
    navigate("/auth");
  }
};
```

### Option 3: Add Retry Logic
```typescript
const handleLogout = async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      // Retry once
      await new Promise(resolve => setTimeout(resolve, 1000));
      const { error: retryError } = await supabase.auth.signOut();
      if (retryError) {
        throw retryError;
      }
    }
    navigate("/auth");
  } catch (err) {
    console.error("Logout error:", err);
    toast({
      title: "Error",
      description: "Failed to log out. Please try again.",
      variant: "destructive",
    });
  }
};
```

## Priority
**HIGH** - Blocks core authentication flow and user experience

## Status
🔴 Open - Needs investigation

## Notes
- Error appears consistently based on user report
- May affect user trust in authentication security
- Should investigate Supabase auth configuration and RLS policies
