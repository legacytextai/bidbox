# BidBox Bug Report Template

*A structured approach to single-pass bug fixes*

---

## Phase 1: Evidence Gathering

Before reporting a bug, collect these exact artifacts:

### Environment & Route
- [ ] **Environment**: Production (`https://bidbox.lovable.app`) or Preview (`https://preview.lovableproject.com/...`)
- [ ] **Exact URL**: `_______________________`
- [ ] **Route/Page**: (e.g., `/projects`, `/bid/[token]`, `/projects/new`)
- [ ] **Browser & Mode**: (e.g., Chrome 131 incognito, Safari)

### Reproduction Steps
- [ ] **Step 1**: (e.g., "Navigate to /projects as logged-in GC")
- [ ] **Step 2**: (e.g., "Click 'Copy Link' button on first project tile")
- [ ] **Step 3**: (e.g., "Paste link in new incognito tab")
- [ ] **Step 4**: (e.g., "Observe 404 error")

### Expected vs Actual Behavior
- **Expected**: `_______________________`
- **Actual**: `_______________________`

### Visual Evidence
- [ ] Screenshot of the issue
- [ ] Console errors (if any): `_______________________`
- [ ] Network tab failures (if any): `_______________________`

### Data Context
- [ ] **User Role**: GC (logged in) / Sub (public) / Unauthenticated
- [ ] **Relevant IDs**: Project ID, Token, File ID, Bid ID (if applicable)
- [ ] **Timestamps**: When was project/bid created? Is deadline past?

---

## Phase 2: Root-Cause Analysis Checklist

Systematically check each layer:

### UI Layer
- [ ] Is the component rendering correctly?
- [ ] Are props being passed correctly?
- [ ] Is state updating as expected?
- [ ] Are event handlers attached properly?
- [ ] Is there a TypeScript type mismatch?

### RLS Policies (Database Access)
- [ ] Which table is involved? (`projects`, `project_files`, `bids`, `profiles`)
- [ ] Does the user/role have SELECT/INSERT/UPDATE/DELETE permissions?
- [ ] Is `auth.uid()` being checked correctly in policies?
- [ ] Is the public token being validated properly?
- [ ] Are there cascading delete issues?

### Storage Buckets
- [ ] Which bucket? (`project-files`, `bid-files`)
- [ ] Are storage policies correct for the user role?
- [ ] Is the file path constructed correctly?
- [ ] Is the file size within limits?
- [ ] Is the MIME type allowed?

### Edge Functions
- [ ] Is the edge function deployed and running?
- [ ] Are environment variables set correctly?
- [ ] Is the request payload correct?
- [ ] Are there authentication/authorization issues?
- [ ] Is the response being parsed correctly?

### Client-Side Logic
- [ ] Are API calls using correct endpoints?
- [ ] Is error handling catching failures?
- [ ] Is loading state managed properly?
- [ ] Are redirects working as expected?
- [ ] Is local state conflicting with server state?

---

## Phase 3: One Coherent Solution Plan

**DO NOT** propose incremental patches. Propose a complete fix:

```
### Root Cause
[One sentence identifying the exact problem]

### Files to Modify
1. `path/to/file1.tsx` - [what needs to change]
2. `path/to/file2.ts` - [what needs to change]
3. SQL migration (if RLS/schema change needed)

### Changes
- **File 1**: [Specific change with line numbers if possible]
- **File 2**: [Specific change with line numbers if possible]
- **Database**: [SQL statements if needed]

### Side Effects
- [Any other components/features that might be affected]
- [Data migration considerations]

### Rollback Plan
- [How to revert if this breaks something]
```

---

## Phase 4: Verify & Test Matrix

After fix is applied, verify:

### Core Functionality
- [ ] **Happy Path**: Does the main use case work?
- [ ] **GC Flow**: Can GCs perform their actions?
- [ ] **Sub Flow**: Can subs perform their actions?
- [ ] **Public Access**: Does no-login flow work?

### Edge Cases
- [ ] **Expired Projects**: What happens if bid deadline passed?
- [ ] **Invalid Tokens**: What happens with bad/old tokens?
- [ ] **Empty States**: What if no files/bids exist?
- [ ] **Large Files**: Does upload handle 50MB PDFs?

### Regression Tests
- [ ] **Related Features**: Did this break anything else?
- [ ] **Mobile**: Does it work on mobile viewports?
- [ ] **Dark Mode**: Does styling work in both themes?

---

## What NOT to Do

### ❌ Anti-Pattern 1: Incremental Guessing
**Don't**: "Let's try adding a console.log... now let's try changing this... now let's try..."
**Do**: Gather all evidence first, identify root cause, then apply complete fix

### ❌ Anti-Pattern 2: Environment Confusion
**Don't**: "The link works for me" (without specifying production vs preview)
**Do**: "Confirmed working in production at https://bidbox.lovable.app/bid/xyz but fails in preview"

### ❌ Anti-Pattern 3: Vague Descriptions
**Don't**: "The button doesn't work"
**Do**: "The 'Copy Link' button on /projects copies `https://preview.lovableproject.com/bid/abc` instead of `https://bidbox.lovable.app/bid/abc`"

### ❌ Anti-Pattern 4: Missing User Context
**Don't**: "I can't upload files"
**Do**: "As a logged-in GC on /projects/new, clicking 'Upload PDF' shows 'Storage policy violation' in console"

### ❌ Anti-Pattern 5: Skipping Verification
**Don't**: Assume fix works without testing
**Do**: Test in both production and preview, test as GC and Sub, test edge cases

---

## Reusable Prompt Scaffold

Copy/paste this template for new bugs:

```
**Create Bug Prompt: [One-line bug description]**

### Environment
- URL: [exact URL]
- Environment: [Production/Preview]
- Browser: [Chrome/Safari/Firefox + version]
- User Role: [GC/Sub/Public]

### Reproduction Steps
1. [First action]
2. [Second action]
3. [Third action]
4. [Observe issue]

### Expected Behavior
[What should happen]

### Actual Behavior
[What actually happens]

### Evidence
- Screenshot: [attach or describe]
- Console errors: [paste errors]
- Network failures: [paste failed requests]

### Additional Context
- Project ID / Token: [if relevant]
- File name / Bid ID: [if relevant]
- Timestamp: [when this occurred]
```

---

## Quick Reference: BidBox Files

### Key Documentation
- `docs/tasks.md` - Current implementation status
- `docs/masterplan.md` - System architecture
- `docs/implementation-plan.md` - Build sequence

### Critical Code Files
- `src/pages/Projects.tsx` - GC dashboard
- `src/pages/ProjectDetail.tsx` - GC admin view
- `src/pages/BidRoom.tsx` - Public bid room
- `src/lib/getPublicBaseUrl.ts` - URL generation logic
- `supabase/functions/get-public-project/index.ts` - Public project fetching

### Database & Security
- `supabase/migrations/` - All schema changes
- Check RLS policies in migration files for `projects`, `project_files`, `bids`
- Storage policies in Lovable Cloud UI

---

**Remember**: One complete fix is better than five partial attempts. Gather evidence first, analyze systematically, then fix decisively.
