# BidBox Implementation Tasks

**Source of Truth for Feature Implementation**  
Last Updated: 2025-11-30

---

## 📋 Task Status Legend

- [ ] Not Started
- [x] Completed
- [🔄] In Progress
- [⚠️] Blocked/Needs Review

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

## 💳 Phase 4: Stripe Integration

### Task 4.1: Stripe Account & Product Setup [✅ COMPLETED]

- [x] 4.1.1 Create Stripe account (in test mode)
- [x] 4.1.2 Create "Early Access Lifetime" product
- [x] 4.1.3 Set price to $199 one-time
- [x] 4.1.4 Copy API Keys (Secret Key stored in Lovable)

**Price ID**: `price_1SZFudHGNQLTHcjYQs0m5Jq6`

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

### Task 4.6: Register Webhook in Stripe Dashboard [⚠️ PENDING - MANUAL]

> **User Action Required**: Complete in Stripe Dashboard

- [ ] 4.6.1 Add webhook endpoint:
  - URL: `https://ztuyjlyuzasbceepezua.supabase.co/functions/v1/stripe-webhook`
- [ ] 4.6.2 Select event: `checkout.session.completed`
- [ ] 4.6.3 Copy signing secret → stored as `STRIPE_WEBHOOK_SECRET`

---

### Task 4.7: Frontend Integration [✅ COMPLETED]

- [x] 4.7.1 Add checkout button to PricingMvp component
- [x] 4.7.2 Handle success/canceled URL params in Projects page
- [x] 4.7.3 Create `useSubscription` hook
- [x] 4.7.4 Display subscription status in Settings page
- [x] 4.7.5 Implement free tier limit (3 projects)
- [ ] 4.7.6 Add "X of 3 bid rooms used" display for free users (Not Started)
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

- `masterplan.md` - Product vision, target users, core principles
- `gc-control-center-prd.md` - GC Control Center strategic PRD (NEW)
- `implementation-plan.md` - Updated build sequence with Phases 3.5-6
- `design-guidelines.md` - Brand voice, colors, layout rules, motion
- `app-flow-pages-and-roles.md` - Page structure, user journeys, permissions
- `cslb-license-types.md` - California license type reference (NEW)
- `tasks.md` (this doc) - Implementation source of truth

---

## 🎯 Phase 3.5: Trade Selection Layer (NEW)

> **Next Up**: This phase enables the GC Control Center foundation

### Task 3.5.1: Create `project_trades` Table

- [ ] Database migration to create table:
  ```sql
  CREATE TABLE public.project_trades (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid REFERENCES projects ON DELETE CASCADE NOT NULL,
    trade_code text NOT NULL,        -- e.g., "C-10"
    trade_name text NOT NULL,        -- e.g., "Electrical"
    created_at timestamptz DEFAULT now()
  );

  -- RLS: GCs can manage trades for their projects
  ALTER TABLE public.project_trades ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "GCs can manage trades for their projects"
    ON public.project_trades FOR ALL
    USING (EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_trades.project_id
      AND projects.gc_id = auth.uid()
    ));
  ```

### Task 3.5.2: Compile CSLB License Type List (SEPARATE TASK)

- [ ] Review `docs/cslb-license-types.md`
- [ ] Finalize list collaboratively
- [ ] Create constants file or database reference table

### Task 3.5.3: Add Trade Multi-Select to `/projects/new`

- [ ] Add trade multi-select component
- [ ] Use CSLB license types as options
- [ ] Display selected trades as chips/tags
- [ ] Validate at least one trade selected (optional)

### Task 3.5.4: Update Project Creation Logic

- [ ] Insert selected trades into `project_trades` table on project create
- [ ] Update Zod schema if needed

### Task 3.5.5: Display Trades on Project Admin Page

- [ ] Show trade chips on `/projects/[id]`
- [ ] Allow editing trades (add/remove)

---

## 🎯 Phase 4: Subcontractor Directory (NEW)

> **Planned**: Two-pool subcontractor architecture

### Task 4.1: Create `subcontractors` Table (BidBox Network Pool)

- [ ] Database migration (starts empty, seed later):
  ```sql
  CREATE TABLE public.subcontractors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name text NOT NULL,
    license_type text NOT NULL,
    license_number text,
    email text,
    phone text,
    city text,
    service_area text,
    is_verified boolean DEFAULT false,
    created_at timestamptz DEFAULT now()
  );

  -- Public read, admin write
  ALTER TABLE public.subcontractors ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "Anyone can view verified subcontractors"
    ON public.subcontractors FOR SELECT
    USING (is_verified = true);
  ```

### Task 4.2: Create `gc_subcontractors` Table (GC's Private Pool)

- [ ] Database migration:
  ```sql
  CREATE TABLE public.gc_subcontractors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    gc_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    company_name text NOT NULL,
    license_type text,
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

### Task 4.3: Build Directory Management UI

- [ ] Create `/subcontractors` page or section in settings
- [ ] Add/edit/delete private subs UI
- [ ] View network subs (read-only)

### Task 4.4: Map Subs to Project Trades

- [ ] Auto-match subs by license_type to project trades
- [ ] Display matched subs per trade

### Task 4.5: Seed BidBox Network Pool (FUTURE)

- [ ] Compile list of California public works subcontractors
- [ ] Import into `subcontractors` table
- [ ] Mark verified subs

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

## 🎯 Phase 6: Call List Generator (NEW)

> **Planned**: Generate ranked Excel call lists for bid day

### Task 6.1: Build Ranking Logic

- [ ] Priority ranking:
  1. Not opened → highest priority (needs outreach)
  2. Viewed but not downloaded (interested, stalled)
  3. Downloaded but no quote (engaged, needs follow-up)
  4. Submitted a quote → lowest priority (complete)

### Task 6.2: Merge Two Pools

- [ ] Combine GC's Private Pool + BidBox Network Pool
- [ ] Filter by selected trades for the project
- [ ] De-duplicate by company name/license

### Task 6.3: Generate Excel (.xlsx) Output

- [ ] Use xlsx library (server-side or client-side)
- [ ] Group by trade
- [ ] Sort by engagement priority
- [ ] Columns: Name, Company, Phone, Email, Engagement Status

### Task 6.4: Add "Generate Call List (Excel)" Button

- [ ] Location: Project admin view (`/projects/[id]`)
- [ ] Download `.xlsx` file on click
- [ ] Show loading state during generation

---

**End of tasks.md**
