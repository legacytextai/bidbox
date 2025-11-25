# BidBox Implementation Tasks

**Source of Truth for Feature Implementation**  
Last Updated: 2024-11-24

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
  - Location: `src/lib/fileValidation.ts`
  - Code:
  ```typescript
  export const PROJECT_FILE_TYPES = [
    'application/pdf',
    'image/vnd.dwg', // DWG
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];

  export const BID_FILE_TYPES = [
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/x-zip-compressed'
  ];

  export const MAX_FILE_SIZE_MB = 200;
  export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

  export function validateProjectFile(file: File): { valid: boolean; error?: string } {
    if (!PROJECT_FILE_TYPES.includes(file.type)) {
      return { valid: false, error: 'Only PDF, DWG, and Excel files allowed' };
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return { valid: false, error: `File must be under ${MAX_FILE_SIZE_MB}MB` };
    }
    return { valid: true };
  }

  export function validateBidFile(file: File): { valid: boolean; error?: string } {
    if (!BID_FILE_TYPES.includes(file.type)) {
      return { valid: false, error: 'Only PDF, Excel, and ZIP files allowed' };
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return { valid: false, error: `File must be under ${MAX_FILE_SIZE_MB}MB` };
    }
    return { valid: true };
  }
  ```

- [x] 0.4.2 Apply validation in NewProject.tsx
  - Before line 142 (file upload), call `validateProjectFile()`
  - Show toast error if invalid

- [x] 0.4.3 Apply validation in BidRoom.tsx
  - Before line 154 (bid upload), call `validateBidFile()`
  - Show toast error if invalid

- [x] 0.4.4 Apply validation in ProjectDetail.tsx
  - Before line 142 (add files), call `validateProjectFile()`
  - Show toast error if invalid

**References**: design-guidelines.md (Error Handling), input-validation-security docs

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
- `implementation-plan.md` - Original 4-phase build sequence
- `design-guidelines.md` - Brand voice, colors, layout rules, motion
- `app-flow-pages-and-roles.md` - Page structure, user journeys, permissions
- `tasks.md` (this doc) - Implementation source of truth

---

**End of tasks.md**
