# BidBox Implementation Tasks

**Source of Truth for Feature Implementation**  
Last Updated: 2026-01-18

---

## Opportunity Intelligence Roadmap Ownership

Opportunity Intelligence development is tracked separately from this broad historical backlog.

- Product strategy source of truth: `docs/initiatives/opportunity-intelligence-mvp.md`
- Practical implementation plan: `docs/initiatives/opportunity-intelligence-implementation-plan.md`
- Agency Access Management design decision and future roadmap: `docs/initiatives/agency-access-management.md`
- Execution roadmap for agent, discovery, Project Intelligence, qualification, and pursuit initiatives: `docs/agent-architecture-task-list.md`
- Agency Access Management is tracked in the Master Plan and Agent Architecture roadmap as part of the Opportunity Intelligence architecture, not duplicated here.

Keep this `tasks.md` file focused on broad product implementation history and app-wide backlog. Do not duplicate the Opportunity Intelligence roadmap here.

---

## 📅 Session Changelog

### 2026-01-18: Bid Readiness Checklist

**Completed**:
- Bid Readiness Checklist feature (Task 2.19)
- Calendar visual integration (readiness badges, color coding, ready counter)
- Projects page visual integration (ready/not ready badges)

**Key Insight**:
Estimators require explicit manual verification of bureaucratic requirements. The checklist prioritizes awareness and clarity over automation or enforcement. Each section must be consciously confirmed — the system makes no assumptions.

**Scope Boundaries** (intentionally not built):
- No automation of checklist completion
- No bid blocking based on readiness
- No notifications or reminders
- One Link documentation unchanged

---

### 2026-06-08: SoCal Agency Expansion Started

**Completed**:
- Added `docs/agent-architecture-task-list.md` to track the Southern California opportunity-source expansion and agent architecture work
- Added the first E1 PlanetBids source migration with 50+ verified SoCal agency portals
- Added `docs/opportunity-source-ledger.md` to track configured, production-enabled, and scan-verified agency coverage
- Kept the migration additive/idempotent so existing scan history is not wiped

**Key Insight**:
PlanetBids coverage is the fastest path to broader opportunity intelligence because the worker and `agent_tasks` architecture already support it. The hard part is source discovery and verification, not scraper code.

**Scope Boundaries**:
- E1 only seeds PlanetBids portals
- Non-PlanetBids agencies belong in the E2 inventory before new driver work starts
- Caltrans, LA County, LACMTA, LADWP, and other direct/non-PlanetBids portals are intentionally not mixed into the PlanetBids migration

---

### 2026-06-16: F3 Document Processing Validated

**Completed**:
- F3 Document Processing is production validated and complete in the Opportunity Intelligence roadmap
- Validated `San Miguel Drive Pavement Rehabilitation 9855-2` for City of Newport Beach
- Processed 5 PDFs into page and chunk evidence
- Extracted 178 pages
- Created 106 chunks
- Confirmed 0 failures and 0 OCR-required documents
- Verified `opportunity_documents`, `opportunity_document_pages`, and `opportunity_document_chunks`
- Verified document → page → chunk citation chain

**Current Opportunity Intelligence Status**:
- F1 Opportunity Discovery / Analyze Project: ✅ Complete
- F2 Document Acquisition: ✅ Complete
- F3 Document Processing: ✅ Complete
- F4 Project Intelligence: ✅ Complete
- Phase G Pursuit Management & Project Workspace: 🔄 Next active task
- F5 Qualification Agent: ⏸ Paused until the Project Workspace bridge is stable

**Key Insight**:
F3 is an evidence-processing layer, not an intelligence layer. It classifies, extracts, organizes, chunks, cites, and tracks status. It does not generate reports, answer estimator questions, resolve precedence conflicts, qualify opportunities, or recommend pursuit decisions.

**F3A Backlog**:
Classification accuracy improvements remain a future enhancement. Validation found `Notice Inviting Bids` classified as addendum and `Sample Contract` classified as plans. The extraction pipeline works correctly, and these issues did not block F4.

**F4 Completion Summary**:
F4 Project Intelligence is MVP complete. BidBox now generates document-backed Project Intelligence reports from acquired and processed bid packages. Delivered capabilities include executive summaries, project snapshot metadata, scope summaries, trade breakdowns, key dates, bid requirements, risk flags, source document references, citation-backed findings, unknown/needs-review/conflict states, portal metadata enrichment, bid due date/time conflict safeguards, and corrected Opportunity → Intelligence Report navigation after calendar conversion.

F4A Phase 1 deadline hardening adds definitive bid due display, expandable conflict evidence, and lightweight Project Workspace bid due overrides. Full Deadline Resolution Engine tables and resolver history remain deferred Phase 2 work.

**Next Active Task**:
Task 8 — Phase G: Pursuit Management & Project Workspace. Phase G should harden the transition from Intelligence Report to active pursuit by treating `Add to Calendar` as create/reuse project, preserving Opportunity Intelligence as the source of truth, separating legacy One Link projects from Opportunity Intelligence projects, and building a lightweight Project Workspace for active pursuits.

**Deferred Active Task**:
Task 7.5 — F5 Qualification Agent is paused until the Project Workspace bridge is stable. F5 should later evaluate whether the contractor should pursue the analyzed opportunity using Project Intelligence findings and the contractor profile, including licensing, bonding, insurance, experience, labor compliance, self-perform capability, strategic fit, risk profile, and pursuit recommendation.

---

## 🏗️ Architecture Note: State-Agnostic Licensing

> **CRITICAL**: BidBox uses a **future-proof, state-agnostic trade taxonomy**.
> 
> - `trade_types` table stores all license/trade types with `state_code` column
> - California CSLB is the **initial seed data**, not a permanent constraint
> - All tables (project_trades, subcontractors, gc_subcontractors) use `trade_type_id` FK
> - **NEVER** hard-code license codes like "C-10" in components or logic
> - Multi-state expansion requires only adding rows to `trade_types`, no code changes

---

## 📋 Task Status Legend

- [ ] Not Started
- [x] Completed
- [🔄] In Progress
- [⚠️] Blocked/Needs Review

---

## 🔐 Security Decisions (Audit Reference)

> **Purpose**: Document intentional security architecture decisions to prevent false-positive vulnerability reports.

---

### SD-001: Two-Pool Subcontractor Access Model [FINAL]

**Date**: 2025-12-15  
**Status**: Reviewed and closed — Do not reopen without product decision

**Summary**: BidBox uses two distinct subcontractor tables with different access models:

1. **`subcontractors`** (Network Pool)
   - Shared, BidBox-owned directory
   - Readable by ALL authenticated users (intentional)
   - No `gc_id` or ownership column (by design)
   - Populated via CSLB scraping, admin curation

2. **`gc_subcontractors`** (Private Pool)
   - Per-GC private directory
   - Readable ONLY by owning GC (strict RLS via `gc_id`)
   - Populated via Excel import, manual entry

**RLS Policies**:
- `subcontractors`: `auth.uid() IS NOT NULL` (authenticated access)
- `gc_subcontractors`: `gc_id = auth.uid()` (owner-only access)

**Why NOT a vulnerability**:
- Network Pool shared access is a **product feature**, not a security flaw
- Competitor intelligence concerns are business decisions
- Unauthenticated/public access is blocked
- Private Pool remains strictly isolated

**Future audits**: If flagged as "PUBLIC_SENSITIVE_DATA" or similar, reference this decision before implementing restrictions.

**References**: 
- `docs/masterplan.md` → Security Decisions
- `docs/gc-control-center-prd.md` → Section 6 Security Model
- Lovable memory: `architecture/two-pool-subcontractor-model`

---

### SD-002: Sub Trade Mappings Access Control [FINAL]

**Date**: 2026-01-06  
**Status**: Fixed — Critical security vulnerability resolved

**Issue**: The `sub_trade_mappings` table had a permissive public SELECT policy (`USING (true)`) that exposed subcontractor → trade type associations to anonymous users.

**Fix Applied**:
- Dropped policy `Anyone can view sub_trade_mappings`
- Created policy `Authenticated users can read sub_trade_mappings` with `USING (auth.uid() IS NOT NULL)`

**Final RLS Policies**:
| Policy | Command | Condition |
|--------|---------|-----------|
| Authenticated users can read sub_trade_mappings | SELECT | `auth.uid() IS NOT NULL` |
| Admins can manage sub_trade_mappings | ALL | `has_role(auth.uid(), 'admin')` |

**Impact**: Anonymous/unauthenticated access blocked. All authenticated GCs retain read access.

---

### SD-003: Subscriptions Table Access Control [FINAL]

**Date**: 2026-01-06  
**Status**: Fixed — Critical security vulnerability resolved

**Issue**: The `subscriptions` table had an overly permissive policy that could expose sensitive Stripe billing data.

**Fix Applied**:
- Dropped policy `Service role can manage subscriptions` (service role bypasses RLS anyway)
- Retained user-scoped policy `Users can view own subscription`

**Final RLS Policies**:
| Policy | Command | Condition |
|--------|---------|-----------|
| Users can view own subscription | SELECT | `auth.uid() = profile_id` |

**Impact**: Users can only read their own subscription record. Stripe webhooks continue to work via service role bypass.

---

### SD-005: CSLB Cache Public Access Protection [FIXED]

**Date**: 2026-01-12  
**Status**: Fixed — Restricts anonymous bulk scraping

**Issue**: The `cslb_cache` table had overly permissive policies:
- `Anyone can read cslb_cache` - allowed anonymous bulk scraping
- `Service role can manage cslb_cache` - ineffective (service role bypasses RLS anyway)

**Fix Applied**:
- Dropped both permissive policies
- Created policy `Authenticated users can read cslb_cache` with `USING (true)` scoped to `TO authenticated`

**Final RLS Policies**:
| Policy | Command | Role | Condition |
|--------|---------|------|-----------|
| Authenticated users can read cslb_cache | SELECT | authenticated | `true` |

**Why Service Role Access Still Works**: Service role keys automatically bypass RLS. The `lookup-cslb` edge function uses service role, so it continues to read/write cache without explicit policy.

**Tradeoffs**: CSLB data is public record, but restricting to authenticated users prevents:
- Bulk scraping by anonymous actors
- API abuse without authentication
- Data harvesting without usage tracking

---

### SD-006: Bids Table Anonymous INSERT [INTENTIONAL]

**Date**: 2026-01-12  
**Status**: Documented — Intentional design, not a vulnerability

**Warning**: Security linter flags `WITH CHECK (true)` on bids INSERT.

**Why This Is Correct**:
- Subcontractors submit bids WITHOUT login (core product feature)
- Public bid room at `/bid/:token` must allow anonymous submissions
- Bids are tied to projects via `project_id` foreign key (enforces project existence)
- Rate limiting on frontend prevents abuse
- File validation prevents malicious uploads

**Documentation Reference**: `docs/masterplan.md` - "Subs don't need accounts to submit quotes"

**Action**: No change. Documented as accepted design.

---

### SD-004: Bids Table Cross-GC Protection [VERIFIED SECURE]

**Date**: 2026-01-06  
**Status**: Confirmed secure — No changes needed (false positive)

**Warning Investigated**: Security scanner flagged potential cross-GC access to bids.

**Verification**: Existing policy already correctly enforces ownership via project join:
```sql
CREATE POLICY "GCs can view bids for their projects"
ON public.bids FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM projects 
    WHERE projects.id = bids.project_id 
    AND projects.gc_id = auth.uid()
  )
);
```

**Guarantees**:
- GCs can only SELECT bids for projects where they are the owner
- Cross-GC access is blocked (`auth.uid()` must match project owner)
- Anonymous access blocked (`auth.uid()` is null for unauthenticated requests)

**Action**: Marked as false positive in security scanner with documented reasoning.

---

## 🔴 Phase 0: CRITICAL SECURITY FIXES (DO FIRST)

> **BLOCKER**: These vulnerabilities expose ALL project data to the public internet. Must fix before any new features.

### Task 0.1: Fix Projects Table RLS Policy [✅ COMPLETED]

**Problem**: `USING (true)` allows anyone to query ALL projects without token verification.

**Current Code** (supabase/migrations/...sql line 57-59):
```sql
CREATE POLICY "Anyone can view projects by public token"
  ON public.projects FOR SELECT
  USING (true);  -- ❌ EXPOSES EVERYTHING
```

**Implementation**:
- [x] 0.1.1 Remove the overly permissive policy
  ```sql
  DROP POLICY "Anyone can view projects by public token" ON public.projects;
  ```

- [x] 0.1.2 Create edge function `get-public-project`
  - Location: `supabase/functions/get-public-project/index.ts`
  - Input: `{ token: string }`
  - Validate token, return single project or 404
  - Add CORS headers
  - Code snippet:
  ```typescript
  import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
  import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  serve(async (req) => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const { token } = await req.json();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('public_token', token)
      .eq('status', 'LIVE')
      .single();

    if (error || !data) {
      return new Response(JSON.stringify({ error: 'Project not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  });
  ```

- [x] 0.1.3 Update `src/pages/BidRoom.tsx` to use edge function
  - Replace direct Supabase query (line ~91) with `supabase.functions.invoke('get-public-project', { body: { token } })`

**References**: masterplan.md (Security), implementation-plan.md (Phase 1)

---

### Task 0.2: Fix Project Files Table RLS Policy [✅ COMPLETED]

**Problem**: `USING (true)` exposes all file metadata publicly.

- [x] 0.2.1 Remove the permissive policy
  ```sql
  DROP POLICY "Anyone can view project files" ON public.project_files;
  ```

- [x] 0.2.2 Extend `get-public-project` edge function to include files
  - Add join to fetch project_files in same function
  - Return: `{ project: {...}, files: [...] }`

- [x] 0.2.3 Update BidRoom.tsx to use combined response
  - Single function call gets project + files

**References**: implementation-plan.md (Phase 1 - File Access)

---

### Task 0.3: Fix Storage Bucket Policies [✅ COMPLETED]

**Problem**: Database allows public file access but storage blocks downloads (bid room broken).

- [x] 0.3.1 Add public read policy for project-files bucket
  ```sql
  CREATE POLICY "Public can download project files"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'project-files');
  ```

- [x] 0.3.2 Fix bid-submissions bucket to check project ownership
  ```sql
  DROP POLICY "GCs can view bid submissions for their projects" ON storage.objects;
  
  CREATE POLICY "GCs can view their own project bid submissions"
    ON storage.objects FOR SELECT
    USING (
      bucket_id = 'bid-submissions' AND
      EXISTS (
        SELECT 1 FROM public.projects
        WHERE projects.id::text = (storage.foldername(name))[1]
        AND projects.gc_id = auth.uid()
      )
    );
  ```

**References**: supabase-use-storage-native docs

---

### Task 0.4: Add File Upload Validation [✅ COMPLETED]

**Problem**: No validation allows malicious uploads and storage abuse.

**Specs from user**:
- Max single file: **200 MB**
- Project files: PDF, DWG, Excel
- Bid submissions: PDF, Excel, ZIP
- Total per project: ~250 MB

- [x] 0.4.1 Create validation utility
- [x] 0.4.2 Apply validation in NewProject.tsx
- [x] 0.4.3 Apply validation in BidRoom.tsx
- [x] 0.4.4 Apply validation in ProjectDetail.tsx

**References**: design-guidelines.md (Error Handling), input-validation-security docs

---

### Task 0.6: Implement Drag-and-Drop File Upload [✅ COMPLETED]

**Problem**: Drag-and-drop was not working despite UI text indicating it should.

**Implementation**:
- [x] 0.6.1 Create reusable FileDropzone component
  - Location: `src/components/FileDropzone.tsx`
  - Features: drag events, visual feedback, click-to-upload fallback
  - Supports single/multiple files, custom accept types, disabled state

- [x] 0.6.2 Update NewProject.tsx to use FileDropzone
  - Replaced static div with FileDropzone component
  - Visual feedback during drag (border-primary, bg-primary/5)
  - Maintains file validation

- [x] 0.6.3 Update ProjectDetail.tsx to use FileDropzone
  - Updated "Add New Files" section with FileDropzone
  - Connected to existing upload workflow

- [x] 0.6.4 Update BidRoom.tsx main dropzone
  - Made outer dropzone functional with drag-and-drop
  - On file drop: sets bidFile and opens dialog
  - Visual feedback during drag

- [x] 0.6.5 Update BidRoom.tsx dialog dropzone
  - Added drag-and-drop to dialog's file upload area
  - Connected to setBidFile state

**Testing**:
- ✅ Drag PDF onto /projects/new → file appears in list
- ✅ Drag Excel onto /projects/:id → file ready for upload
- ✅ Drag file onto /bid/:token → dialog opens with file pre-selected
- ✅ Drag file into open dialog → file selected
- ✅ Click-to-upload still works on all pages
- ✅ Visual feedback (border and background changes) during drag

**References**: design-guidelines.md, bug-report-sign-out-failure.md

---

### Task 0.5: Enable Leaked Password Protection [✅ COMPLETED]

- [x] 0.5.1 Update Supabase auth config
  - Use `supabase--configure-auth` tool
  - Enable breach password protection
  - Verified via auth logs: "Pwned passwords cache is 292.77 KB"

**References**: supabase-info docs

---

### Task 0.8: Fix Subs Network Trade Search URL Overflow [✅ COMPLETED]

**Date**: 2026-01-01  
**Problem**: Searching by trade type on `/subs-network` page caused 400 Bad Request errors due to excessive URL length when querying `sub_trade_mappings`.

**Root Cause**: Unbounded query to `sub_trade_mappings` table returned thousands of rows, exceeding URL length limits.

**Solution**: Added `.limit(100)` to the `sub_trade_mappings` query to prevent URL overflow during trade type searches.

**Files Modified**: `src/pages/SubsNetwork.tsx`

---

## ✅ Phase 1: MVP Foundation

### Task 1.1: Authentication System [x] COMPLETED

Already implemented:
- Email/password auth
- Login/signup pages
- Protected routes
- Profile table with RLS

**No changes needed.**

---

### Task 1.2: Projects Dashboard [x] COMPLETED

**Location**: `src/pages/Projects.tsx`

Already implemented:
- Grid layout of project tiles
- Shows: name, bid due, submission count, status
- Copyable public link
- Navigation to detail view

**No changes needed.**

---

### Task 1.3: New Project Creation [x] COMPLETED

**Location**: `src/pages/NewProject.tsx`

Already implemented:
- Form with all required fields
- Multi-file upload
- Token generation
- Navigation after creation

**Changes needed**: Apply Task 0.4.2 (file validation)

---

### Task 1.4: Project Detail View [x] COMPLETED

**Location**: `src/pages/ProjectDetail.tsx`

Already implemented:
- View/edit project metadata
- File management (add/delete)
- View submissions
- Delete project

**Changes needed**: Apply Task 0.4.4 (file validation)

---

### Task 1.5: Public Bid Room Page [x] COMPLETED

**Location**: `src/pages/BidRoom.tsx`

Already implemented:
- Public access by token
- Project info display
- File downloads
- Bid submission modal

**Changes needed**: 
- Apply Task 0.1.3 (use edge function)
- Apply Task 0.4.3 (file validation)
- Add Task 2.1 (countdown timer)
- Add Task 2.2 (late bid marking)

**References**: app-flow-pages-and-roles.md (Bid Room Flow)

---

## 🎯 Phase 2: MVP Polish & Core Features

### Task 2.0: Calendar Print Single-Page Output [✅ COMPLETED]

**Goal**: `/calendar` prints on **ONE page** (header + weekday labels + grid + events) with **no page splitting** and **no user scale adjustments**.

**Status**: ✅ Completed 2026-01-05

**Solution**: Implemented iframe-based print approach (CSS-only methods proved insufficient for cross-browser consistency).

- [x] 2.0.1 Created `src/lib/calendarPrint.ts` utility
  - `generatePrintHTML()` builds a self-contained HTML document for printing
  - Uses fixed Letter landscape dimensions with explicit row heights
  - Forces single-page output by calculating available height and distributing to rows

- [x] 2.0.2 Implemented `printCalendarViaIframe()` function
  - Creates hidden iframe with print-only layout
  - Injects generated HTML with all print styles inline
  - Sets document title to `Bid_Calendar_YYYY-MM-DD` (today's date) for PDF filename
  - Triggers print from iframe context, then cleans up

- [x] 2.0.3 Updated `src/components/CalendarGrid.tsx`
  - "Print" button now calls `printCalendarViaIframe()` instead of `window.print()`
  - Gathers calendar data (month title, weeks, events) and passes to print utility

- [x] 2.0.4 Print styling guarantees
  - `@page { size: letter landscape; margin: 0.4in; }`
  - `-webkit-print-color-adjust: exact` for color preservation
  - Dynamic row heights based on number of weeks (~7.5in printable height)

**Implementation Files**:
- `src/lib/calendarPrint.ts` — Print HTML generation + iframe print utility
- `src/components/CalendarGrid.tsx` — Updated Print button handler

**How to test**:
1. Go to `/calendar`
2. Click **Print**
3. Confirm print preview shows **exactly 1 page** (no page splits)
4. Confirm filename is `Bid_Calendar_YYYY-MM-DD` (today's date)
5. Confirm colors are preserved (red for Bid Due, gray for Job Walk)

**Definition of Done**: ✅ All criteria met
- Single-page print
- No header/grid split
- No manual scaling required
- Correct filename with today's date
- Colors preserved

---

### Task 2.1: Drag-and-Drop File Upload Audit [✅ COMPLETED]

**Goal**: Ensure all file upload surfaces support reliable drag-and-drop behavior for pilot readiness.

**Status**: ✅ Completed 2026-01-05

- [x] 2.1.1 Audited `/projects/new` file uploads
- [x] 2.1.2 Audited `/projects/:id` file uploads  
- [x] 2.1.3 Audited `/bid/:token` bid submission uploads
- [x] 2.1.4 Fixed unique ID generation using React's `useId()` hook in `FileDropzone.tsx`

**Implementation Files**:
- `src/components/FileDropzone.tsx` — Uses `useId()` for unique input IDs

**How to test**:
1. Drag files onto each upload surface
2. Verify file appears in list without errors
3. Verify click-to-upload also works

---

### Task 2.2: Pilot User Full Access [✅ COMPLETED]

**Goal**: Grant pilot user unlimited access without 3-project free tier limit.

**Status**: ✅ Completed 2026-01-05

- [x] 2.2.1 Inserted subscription record with `subscription_type='lifetime'` and `status='active'`
- [x] 2.2.2 Verified upgrade prompts are hidden
- [x] 2.2.3 Documented reversal process (delete subscription record)

**Pilot User**: mohammad.d@fecgc.com (Profile ID: 241475b1-c50d-4166-aa6c-8101d7305830)

**How to revert**: Delete the corresponding record from the `subscriptions` table.

---

### Task 2.3: Estimating Email Field [✅ COMPLETED]

**Goal**: Allow GCs to set an optional estimating contact email displayed on public bid rooms.

**Status**: ✅ Completed 2026-01-05

- [x] 2.3.1 Added `estimating_email` column to `profiles` table
- [x] 2.3.2 Added Estimating Email input field in `/settings`
- [x] 2.3.3 Display "Estimating Contact" in public bid room with mailto: link
- [x] 2.3.4 Fallback to GC's primary email if estimating_email is not set

**Implementation Files**:
- `src/pages/Settings.tsx` — Input field for estimating email
- `src/pages/BidRoom.tsx` — Display estimating contact in Project Info card

**How to test**:
1. Go to `/settings`, enter estimating email, save
2. Open a public bid room link
3. Verify "Estimating Contact" shows with mailto: link

---

### Task 2.4: Required Trades Display on Public Bid Room [✅ COMPLETED]

**Goal**: Display project trades on public bid room so subs can self-qualify.

**Status**: ✅ Completed 2026-01-05

- [x] 2.4.1 Fetch trades from `project_trades` with inner join to `trade_types`
- [x] 2.4.2 Display as colored badges by category
- [x] 2.4.3 Hide section entirely when no trades are set

**Implementation Files**:
- `src/pages/BidRoom.tsx` — Required Trades section in Project Info card

**How to test**:
1. Create project with trades selected
2. Open public bid room link
3. Verify trades appear as badges

---

### Task 2.5: Network Subs Pagination + Export Fix [✅ COMPLETED]

**Goal**: Remove artificial 100-result limit, implement pagination, and ensure export includes all results.

**Status**: ✅ Completed 2026-01-05

- [x] 2.5.1 Implement pagination (50 per page) with Previous/Next controls
- [x] 2.5.2 Cap UI display at 1,000 results with disclosure message
- [x] 2.5.3 Export bypasses UI limit using `.range()` batch loops
- [x] 2.5.4 Add helper text: "Showing first 1,000 results. Export for full list."

**Implementation Files**:
- `src/pages/SubsNetwork.tsx` — Pagination and export logic

**How to test**:
1. Search by trade with many results
2. Verify pagination works
3. Export to Excel, verify all results included

---

### Task 2.6: Network Subs Status Badge Fix [✅ COMPLETED]

**Goal**: Standardize license status badges between Private Pool and Network Pool.

**Status**: ✅ Completed 2026-01-05

- [x] 2.6.1 Created `src/lib/licenseStatusBadge.ts` utility
- [x] 2.6.2 Normalized "CLEAR" → "active" for consistency
- [x] 2.6.3 Applied to Subs Network, Directory, and Forms

**Badge Colors**:
- Active (CLEAR/ACTIVE) = Green ('success' variant)
- Expired = Red ('destructive' variant)
- Unknown/Other = Grey ('secondary' variant)

**Implementation Files**:
- `src/lib/licenseStatusBadge.ts` — Badge mapping utility

---

### Task 2.7: Job Walk Date & Time [✅ COMPLETED]

**Goal**: Add optional Job Walk date/time field to projects.

**Status**: ✅ Completed 2026-01-05

- [x] 2.7.1 Added `job_walk_at` column to `projects` table (timestamptz, nullable)
- [x] 2.7.2 Added input field on `/projects/new`
- [x] 2.7.3 Added editable field on `/projects/:id`
- [x] 2.7.4 No validation or workflow complexity (metadata only)

**Implementation Files**:
- `src/pages/NewProject.tsx` — Job walk input on create
- `src/pages/ProjectDetail.tsx` — Job walk input on edit

**How to test**:
1. Create project with job walk date
2. Verify displays on project page
3. Edit job walk date, save, verify persisted

---

### Task 2.8: Calendar Job Walk Integration [✅ COMPLETED]

**Goal**: Display Job Walk events on calendar alongside Bid Due events.

**Status**: ✅ Completed 2026-01-05

- [x] 2.8.1 Query `job_walk_at` alongside `bid_due_at` in calendar query
- [x] 2.8.2 Display Job Walk events with gray badge
- [x] 2.8.3 Display Bid Due events with red badge
- [x] 2.8.4 Both event types clickable, route to project page
- [x] 2.8.5 Separate events if both exist on same day

**Implementation Files**:
- `src/pages/CalendarDashboard.tsx` — Query includes job_walk_at
- `src/components/CalendarGrid.tsx` — Dual event type rendering

---

### Task 2.9: Calendar Event Redesign [✅ COMPLETED]

**Goal**: Improve calendar event hierarchy and legibility.

**Status**: ✅ Completed 2026-01-05

- [x] 2.9.1 Header/Badge: "Bid Due" (red) or "Job Walk" (gray)
- [x] 2.9.2 Title: Project name only
- [x] 2.9.3 Subtitle: Date & time (MM/DD @ h:mm AM/PM)
- [x] 2.9.4 Eliminated truncation and redundancy

**Implementation Files**:
- `src/components/CalendarGrid.tsx` — Event card structure

---

### Task 2.10: Calendar Size & Layout Improvements [✅ COMPLETED]

**Goal**: Expand calendar footprint for better usability.

**Status**: ✅ Completed 2026-01-05

- [x] 2.10.1 Expanded container width (max-w-7xl)
- [x] 2.10.2 Increased day cell height (min-h-[160px])
- [x] 2.10.3 Improved event legibility
- [x] 2.10.4 Better use of screen real estate

**Implementation Files**:
- `src/components/CalendarGrid.tsx` — Layout and sizing

---

### Task 2.11: Landing Page Auto-Redirect for Authenticated Users [✅ COMPLETED]

**Goal**: Redirect signed-in users from the landing page to the app dashboard.

**Status**: ✅ Completed 2026-01-06

**Behavior**:
- Authenticated users visiting `/` (root URL) are automatically redirected to `/calendar`
- Unauthenticated users see the marketing landing page unchanged
- Uses `navigate("/calendar", { replace: true })` to prevent back-button loops
- Returns `null` until auth state is confirmed to prevent flash of landing content

- [x] 2.11.1 Added auth check in `LandingMvp.tsx` using `useAuth()` hook
- [x] 2.11.2 Implemented redirect via `useEffect` when `user` exists and `authReady` is true
- [x] 2.11.3 Returns `null` during auth state resolution (prevents flash)

**Implementation Files**:
- `src/pages/LandingMvp.tsx` — Auth check and redirect logic

**How to test**:
1. Log out and visit `bidbox.lovable.app` — see landing page
2. Log in and return to root URL — automatic redirect to `/calendar`
3. Verify no flash of landing content during redirect

---

### Task 2.12: Security Fix - `sub_trade_mappings` Public Exposure [✅ COMPLETED]

**Goal**: Remove public SELECT access to subcontractor trade mapping data.

**Status**: ✅ Completed 2026-01-06 (Critical fix)

**Actions taken**:
- Dropped permissive policy `Anyone can view sub_trade_mappings`
- Created policy `Authenticated users can read sub_trade_mappings` with `USING (auth.uid() IS NOT NULL)`
- RLS was already enabled

**Final RLS policies**:
| Policy | Command | Condition |
|--------|---------|-----------|
| Authenticated users can read sub_trade_mappings | SELECT | `auth.uid() IS NOT NULL` |
| Admins can manage sub_trade_mappings | ALL | `has_role(auth.uid(), 'admin')` |

**Impact**: Anonymous/unauthenticated access blocked. All authenticated GCs retain read access.

**Reference**: See SD-002 in Security Decisions section.

---

### Task 2.13: Security Fix - `subscriptions` Table Public Exposure [✅ COMPLETED]

**Goal**: Prevent public access to sensitive billing/Stripe data.

**Status**: ✅ Completed 2026-01-06 (Critical fix)

**Actions taken**:
- Dropped overly permissive policy `Service role can manage subscriptions`
- Retained user-scoped policy `Users can view own subscription`

**Final RLS policies**:
| Policy | Command | Condition |
|--------|---------|-----------|
| Users can view own subscription | SELECT | `auth.uid() = profile_id` |

**Impact**: 
- Users can only read their own subscription record
- Stripe webhooks continue to work (service role bypasses RLS)
- Anonymous/cross-user access blocked

**Reference**: See SD-003 in Security Decisions section.

---

### Task 2.14: Security Audit - `bids` Table Cross-GC Access [✅ CONFIRMED SECURE]

**Goal**: Verify that GCs cannot access bids for projects they don't own.

**Status**: ✅ Confirmed secure 2026-01-06 (No changes needed - false positive)

**Existing policy verified**:
```sql
CREATE POLICY "GCs can view bids for their projects"
ON public.bids FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM projects 
    WHERE projects.id = bids.project_id 
    AND projects.gc_id = auth.uid()
  )
);
```

**Guarantees**:
- GCs can only SELECT bids for projects where they are the owner
- Cross-GC access is blocked (`auth.uid()` must match project owner)
- Anonymous access blocked (`auth.uid()` is null for unauthenticated requests)

**Action**: Marked as false positive in security scanner with documented reasoning.

**Reference**: See SD-004 in Security Decisions section.

---

### Task 2.15: One Link Precision Fixes [✅ COMPLETED]

**Goal**: Fix extraction accuracy and UX sequencing issues discovered during PlanetBids testing.

**Status**: ✅ Completed 2026-01-11

**Issues Fixed**:

1. **Bid Due Time Parsing** (Fix 1)
   - Problem: Time extracted as 2:00 AM instead of 10:00 AM
   - Solution: Updated LLM prompt to extract EXACT times from "Bid Due", "Bid Opening", "Closing Date" keywords
   - Never defaults to midnight or 2:00 AM — if time unclear, only date is used
   
2. **Job Walk Date/Time/Location Population** (Fix 2)
   - Problem: Job walk detected but `job_walk_at` field not populated
   - Solution: Added `job_walk.datetime` and `job_walk.location` to LLM extraction schema
   - Now populates `job_walk_at` field from structured extraction

3. **County Inference from Agency** (Fix 3)
   - Problem: County not populated even when agency contains city name
   - Solution: Added city-to-county mapping for 80+ California cities
   - "City of Irvine" → "Orange", "City of San Diego" → "San Diego", etc.
   
4. **Source Project Link Visibility** (Fix 4)
   - Problem: Source link too small and de-emphasized
   - Solution: Added prominent "Original Project Listing" card at top of ProjectSignals
   - Clear visual with portal name and "Open" button

5. **Crawl UX Sequencing** (Fix 5)
   - Problem: User sees half-populated page during crawl
   - Solution: Added "Analyzing project..." loading state with polling
   - Page waits for `last_crawled_at` to be set before showing project details

**Files Modified**:
- `supabase/functions/crawl-project/index.ts` — Enhanced LLM prompts, added county inference
- `src/components/ProjectSignals.tsx` — Prominent source link section
- `src/pages/ProjectDetail.tsx` — Crawl-pending loading state with 2-second polling

**How to test**:
1. Create project from PlanetBids URL
2. Verify "Analyzing project..." spinner shows until crawl completes
3. After completion, verify:
   - Bid due TIME is correct (not 2:00 AM)
   - Job walk date auto-populates if detected
   - County inferred from agency ("City of Irvine" → "Orange")
   - Source link is prominently visible at top

---

### Task 2.16: One Link Phase 5 - Daily Re-Crawl [✅ COMPLETED]

**Goal**: Implement nightly background re-crawling for One Link projects to detect changes to bid due dates, addenda, and status.

**Status**: ✅ Completed 2026-01-11

**Deliverables Implemented**:

1. **Database Schema Extension**
   - Added `crawl_changes` JSONB column to `projects` table
   - Stores detected changes from re-crawls (e.g., `{ "bid_due_at": { "old": "...", "new": "..." } }`)
   
2. **Daily Cron Job**
   - Created `daily-recrawl-one-link-projects` cron job running at 10:00 UTC (2:00 AM PST)
   - Triggers `recrawl-projects` edge function nightly

3. **Re-Crawl Edge Function**
   - New `supabase/functions/recrawl-projects/index.ts`
   - Queries LIVE projects with `source_url` that haven't been crawled in 20+ hours
   - Processes max 50 projects per run with 2-second rate limiting
   - Returns summary: `{ processed, changed, errors }`

4. **Change Detection**
   - Updated `crawl-project` to accept `is_recrawl` and `previous_values` parameters
   - Detects changes in `bid_due_at`, `job_walk_at`, and `agency`
   - Populates `crawl_changes` column when differences found

5. **Manual Refresh Button**
   - Added "Refresh" button on ProjectDetail page for One Link projects
   - Loading state with spinning icon during re-crawl
   - Toast notification on completion

6. **Staleness Indicators**
   - Enhanced "Checked X ago" badge with color coding:
     - Green: Within 24 hours (fresh)
     - Yellow: 1-3 days ago (getting stale)
     - Gray: 3+ days ago (stale)

**Files Created/Modified**:
- `supabase/functions/recrawl-projects/index.ts` — New batch re-crawl function
- `supabase/functions/crawl-project/index.ts` — Added change detection logic
- `supabase/config.toml` — Added recrawl-projects config
- `src/pages/ProjectDetail.tsx` — Added Refresh button and handler
- `src/components/ProjectSignals.tsx` — Enhanced staleness colors

**How to test**:
1. Create or view a One Link project
2. Click "Refresh" button next to the source link
3. Verify "Last Checked" badge updates and shows green (fresh)
4. Wait 24+ hours to see badge turn yellow
5. Check edge function logs for nightly cron execution

**Next steps** (optional enhancements):
- Add change notification emails when bid_due_at changes
- Display change alert banner when `crawl_changes` is populated
- Add admin dashboard for monitoring re-crawl success rates

---

### Task 2.17: One Link HighSignalPanel & Enhanced Extraction [✅ COMPLETED]

**Goal**: Create read-only panel displaying high-signal project requirements extracted from One Link crawls, and enhance extraction to capture cost/bond/addenda fields.

**Status**: ✅ Completed 2026-01-12

**Deliverables**:

1. **HighSignalPanel Component**
   - New component: `src/components/HighSignalPanel.tsx`
   - Displays 5 risk signal columns in responsive grid:
     - Job Walk (status, date, details)
     - Eligibility Restrictions (status, notes)
     - Engineer's Estimate (formatted currency)
     - Bond Requirements (bid/payment/performance %)
     - Addenda (count, details)
   - Only renders for One Link projects with completed crawls
   - Graceful "Not detected" fallbacks for missing data

2. **Enhanced Semantic Extraction**
   - Updated LLM prompt in `crawl-project` to extract:
     - `engineers_estimate` (amount, currency, raw_text)
     - `bonds` (bid_bond_percent, payment_bond_percent, performance_bond_percent, notes)
     - `addenda` (count, details)
   - Added extraction rules for cost/bond/addenda patterns
   - All new fields stored in `crawl_snapshot.semantic`

3. **Integration**
   - Panel integrated into ProjectDetail page after ProjectSignals
   - Conditional render: only shows for source_url + last_crawled_at

**Files Modified**:
- `supabase/functions/crawl-project/index.ts` — Enhanced LLM prompts + schema
- `src/components/HighSignalPanel.tsx` — New component
- `src/pages/ProjectDetail.tsx` — Panel integration

**How to test**:
1. Create project from PlanetBids URL with visible estimate/bond info
2. Wait for crawl to complete
3. Verify HighSignalPanel displays extracted values
4. For projects without those fields, verify "Not detected" fallbacks

**Design Decisions**:
- No database schema changes — data stored in existing crawl_snapshot JSONB
- Panel is read-only — no edit capability
- Documents Access field removed as unnecessary

---

### Task 2.18: Calendar Viewport Fit [✅ COMPLETED]

**Goal**: Ensure entire calendar month fits within viewport without scrolling.

**Status**: ✅ Completed 2026-01-12

**Problem**: Last week of month was cut off, requiring scroll to view.

**Solution**:
- Updated `CalendarGrid.tsx` to use viewport-based height calculations
- Changed from fixed `min-h-[160px]` cells to dynamic height based on weeks count
- Updated `CalendarDashboard.tsx` to use flex layout filling remaining height

**Files Modified**:
- `src/components/CalendarGrid.tsx` — Dynamic cell heights
- `src/pages/CalendarDashboard.tsx` — Flex layout

**How to test**:
1. Navigate to /calendar
2. Verify all weeks of current month are visible without scrolling
3. Navigate between months, verify consistent fit

---

### Task 2.1: Add Countdown Timer to Bid Room [MVP]

**User Decision**: MVP feature (not v1)


**Location**: `src/pages/BidRoom.tsx`

- [ ] 2.1.1 Create CountdownTimer component
  - Location: `src/components/CountdownTimer.tsx`
  - Props: `bidDueAt: string`
  - Display format: "X days Y hours Z minutes" or "Expired"
  - Update every minute
  - Code snippet:
  ```typescript
  import { useEffect, useState } from 'react';

  interface CountdownTimerProps {
    bidDueAt: string;
  }

  export function CountdownTimer({ bidDueAt }: CountdownTimerProps) {
    const [timeLeft, setTimeLeft] = useState('');

    useEffect(() => {
      const calculateTimeLeft = () => {
        const now = new Date().getTime();
        const dueDate = new Date(bidDueAt).getTime();
        const diff = dueDate - now;

        if (diff <= 0) {
          setTimeLeft('Bid deadline has passed');
          return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        setTimeLeft(`${days}d ${hours}h ${minutes}m`);
      };

      calculateTimeLeft();
      const interval = setInterval(calculateTimeLeft, 60000); // Update every minute

      return () => clearInterval(interval);
    }, [bidDueAt]);

    return (
      <div className="text-center p-6 bg-soft-gray rounded-lg">
        <h3 className="text-sm uppercase tracking-wide text-muted-foreground mb-2">
          Time Remaining
        </h3>
        <p className="text-3xl font-bold text-accent-red">{timeLeft}</p>
      </div>
    );
  }
  ```

- [ ] 2.1.2 Integrate into BidRoom.tsx
  - Add below project name/info
  - Pin to top on mobile

**Design Reference**: design-guidelines.md (Countdown Timer - 200ms glow)

---

### Task 2.2: Late Bid Handling [MVP]

**User Decision**: Projects auto-transition to DEAD, but late bids are allowed and marked.

- [ ] 2.2.1 Add migration for late bid tracking
  ```sql
  -- Add submitted_late boolean to bids table
  ALTER TABLE public.bids 
  ADD COLUMN submitted_late boolean DEFAULT false;

  -- Create function to auto-update project status
  CREATE OR REPLACE FUNCTION public.auto_update_project_status()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $$
  BEGIN
    UPDATE public.projects
    SET status = 'DEAD'
    WHERE status = 'LIVE'
    AND bid_due_at < NOW();
  END;
  $$;
  ```

- [ ] 2.2.2 Add cron job or trigger for status updates
  - Option A: Supabase pg_cron extension (runs hourly)
  - Option B: Check on page load in Projects.tsx

- [ ] 2.2.3 Update bid submission to check deadline
  - Location: `src/pages/BidRoom.tsx` line ~139
  - Compare `new Date()` with `project.bid_due_at`
  - Set `submitted_late: true` in insert if past deadline
  - Code:
  ```typescript
  const isLate = new Date() > new Date(project.bid_due_at);
  
  const { error: bidError } = await supabase.from('bids').insert({
    project_id: project.id,
    bidder_name: data.bidder_name,
    company_name: data.company_name,
    email: data.email,
    bid_item: data.bid_item,
    file_url: fileUrl,
    file_name: file.name,
    submitted_late: isLate
  });
  ```

- [ ] 2.2.4 Display late badge in ProjectDetail.tsx
  - Show "⚠️ LATE" badge on late submissions
  - Filter/sort options: "On-time only" vs "All bids"

**References**: masterplan.md (Bid Deadline Clarity)

---

### Task 2.3: Make Location/Agency Fields Optional [✅ COMPLETED]

**User Decision**: Keep fields, mark as optional in UI

- [x] 2.3.1 Update NewProject.tsx form
  - Change labels: "Location (optional)" and "Agency (optional)"
  - Remove Zod `.nonempty()` requirement
  - Database columns made nullable via migration

- [x] 2.3.2 Update ProjectDetail.tsx display
  - Show placeholder text if empty: "Not specified"

**References**: masterplan.md (No-Fluff Philosophy)

---

### Task 2.3.5: Update PRD with Final Branding [✅ COMPLETED]

**User Decision**: Document finalized blue branding across all PRD files

- [x] 2.3.5.1 Update design-guidelines.md
  - Set BidBox Blue (#1D4ED8) as PRIMARY BRAND COLOR
  - Document usage: CTAs, links, accents, icons, sidebar logo
  - Clarify countdown digits remain black (not blue)
  - Add header/branding section with "BB" logo specifications
  - Remove duplicate "BidBox" text guidance

- [x] 2.3.5.2 Update masterplan.md
  - Add blue branding to UI Design Principles section
  - Document "BB" logo strategy
  - Specify white headers with blue accents

**References**: design-guidelines.md (Color System, Header & Branding)

---

### Task 2.3.6: Enhance Bid Room UI [✅ COMPLETED]

**User Decision**: Implement comprehensive UI improvements based on design mockup

- [x] 2.3.6.1 Orange drag-and-drop upload box
  - Changed "SUBMIT YOUR QUOTE" button to large drag-and-drop zone
  - Orange color (#F97316) with "+" icon and faint text
  - Aligned with Project Information card
  - Blue hover/focus border maintained

- [x] 2.3.6.2 Add GC Info to Project Information card
  - Added "GC:" field above Location
  - Fetches company_name from profiles table via gc_id
  - Shows "Add GC Info Here" in red if missing
  - Updated get-public-project edge function to include GC data

- [x] 2.3.6.3 Enhanced countdown timer
  - Format changed to: 07d:20h:22m:12s (with unit suffixes)
  - "BID DUE IN:" text made 2x larger, uppercase, bold
  - Added border separators above/below
  - Digits remain black as per design guidelines

- [x] 2.3.6.4 Horizontal file download layout
  - Files displayed in horizontal scroll container
  - Pill-style containers with file icons, names, download buttons
  - File type icons for PDF, Excel, and other formats
  - Neat spacing with hover effects

- [x] 2.3.6.5 Split-pane file preview
  - Created FilePreview component with left/right layout
  - Left: scrollable file list with file type icons
  - Right: preview pane (iframe for PDFs, placeholder for others)
  - Defaults to first file, shows "No files to preview" when empty

- [x] 2.3.6.6 Clickable BB logo
  - Made "BB" logo in top left clickable
  - Links to landing page (/)
  - Added hover opacity transition

**Files Modified**:
- src/pages/BidRoom.tsx (main UI changes)
- src/components/FilePreview.tsx (new component)
- supabase/functions/get-public-project/index.ts (GC company name)

**References**: design-guidelines.md (Color System, UI Components)

---

### Task 2.3.7: Fix Datetime Timezone Bug [✅ COMPLETED]

**Problem**: Datetime inputs were being interpreted in the user's browser timezone, causing inconsistent times across GCs in different locations. A GC selecting 10:00 AM might see it change to 1:00 PM or different dates due to automatic timezone conversions.

**User Decision**: Add explicit timezone selection so GCs intentionally choose their timezone, with consistent display everywhere.

- [x] 2.3.7.1 Database migration
  - Added `timezone` column to projects table (default: 'America/Los_Angeles')
  - Backfilled existing projects with PST

- [x] 2.3.7.2 Install date-fns-tz package
  - Added date-fns-tz@latest for proper timezone-aware date handling

- [x] 2.3.7.3 Create timezone utilities
  - Created `src/lib/timezoneUtils.ts` with:
    - `TIMEZONE_OPTIONS`: 6 US timezones (EST, CST, MST, PST, AKST, HST)
    - `localDateTimeToUtc()`: Convert local datetime + timezone → UTC for storage
    - `utcToLocalDateTime()`: Convert UTC from DB → local datetime for input
    - `formatInProjectTimezone()`: Format UTC for display in project's timezone

- [x] 2.3.7.4 Update NewProject.tsx
  - Added timezone dropdown with Select component
  - Default timezone: America/Los_Angeles (PST)
  - Convert datetime to UTC using selected timezone before saving
  - Updated Zod schema to require timezone

- [x] 2.3.7.5 Update ProjectDetail.tsx
  - Added timezone dropdown to edit section
  - Convert stored UTC to local datetime for editing
  - Track timezone changes in hasChanges detection
  - Convert edited datetime back to UTC with selected timezone on save

- [x] 2.3.7.6 Update Projects.tsx dashboard
  - Display bid due dates in project's timezone with zzz format
  - Shows "Dec 5, 2024 10:00 AM PST" correctly
  - Added timezone to Project interface and query

- [x] 2.3.7.7 Update BidRoom.tsx
  - Display bid due date in project's timezone
  - Shows "December 5, 2024 at 10:00 AM PST"
  - Countdown logic unchanged (uses UTC correctly)

- [x] 2.3.7.8 Edge function compatibility
  - Verified get-public-project automatically includes timezone (uses SELECT *)

**Expected Behavior**:
- GC in NYC selects 10:00 AM EST → stored as UTC → displayed as "10:00 AM EST" everywhere
- GC in LA selects 10:00 AM PST → stored as UTC → displayed as "10:00 AM PST" everywhere
- No browser timezone drift or date jumping
- Countdowns universally correct (based on UTC)

**Files Modified**:
- supabase/migrations/[timestamp]_add_timezone_column.sql (new)
- src/lib/timezoneUtils.ts (new)
- src/pages/NewProject.tsx
- src/pages/ProjectDetail.tsx
- src/pages/Projects.tsx
- src/pages/BidRoom.tsx

**References**: Custom knowledge (datetime bug fix), date-fns-tz documentation

---

### Task 2.4: Token Regeneration Feature [MVP]

**User Decision**: No expiration, YES to regeneration

- [ ] 2.4.1 Add "Regenerate Token" button to ProjectDetail.tsx
  - Location: Below current "Copy Link" button
  - Confirm dialog: "Old link will stop working. Regenerate?"
  - Code:
  ```typescript
  const regenerateToken = async () => {
    const newToken = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
    
    const { error } = await supabase
      .from('projects')
      .update({ public_token: newToken })
      .eq('id', projectId);

    if (!error) {
      toast({ title: 'Token regenerated. Update your shared links.' });
      loadProject(); // Refresh
    }
  };
  ```

- [ ] 2.4.2 Add UI warning about broken old links

**References**: app-flow-pages-and-roles.md (GC Admin Actions)

---

### Task 2.5: Settings Page Basic Structure [MVP]

**Location**: `src/pages/Settings.tsx`

- [ ] 2.5.1 Add basic profile editing
  - Company name
  - Email (display only, auth-controlled)
  - Save button

- [ ] 2.5.2 Add password change
  - Use Supabase auth updateUser()
  - Old password, new password, confirm

**Design Reference**: design-guidelines.md (Form Layouts)

---

## 🚀 Phase 3: v1 Features (Post-MVP)

### Task 3.1: Download All Bids as ZIP [v1]

**User Decision**: v1 feature (not MVP)

- [ ] 3.1.1 Create edge function `download-bids-zip`
  - Input: `{ project_id: string }`
  - Validate GC owns project
  - Fetch all bid files from storage
  - Create ZIP in-memory using JSZip
  - Return ZIP buffer
  - Code outline:
  ```typescript
  // Pseudocode - requires JSZip npm package in edge function
  import JSZip from 'npm:jszip';
  
  const zip = new JSZip();
  for (const bid of bids) {
    const file = await supabase.storage.from('bid-submissions').download(bid.file_url);
    zip.file(bid.file_name, file.data);
  }
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  return new Response(zipBuffer, {
    headers: { 'Content-Type': 'application/zip' }
  });
  ```

- [ ] 3.1.2 Add button to ProjectDetail.tsx
  - "Download All Bids (ZIP)"
  - Only show if bids > 0

**References**: implementation-plan.md (Phase 4 - Polish)

---

### Task 3.2: Email Notifications [v1]

**User Decision**: v1 feature (not MVP)

- [ ] 3.2.1 Set up Resend integration
  - Add RESEND_API_KEY secret
  - User must create Resend account

- [ ] 3.2.2 Create edge function `notify-bid-received`
  - Triggered after bid submission
  - Send email to GC with project name, bidder name, timestamp
  - Template:
  ```
  Subject: New Bid Received - [Project Name]
  
  A new bid has been submitted for your project "[Project Name]".
  
  Bidder: [Company Name]
  Submitted: [Timestamp]
  
  View all bids: [Link to ProjectDetail]
  ```

- [ ] 3.2.3 Call from BidRoom.tsx after successful submission
  - `supabase.functions.invoke('notify-bid-received', { body: { project_id, bid_id } })`

- [ ] 3.2.4 Add email preferences to Settings page
  - Toggle: "Email me when bids are received"

**References**: supabase-email-sending docs, masterplan.md (Communication)

---

### Task 3.3: CSV Export of Bids [v1]

- [ ] 3.3.1 Add "Export to CSV" button in ProjectDetail.tsx
  - Generate CSV client-side
  - Columns: Bidder Name, Company, Email, Bid Item, Submitted At, Late Status
  - Download as `[project-name]-bids.csv`

**References**: implementation-plan.md (Phase 4)

---

### Task 3.4: PDF Preview [v1]

- [ ] 3.4.1 Add react-pdf dependency
- [ ] 3.4.2 Create PDFViewer component
- [ ] 3.4.3 Integrate into BidRoom file list
  - "Preview" button for PDF files
  - Modal with embedded viewer

---

### Task 3.5: Basic Analytics Dashboard [v1]

- [ ] 3.5.1 Add new page: `/analytics`
- [ ] 3.5.2 Display metrics:
  - Total projects
  - Total bids received
  - Average bids per project
  - Most active projects
- [ ] 3.5.3 Use recharts for visualization

**References**: implementation-plan.md (Future Enhancements)

---

## 💳 Phase 4: Stripe Integration [✅ COMPLETED]

> **Status**: Phase 4 is complete. Stripe integration is now in **LIVE MODE**.
> 
> **What's working**:
> - Checkout flow creates Stripe sessions
> - Webhook processes payments and creates subscriptions
> - Free tier limit (3 projects) is enforced
> - Paid users get unlimited projects
> 
> **Optional remaining tasks**: 4.7.6 (bid room counter), 4.7.7 (Lifetime badge)

---

### Task 4.1: Stripe Account & Product Setup [✅ COMPLETED]

- [x] 4.1.1 Create Stripe account (in test mode)
- [x] 4.1.2 Create "Early Access Lifetime" product
- [x] 4.1.3 Set price to $199 one-time
- [x] 4.1.4 Copy API Keys (Secret Key stored in Lovable)
- [x] 4.1.5 Switch to Live Mode

**Test Mode Price ID**: `price_1SZFudHGNQLTHcjYQs0m5Jq6`
**Live Mode Price ID**: `price_1SbnchHGNQLTHcjYrmmMNh5G` ← Currently Active

---

### Task 4.2: Enable Stripe Integration [✅ COMPLETED]

- [x] 4.2.1 Store STRIPE_SECRET_KEY in Lovable secrets

---

### Task 4.3: Database Schema Updates [✅ COMPLETED]

- [x] 4.3.1 Add `stripe_customer_id` column to profiles table
- [x] 4.3.2 Create `subscriptions` table with:
  - `id`, `profile_id`, `stripe_customer_id`
  - `subscription_type`, `status`, `valid_until`
  - `created_at`, `updated_at`
- [x] 4.3.3 Enable RLS and create policies
- [x] 4.3.4 Create trigger for auto-updating `updated_at`

---

### Task 4.4: Create `create-checkout` Edge Function [✅ COMPLETED]

**Location**: `supabase/functions/create-checkout/index.ts`

- [x] 4.4.1 Authenticate user
- [x] 4.4.2 Check for existing Stripe customer
- [x] 4.4.3 Create checkout session (mode: "payment" for lifetime)
- [x] 4.4.4 Return checkout URL for redirect
- [x] 4.4.5 Configure with `verify_jwt = true`

---

### Task 4.5: Create `stripe-webhook` Edge Function [✅ COMPLETED]

**Location**: `supabase/functions/stripe-webhook/index.ts`

- [x] 4.5.1 Verify webhook signature
- [x] 4.5.2 Handle `checkout.session.completed` event
- [x] 4.5.3 Update profiles with `stripe_customer_id`
- [x] 4.5.4 Upsert subscription record
- [x] 4.5.5 Configure with `verify_jwt = false`

---

### Task 4.6: Register Webhook in Stripe Dashboard [✅ COMPLETED]

> **Completed in Live Mode**

- [x] 4.6.1 Add webhook endpoint:
  - URL: `https://ztuyjlyuzasbceepezua.supabase.co/functions/v1/stripe-webhook`
- [x] 4.6.2 Select event: `checkout.session.completed`
- [x] 4.6.3 Copy signing secret → stored as `STRIPE_WEBHOOK_SECRET`

---

### Task 4.7: Frontend Integration [✅ COMPLETED]

- [x] 4.7.1 Add checkout button to PricingMvp component
- [x] 4.7.2 Handle success/canceled URL params in Projects page
- [x] 4.7.3 Create `useSubscription` hook
- [x] 4.7.4 Display subscription status in Settings page
- [x] 4.7.5 Implement free tier limit (3 projects)
- [ ] 4.7.6 Add "X of 3 bid rooms used" display for free users (Optional)
- [ ] 4.7.7 Add "Lifetime" badge for paid users on dashboard (Optional)

**Files Created/Modified**:
- `src/hooks/useSubscription.tsx` (new)
- `src/components/PricingMvp.tsx` (updated with checkout)
- `src/pages/Projects.tsx` (payment params + project limit)
- `src/pages/Settings.tsx` (subscription status display)
- `src/pages/NewProject.tsx` (upgrade prompt when limit reached)
- `supabase/functions/create-checkout/index.ts` (new)
- `supabase/functions/stripe-webhook/index.ts` (new)

---

## 📊 Database Schema Reference

### Current Tables

**users** (Supabase Auth - don't modify)

**profiles**
```sql
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email text NOT NULL,
  company_name text,
  created_at timestamptz DEFAULT now()
);
-- RLS: Users can view/update own profile
```

**projects**
```sql
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gc_id uuid REFERENCES auth.users NOT NULL,
  name text NOT NULL,
  location text,  -- Optional
  agency text,    -- Optional
  bid_due_at timestamptz NOT NULL,
  instructions text,
  status text DEFAULT 'LIVE' CHECK (status IN ('LIVE', 'DEAD')),
  public_token text UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex'),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
-- RLS: GCs can CRUD own projects
-- NO public select policy (handled via edge function)
```

**project_files**
```sql
CREATE TABLE public.project_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects ON DELETE CASCADE NOT NULL,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size bigint,
  created_at timestamptz DEFAULT now()
);
-- RLS: GCs can manage files for their projects
-- NO public select policy (handled via edge function)
```

**bids**
```sql
CREATE TABLE public.bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects ON DELETE CASCADE NOT NULL,
  bidder_name text,
  company_name text,
  email text,
  bid_item text,
  file_name text NOT NULL,
  file_url text NOT NULL,
  submitted_late boolean DEFAULT false,  -- NEW in Task 2.2
  submitted_at timestamptz DEFAULT now()
);
-- RLS: GCs can view bids for their projects
-- Public can INSERT (anonymous bid submission)
CREATE POLICY "Anyone can submit bids" ON bids FOR INSERT WITH CHECK (true);
CREATE POLICY "GCs view their project bids" ON bids FOR SELECT 
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = bids.project_id AND projects.gc_id = auth.uid()));
```

---

## 🎨 Design System Reference

See `design-guidelines.md` for full details.

**Colors** (index.css):
- `--primary: #121212` (Black)
- `--accent-red: #D92D20` (Deadline urgency)
- `--soft-gray: #F4F4F5` (Backgrounds)
- `--link-blue: #1D4ED8` (Actions)
- `--success-green: #12B76A` (Confirmations)

**Typography**:
- H1: Inter Bold 28px
- H2: Inter Semibold 22px
- Body: Inter Regular 14px

**Motion**:
- File upload success: 250ms fade-in
- Link copy: 200ms glow
- Countdown: smooth tick

**Spacing**: 8pt grid system

---

## 💰 Pricing Structure Reference

**Current Pricing Tiers:**

| Tier | Price | Bid Rooms | Status |
|------|-------|-----------|--------|
| Free | $0 | 3 projects | Active |
| Early Access Lifetime | $199 (one-time) | Unlimited | Active (Featured) |
| Tier 1 | $49/month | Unlimited | Future (Commented out) |

**Features per Tier:**
- **Free Plan**:
  - Up to 3 bid rooms
  - File sharing & uploads
  - Public bid pages
  - Basic support
  
- **Early Access Lifetime**:
  - Unlimited bid rooms
  - Priority support
  - Early access to new features
  - One-time payment, lifetime access
  - **Limited offer** banner/badge

**CTA Copy:**
- Free: "Start Free"
- Lifetime: "Claim Lifetime Access"

**Notes:**
- Free tier requires no Stripe product
- Early Access is the featured/highlighted plan
- Tier 1 ($49/month) exists in code but is commented out for future use
- Pricing displayed in `src/components/PricingMvp.tsx`

---

## ✅ Testing Checklist

Before marking MVP complete:

### Security Tests
- [ ] Try accessing projects without token → should fail
- [ ] Try accessing files without token → should fail
- [ ] Upload invalid file type → should reject
- [ ] Upload 201MB file → should reject
- [ ] Verify GC can only see their own bids

### Functionality Tests
- [ ] Create project with files
- [ ] Share public link, open in incognito
- [ ] Submit bid as anonymous user
- [ ] Download project files from bid room
- [ ] Verify countdown timer updates
- [ ] Submit late bid, verify "LATE" badge
- [ ] Regenerate token, verify old link breaks
- [ ] Delete project, verify files removed

### UI/UX Tests
- [ ] Mobile responsive on all pages
- [ ] Countdown timer pinned on mobile
- [ ] File upload shows progress
- [ ] Toast notifications appear correctly
- [ ] Dark mode works (if implemented)

---

## 📝 Notes

- **File Upload Performance**: For 150-200MB files, Supabase Storage handles this well. No chunking needed for MVP.
- **Bandwidth Cost**: ~$0.27 per project with 20 subs downloading (negligible).
- **Storage Cost**: ~100MB per project average = very cheap on Supabase.
- **Security**: Phase 0 tasks are BLOCKERS. Do not proceed to Phase 2 until complete.
- **Token Security**: No expiration by design (user decision). Regeneration is the security mechanism.

---

## 🔗 Document References

- `masterplan.md` - Product vision, target users, core principles, Network Pool Moat Strategy
- `gc-control-center-prd.md` - GC Control Center strategic PRD
- `implementation-plan.md` - Build sequence with Phases 3.5-7, CSLB Pipeline Architecture
- `design-guidelines.md` - Brand voice, colors, layout rules, motion
- `app-flow-pages-and-roles.md` - Page structure, user journeys, permissions
- `cslb-license-types.md` - California license type reference
- `tasks.md` (this doc) - Implementation source of truth

---

## 🎯 Phase 3.5: Trade Selection Layer [✅ COMPLETED]

> **Status**: Fully implemented. Database architecture with state-agnostic design and frontend trade selection UI complete.

### ⚠️ ARCHITECTURAL PRINCIPLE

> **The licensing system is STATE-AGNOSTIC.** California CSLB is the initial seed data, but the architecture supports nationwide expansion without code changes. All trade references use `trade_type_id` foreign keys, NEVER hard-coded license code strings.

### Task 3.5.0: Create `trade_types` Reference Table [✅ COMPLETED]

- [x] Database migration to create state-agnostic table:
  ```sql
  CREATE TABLE public.trade_types (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    state_code text,                    -- "CA", "TX", "FL", null for national
    code text NOT NULL,                 -- "C-10", "Roofing", etc.
    name text NOT NULL,                 -- "Electrical"
    category text,                      -- "Mechanical", "Civil", etc.
    source text,                        -- "CSLB", "TDLR", "DBPR", "CUSTOM"
    is_default boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    UNIQUE(state_code, code)
  );

  -- RLS: Everyone can read, admins can modify
  ALTER TABLE public.trade_types ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "Anyone can view trade types"
    ON public.trade_types FOR SELECT USING (true);

  CREATE POLICY "Admins can manage trade types"
    ON public.trade_types FOR ALL
    USING (public.has_role(auth.uid(), 'admin'));
  ```

### Task 3.5.1: Create `project_trades` Table [✅ COMPLETED]

- [x] Database migration with FK to trade_types:
  ```sql
  CREATE TABLE public.project_trades (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid REFERENCES projects ON DELETE CASCADE NOT NULL,
    trade_type_id uuid REFERENCES trade_types(id) NOT NULL,  -- FK, not strings!
    created_at timestamptz DEFAULT now(),
    UNIQUE(project_id, trade_type_id)
  );

  -- RLS: GCs can manage trades for their projects
  ALTER TABLE public.project_trades ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "GCs can view/add/delete trades for their projects"
    ON public.project_trades FOR ALL
    USING/WITH CHECK (EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_trades.project_id
      AND projects.gc_id = auth.uid()
    ));
  ```

### Task 3.5.2: Seed California CSLB License Types [✅ COMPLETED]

- [x] 43 trade types seeded with:
  - `state_code = 'CA'`
  - `source = 'CSLB'`
  - Categories: General, Mechanical, Electrical, Structural, Civil, Finishes, Site Work, etc.
- [x] Includes: A, B, C-4 through C-61 (full CSLB specialty list)

### Task 3.5.2.1: Add C-61 Limited Specialty D-Codes [✅ COMPLETED]

- [x] Added `parent_code`, `is_active`, `notes` columns to `trade_types` table
- [x] Added index on `parent_code` for efficient lookups
- [x] Inserted all 29 authoritative D-codes from CSLB portal:
  - C-61/D-3 through C-61/D-65 (active codes only)
  - All with `parent_code = 'C-61'`, `is_active = true`
- [x] Updated `TradeType` interface with new fields
- [x] Updated `fetchTradeTypes()` to filter by `is_active = true`
- [x] Updated `groupTradesByCategory()` to nest D-codes under C-61
- [x] Added `isDCode()` helper function
- [x] Updated `TradeMultiSelect` component to indent D-codes
- [x] Updated `docs/cslb-license-types.md` with authoritative D-code list
- [x] Deprecated/legacy D-codes intentionally excluded (D-1, D-2, etc.)

**Notes**: Implementation maintains full compatibility with CSLB ingestion, Network Pool, and Call List Generator. D-codes use exact CSLB format (`C-61/D-34`) with no translation layer.

### Task 3.5.3: Add Trade Multi-Select to `/projects/new` [✅ COMPLETED]

- [x] Create `src/lib/tradeTypes.ts` utility
  - Fetch trade types from database (NOT hard-coded constants)
  - Filter by `state_code = 'CA'` for MVP
  - Group by category for UI display
- [x] Add trade multi-select component to NewProject.tsx
- [x] Display selected trades as chips/tags with category colors
- [x] Store selected `trade_type_id` values

### Task 3.5.4: Update Project Creation Logic [✅ COMPLETED]

- [x] Add `selectedTradeIds` state to form
- [x] Insert selected `trade_type_id`s into `project_trades` after project creation
- [x] Trade selection is optional (not in Zod schema, stored separately)

### Task 3.5.5: Display Trades on Project Admin Page [✅ COMPLETED]

- [x] Query `project_trades` joined with `trade_types`
- [x] Show trade chips on `/projects/[id]` with category-based colors
- [x] Allow editing trades (add/remove) via modal dialog

---

## ✅ Phase 4: Subcontractor Directory

### Phase 4 Subcontractor Status

**Completed:**
- [x] Task 4.1: `subcontractors` table (BidBox Network Pool)
- [x] Task 4.2: `gc_subcontractors` table (GC Private Pool)
- [x] Task 4.3: Directory Management UI at `/settings/subcontractors`
- [x] Task 4.4: Junction tables for trade mapping (`sub_trade_mappings`, `gc_sub_trade_mappings`)
- [x] Admin Network Seeder UI at `/admin/network-subs`
- [x] CSLB License Lookup edge function (`lookup-cslb`) with caching (`cslb_cache` table)

**Remaining:**
- [ ] Task 4.5: Seed BidBox Network Pool (see Phase 7)

---

### ⚠️ IMPORTANT: All subcontractor tables use `trade_type_id` FK, NOT hard-coded license strings

### Task 4.1: Create `subcontractors` Table (BidBox Network Pool) [✅ COMPLETED]

- [x] Database migration (starts empty, seed later):
  ```sql
  CREATE TABLE public.subcontractors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name text NOT NULL,
    trade_type_id uuid REFERENCES trade_types(id),  -- FK, not strings!
    license_number text,
    email text,
    phone text,
    city text,
    state_code text DEFAULT 'CA',                   -- For multi-state filtering
    service_area text,
    is_verified boolean DEFAULT false,
    created_at timestamptz DEFAULT now()
  );

  -- Public read verified, admin write
  ALTER TABLE public.subcontractors ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "Anyone can view verified subcontractors"
    ON public.subcontractors FOR SELECT
    USING (is_verified = true);
  ```

### Task 4.2: Create `gc_subcontractors` Table (GC's Private Pool) [✅ COMPLETED]

- [x] Database migration:
  ```sql
  CREATE TABLE public.gc_subcontractors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    gc_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    company_name text NOT NULL,
    trade_type_id uuid REFERENCES trade_types(id),  -- FK, not strings!
    contact_name text,
    email text,
    phone text,
    notes text,
    created_at timestamptz DEFAULT now()
  );

  -- RLS: GCs can only see/manage their own subs
  ALTER TABLE public.gc_subcontractors ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "GCs can manage their own subcontractors"
    ON public.gc_subcontractors FOR ALL
    USING (gc_id = auth.uid());
  ```

### Task 4.3: Build Directory Management UI [✅ COMPLETED]

- [x] Create `/subcontractors` page or section in settings → `/settings/subcontractors`
- [x] Add/edit/delete private subs UI (select trade from `trade_types` dropdown via `TradeMultiSelect`)
- [x] Admin Network Seeder at `/admin/network-subs` for managing BidBox Network Pool

### Task 4.4: Map Subs to Project Trades [✅ COMPLETED]

- [x] Junction tables created (`gc_sub_trade_mappings`, `sub_trade_mappings`)
- [x] Auto-match subs by `trade_type_id` (FK join, not string matching)
- [ ] Display matched subs per trade (planned for Phase 6: Call List Generator)

### Task 4.5: Seed BidBox Network Pool (FUTURE)

- [ ] Compile list of California public works subcontractors
- [ ] Map each to appropriate `trade_type_id`
- [ ] Import into `subcontractors` table
- [ ] Mark verified subs

> **Note:** See Phase 7: CSLB Network Directory Seeding Initiative for detailed seeding strategy

---

## 🎯 Phase 5: Engagement Tracking (NEW)

> **Planned**: Track subcontractor engagement with bid rooms

### Task 5.1: Track Plan Views

- [ ] Enhance existing `view_count` or create detailed tracking
- [ ] Consider per-sub tracking (requires sub identification)

### Task 5.2: Track File Downloads

- [ ] Create `file_downloads` table or add tracking column
- [ ] Log which files were downloaded

### Task 5.3: Display Engagement Status

- [ ] Status enum: Not opened / Viewed / Downloaded / Submitted
- [ ] Display in sub list for each project

---

## 🎯 Phase 6: Bid List Generator [✅ COMPLETED]

> **Status**: Completed 2025-12-28

### Task 6.1: Build Bid List Generator Service [✅ COMPLETED]

- [x] Create `src/lib/bidListGenerator.ts`
- [x] Fetch from GC Private Pool (gc_subcontractors)
- [x] Fetch from Network Pool (subcontractors) with CLEAR license status
- [x] Filter by project's selected trades
- [x] Deduplicate network subs by matching license_number against private pool
- [x] Return separate arrays: `{ privateSubs, networkSubs }`

### Task 6.2: Two-Sheet Excel Export [✅ COMPLETED]

- [x] Add `exportBidListToExcel()` to `src/lib/excelExport.ts`
- [x] Sheet 1: "My Subs" - Company Name, Contact Name, Phone, Email, City, Trades, Notes
- [x] Sheet 2: "Network Subs" - Business Name, License #, Phone, City, County, Classification(s)
- [x] Use xlsx library for client-side generation

### Task 6.3: BidListButton Component [✅ COMPLETED]

- [x] Create `src/components/BidListButton.tsx`
- [x] Disabled state when no trades selected
- [x] Loading spinner during generation
- [x] Toast notifications for success/error/empty results
- [x] Icon: FileSpreadsheet from lucide-react

### Task 6.4: Integration [✅ COMPLETED]

- [x] Replace CallListButton with BidListButton in ProjectDetail.tsx
- [x] Button location: Bid Box Link section
- [x] Props: projectId, projectName, gcId, hasSelectedTrades

**Implementation Notes:**
- Private pool subs take priority in deduplication (license_number matching)
- Network pool only returns CLEAR license status subs
- Both sheets created even if one pool is empty
- Export blocked with helpful toast if no trades selected

---

### Task 6.4.1: Fix Network Subs Trade Bias Bug [✅ COMPLETED]

**Problem**: Network Subs export was dominated by C-20 (HVAC) contractors even when multiple trades were selected.

**Root Cause**: Supabase's default 1000-row limit on `.in('trade_type_id', tradeIds)` query was truncating results, creating bias toward first trades in insertion order.

**Solution**: 
- Changed from single `.in()` query to per-trade iteration
- Each trade queried separately with limit(50000)
- Results unioned via Set for deduplication
- All trades now represented proportionally

**Files Modified**: `src/lib/bidListGenerator.ts`

---

### Task 6.5: California County-Based Regional Filtering [✅ COMPLETED]

**Objective**: Reduce Network Subs export from thousands to a geographically-relevant subset based on project county.

**Implementation**:
- [x] 6.5.1 Database migration: `projects.county` column (text, nullable for legacy)
- [x] 6.5.2 Create `src/lib/californiaRegions.ts`
  - Static mapping of 58 CA counties to 3 regions
  - Regions: Southern CA (7 counties), Central CA (17 counties), Northern CA (34 counties)
  - Utility functions: `getRegionForCounty()`, `getCountiesInRegion()`, `isValidCACounty()`
- [x] 6.5.3 Create `src/components/CountySelect.tsx`
  - Searchable dropdown (type-ahead)
  - Shows county name with region indicator
- [x] 6.5.4 Update NewProject.tsx
  - Replace free-form "Location" with required county selector
  - County stored in `projects.county`
- [x] 6.5.5 Update ProjectDetail.tsx
  - Add county editing capability
  - Pass county to BidListButton
- [x] 6.5.6 Update BidListButton.tsx
  - Block export if county missing with guidance toast
  - Validate county is in CA_COUNTIES list
- [x] 6.5.7 Update bidListGenerator.ts
  - Derive region from project county
  - Filter Network Subs by `.in('county', allowedCounties)`
  - My Subs remain unfiltered (geographic freedom for private pool)

**Expected Outcome**:
- Network Subs reduced from ~6,500 to ~1,000-2,500 per region
- Legacy projects (no county) blocked with guidance
- Logs show region filtering behavior

**Files Created/Modified**:
- `src/lib/californiaRegions.ts` (new)
- `src/components/CountySelect.tsx` (new)
- `src/pages/NewProject.tsx`
- `src/pages/ProjectDetail.tsx`
- `src/components/BidListButton.tsx`
- `src/lib/bidListGenerator.ts`

---

## 🚀 Phase 7: CSLB Network Directory Seeding Initiative

> **Status**: ✅ COMPLETE (Verified 2026-01-04)

This phase documents the strategic initiative to populate the BidBox Network Pool with verified CSLB-licensed contractors, creating a long-term competitive moat.

### ✅ INGESTION COMPLETE — Verification Stats (2026-01-04)

| Metric | Value |
|--------|-------|
| **Network Pool Count** | 232,660 contractors |
| **CSLB Active Count** | 229,933 (as of verification date) |
| **Coverage Ratio** | 101.19% (includes recently-expired licenses) |
| **Trade Coverage** | 98.67% of contractors mapped to trades |
| **Spot-Check Accuracy** | 100% (10 random licenses verified) |
| **Weekly Refresh** | Active (Sundays 2:00 AM UTC) |

---

### Phase 7.0: Initiative Overview

**Objective:** Seed the BidBox Network Directory with 290,000+ California CSLB-licensed contractors to provide GCs with instant subcontractor coverage.

**Success Metrics:**
- [x] 50,000+ "hot trade" contractors seeded (Tier 1) — **232,660 total**
- [x] 80%+ trade coverage for California public works projects — **98.67%**
- [x] <5% duplicate rate after normalization — **0% (license_number unique)**
- [x] Average lookup time <100ms (via caching) — **cslb_cache active**

**Legal/Operational Guardrails:**
- CSLB data is publicly available on cslb.ca.gov
- Scraping must be rate-limited (max 1 request/second) to avoid IP blocks
- BidBox is NOT a licensed contractor verification authority
- We provide convenience + pre-classification, not official verification
- Data is for internal GC use, not public redistribution
- Subs can request removal if desired (GDPR-like process)

---

### Phase 7.1: Foundational Architecture [✅ MOSTLY COMPLETE]

**Existing Infrastructure:**
- [x] 7.1.1 `subcontractors` table (BidBox Network Pool) with `is_verified` flag
- [x] 7.1.2 `sub_trade_mappings` junction table (multi-trade support per sub)
- [x] 7.1.3 `cslb_cache` table for lookup caching (30-day TTL)
- [x] 7.1.4 State-agnostic `trade_type_id` FK architecture
- [x] 7.1.5 `lookup-cslb` edge function with HTML parsing
- [x] 7.1.6 Optimized `cslb-ingest-master` to skip offsets without parsing (prevents CPU timeouts at 200k+ offsets)
- [x] 7.1.9 Enhanced `cslb-ingest-master` progress logging
  - Added license range logging per batch (e.g., "Batch: 250 contractors | range: 1126353-1126654")
  - Added milestone logging every 1000 active contractors
  - Added clear continuation instructions in summary output
  - Date Completed: 2026-01-01

**Planned Extensions:**
- [ ] 7.1.6 Document CSLB classification → `trade_type_id` mapping rules
  - Map CSLB codes (A, B, C-4, C-10, etc.) to `trade_types.id`
  - Handle multi-classification contractors (e.g., "C-10, C-46")
  - Create mapping lookup table or function

- [ ] 7.1.7 Define data normalization standards
  - Phone format: (XXX) XXX-XXXX
  - Company name capitalization: Title Case
  - City normalization: Match to standardized city list
  - Remove "Inc.", "LLC", "Corp." variations for matching

- [ ] 7.1.8 Define deduplication strategy
  - Primary key: `license_number` (unique per contractor)
  - Handle name variations (DBA names, typos)
  - Merge strategy for existing entries

---

### Phase 7.2: Tier 1 — Hot Trade Seeding

**Objective:** Seed the highest-demand trades first to maximize early GC value.

**Target Trades (Top 15-20 CSLB Classifications):**
| Priority | Code | Trade Name | Est. License Count |
|----------|------|------------|-------------------|
| 1 | C-10 | Electrical | ~45,000 |
| 2 | C-20 | HVAC | ~35,000 |
| 3 | C-36 | Plumbing | ~25,000 |
| 4 | C-8 | Concrete | ~20,000 |
| 5 | C-12 | Earthwork & Paving | ~15,000 |
| 6 | C-33 | Painting | ~18,000 |
| 7 | C-27 | Landscaping | ~12,000 |
| 8 | C-43 | Sheet Metal | ~8,000 |
| 9 | C-4 | Boiler/Hot Water | ~5,000 |
| 10 | C-7 | Low Voltage | ~15,000 |
| 11 | C-15 | Flooring | ~10,000 |
| 12 | C-17 | Glazing | ~6,000 |
| 13 | C-39 | Roofing | ~12,000 |
| 14 | C-46 | Solar | ~8,000 |
| 15 | C-54 | Tile | ~7,000 |

**Tasks:**
- [ ] 7.2.1 Research Firecrawl vs headless browser for CSLB scraping
  - Firecrawl preferred (already documented in project)
  - Fallback: Puppeteer/Playwright in edge function

- [ ] 7.2.2 Implement batch CSLB scraper edge function
  - Input: Trade classification code (e.g., "C-10")
  - Output: List of contractors with license data
  - Rate limiting: 1 request/second
  - Batch size: 100-500 licenses per job

- [ ] 7.2.3 Implement resumable harvesting mechanism
  - Track last-processed license number
  - Support pause/resume for long-running jobs
  - Error recovery with retry logic

- [ ] 7.2.4 Create admin seeding dashboard
  - Progress tracking per trade
  - Start/pause/resume controls
  - Error log viewing

- [ ] 7.2.5 Seed ~50,000 "hot trade" contractors
  - Run Tier 1 trades through pipeline
  - Verify data quality via spot checks

- [ ] 7.2.6 Quality assurance
  - Verify trade mapping accuracy
  - Check for duplicates
  - Validate phone/email formats

---

### Phase 7.3: Tier 2 — Full CSLB Harvest

**Objective:** Extend scraping to all 290,000+ CSLB license holders for complete statewide coverage.

**Tasks:**
- [ ] 7.3.1 Extend scraper to all remaining CSLB classifications
  - General A, General B
  - All C-specialty classes (C-4 through C-61)
  - Hazardous Substance Removal (HAZ)

- [ ] 7.3.2 Implement background job processing
  - Supabase pg_cron or external scheduler
  - Batches of 100-500 licenses
  - Run during off-peak hours

- [ ] 7.3.3 Add progress tracking and resumability
  - Dashboard showing overall progress (X/290,000)
  - ETA calculation
  - Failure rate monitoring

- [ ] 7.3.4 Complete statewide network population
  - Target: 290,000+ contractors
  - Timeline: 2-4 weeks of background seeding

---

### Phase 7.4: Tier 3 — Network Enrichment

**Objective:** Add additional contact information beyond CSLB data.

**Tasks:**
- [ ] 7.4.1 Email lookup integration
  - Hunter.io, Clearbit, or similar API
  - Verify email deliverability
  - Cost analysis per lookup

- [ ] 7.4.2 Website scraping for additional contact info
  - Extract email/phone from contractor websites
  - Firecrawl branding extraction for company logos

- [ ] 7.4.3 Phone number validation and formatting
  - Verify phone numbers are active
  - Format to (XXX) XXX-XXXX standard

- [ ] 7.4.4 Flag outdated/expired licenses
  - Nightly cron to check expirations
  - Visual indicator in network pool
  - Auto-hide expired licenses from GC view

---

### Phase 7.5: Excel Import (GC Bulk Upload)

**Objective:** Allow GCs to upload their existing subcontractor spreadsheets and auto-enrich with CSLB data.

**User Flow:**
1. GC uploads .xlsx/.csv file
2. System parses columns (may use AI for column detection)
3. For each row with license_number → CSLB lookup
4. Auto-fill: company_name, license_status, expiration, classifications
5. Map classifications to `trade_type_id`
6. Insert into `gc_subcontractors` + `gc_sub_trade_mappings`
7. Show import summary (success/errors)

**Tasks:**
- [ ] 7.5.1 Create `bulk-import-subs` edge function
  - Accept .xlsx/.csv file upload
  - Parse rows using xlsx library

- [ ] 7.5.2 Implement column detection
  - Option A: Fixed column order with template
  - Option B: AI-powered column detection (OpenAI)
  - Detect: license_number, company_name, contact_name, phone, email

- [ ] 7.5.3 Auto-detect license numbers and run CSLB lookups
  - Validate license format (7-digit number)
  - Batch CSLB lookups with rate limiting

- [ ] 7.5.4 Handle partial matches and manual fallback
  - Show preview before import
  - Allow GC to fix/skip problematic rows

- [ ] 7.5.5 Provide template download for GCs
  - Excel template with expected columns
  - Instructions in first row

- [ ] 7.5.6 Show import progress and error summary
  - Progress bar during import
  - Summary: "Imported 45/50, 5 errors (click to view)"

---

### Phase 7.6: Compliance & Scheduled Jobs

**Objective:** Keep network data fresh and alert GCs to compliance issues.

#### ✅ COMPLETED: Weekly CSLB Data Refresh

- [x] 7.6.0 Weekly CSLB data refresh cron job
  - **Schedule:** Every Sunday at 2:00 AM UTC (`0 2 * * 0`)
  - **Job Name:** `cslb-weekly-refresh`
  - **Endpoint:** `cslb-ingest-master` with `offset: 0`
  - **Purpose:** Full re-sync of all active CSLB contractors
  - **Implementation:** pg_cron + pg_net extensions
  - **Date Completed:** 2024-12-28

#### ✅ COMPLETED: Network Pool Gap Recovery (Task 7.6.4)

**Issue Identified:** 2026-01-01  
**Problem:** Data coverage gap in license range ~949,979 to ~961,145 (approximately 11,000+ missing licenses).

**Resolution:** Full re-ingestion completed successfully.

**Final Status (2026-01-04):**
- [x] Identified gap via database query analysis
- [x] Enhanced edge function logging for progress tracking
- [x] Re-deployed `cslb-ingest-master` edge function
- [x] Initiated full re-ingestion from offset 0
- [x] Completed ingestion through all ~241,000 rows

**Final Verification:**
| Metric | Value |
|--------|-------|
| Network Pool Count | 232,660 |
| CSLB Sample Active | 229,933 |
| Coverage | 101.19% |
| Spot-Check Accuracy | 100% (10 licenses verified) |
| Trade Coverage | 98.67% |

**Verification Method:** `cslb-verify-count` edge function samples first 76MB of CSLB CSV, compares active count to Network Pool.

**Files Modified:** `supabase/functions/cslb-ingest-master/index.ts`, `supabase/functions/cslb-verify-count/index.ts`

---

**Tasks:**
- [x] 7.6.1 Create weekly cron job for full CSLB refresh
  - Query CSLB for status changes
  - Update `license_status` and `license_expiration`

- [ ] 7.6.2 Flag expired/inactive licenses in Network Pool
  - Add `is_active` computed field
  - Visual badge: "Expired", "Inactive", "Suspended"

- [ ] 7.6.3 Add compliance alerts for GCs (Future)
  - Notify when a private pool sub's license expires
  - Dashboard section showing upcoming expirations

---

### Phase 7 Timeline Estimate

| Sub-Phase | Duration | Dependencies |
|-----------|----------|--------------|
| 7.0 Initiative Planning | 1 day | None |
| 7.1 Architecture Extensions | 2-3 days | 7.0 |
| 7.2 Tier 1 Hot Trade Seeding | 1-2 weeks | 7.1 |
| 7.3 Tier 2 Full Harvest | 2-4 weeks | 7.2 |
| 7.4 Tier 3 Enrichment | Ongoing | 7.3 |
| 7.5 Excel Import | 3-5 days | 7.1 |
| 7.6 Compliance Jobs | 2-3 days | 7.3 |

**Total Estimate:** 4-8 weeks for Tiers 1-2, ongoing for enrichment

---

## 🛰️ Opportunity Intelligence / Agent Architecture

The detailed source of truth for worker architecture, PlanetBids scraping, agency expansion, document collection, and future portal drivers is:

`docs/agent-architecture-task-list.md`

Keep this broad product task list focused on app-wide implementation history and backlog. Do not duplicate detailed agent/opportunity tasks here.

---

**End of tasks.md**
