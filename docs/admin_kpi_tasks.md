# Admin KPI Analytics Panel — Implementation Tasks

**Task Breakdown for Admin Dashboard**  
Last Updated: 2025-11-30

---

## Legend
- [ ] Not Started
- [~] In Progress  
- [x] Completed
- [!] Blocked

---

## Phase 1 — Data Model Adjustments ✅ COMPLETED

### Task 1.1: Create app_role Enum Type
**Status:** [x] Completed  
**Priority:** Critical  
**SQL:**
```sql
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
```

---

### Task 1.2: Create user_roles Table with RLS
**Status:** [x] Completed  
**Priority:** Critical  
**Depends on:** Task 1.1  
**SQL:**
```sql
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
```

---

### Task 1.3: Create has_role() Security Definer Function
**Status:** [x] Completed  
**Priority:** Critical  
**Depends on:** Task 1.2  
**SQL:**
```sql
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;
```

---

### Task 1.4: Create RLS Policies for user_roles Table
**Status:** [x] Completed  
**Priority:** Critical  
**Depends on:** Task 1.3  
**SQL:**
```sql
-- Admins can view all roles
CREATE POLICY "Admins can view all roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Users can check their own roles
CREATE POLICY "Users can view own roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
```

---

### Task 1.5: Add view_count Column to projects Table
**Status:** [x] Completed  
**Priority:** High  
**SQL:**
```sql
ALTER TABLE public.projects 
ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
```

---

### Task 1.6: Insert Admin Role for Existing User
**Status:** [x] Completed  
**Priority:** Critical  
**Depends on:** Tasks 1.1-1.4  
**User:** constructionaisolutions.co@gmail.com  
**User ID:** 324e7848-6c4d-4fe5-a826-91427265a76e  
**SQL:**
```sql
INSERT INTO public.user_roles (user_id, role)
VALUES ('324e7848-6c4d-4fe5-a826-91427265a76e', 'admin');
```

---

## Phase 2 — Backend KPI Functions (RPC) ✅ COMPLETED

### Task 2.1: Create get_total_gcs() Function
**Status:** [x] Completed  
**Returns:** INTEGER  
**SQL:** Implemented in migration

---

### Task 2.2: Create get_active_gcs_30d() Function
**Status:** [x] Completed  
**Returns:** INTEGER  
**Description:** Count GCs who created a project OR received a bid in last 30 days  
**SQL:** Implemented in migration

---

### Task 2.3: Create get_total_projects() Function
**Status:** [x] Completed  
**Returns:** INTEGER  
**SQL:** Implemented in migration

---

### Task 2.4: Create get_avg_projects_per_gc() Function
**Status:** [x] Completed  
**Returns:** NUMERIC(10,2)  
**SQL:** Implemented in migration

---

### Task 2.5: Create get_total_bids() Function
**Status:** [x] Completed  
**Returns:** INTEGER  
**SQL:** Implemented in migration

---

### Task 2.6: Create get_avg_bids_per_project() Function
**Status:** [x] Completed  
**Returns:** NUMERIC(10,2)  
**SQL:** Implemented in migration

---

### Task 2.7: Create get_conversion_rate() Function
**Status:** [x] Completed  
**Returns:** NUMERIC(10,2) (percentage)  
**Description:** % of projects that received at least 1 bid  
**SQL:** Implemented in migration

---

### Task 2.8: Create get_total_bid_room_views() Function
**Status:** [x] Completed  
**Returns:** INTEGER  
**Depends on:** Task 1.5  
**SQL:** Implemented in migration

---

### Task 2.9: Create get_admin_kpi_summary() Function
**Status:** [x] Completed  
**Returns:** JSON  
**Description:** Combined function returning all KPIs in one call (efficiency)  
**SQL:** Implemented in migration

---

### Task 2.10: Create get_admin_gc_metrics() Function
**Status:** [x] Completed  
**Returns:** TABLE  
**Description:** Detailed GC metrics for the admin table view  
**SQL:** Implemented in migration

---

## Phase 3 — Anonymous View Tracking ✅ COMPLETED

### Task 3.1: Create increment_view_count() RPC Function
**Status:** [x] Completed  
**Description:** Increment view count for a project (called from edge function)  
**SQL:** Implemented in migration

---

### Task 3.2: Update get-public-project Edge Function
**Status:** [x] Completed  
**File:** `supabase/functions/get-public-project/index.ts`  
**Changes:**
- After fetching project, calls `increment_view_count(project.id)` via RPC
- Uses service role client for the increment
- No PII collected

---

### Task 3.3: Verify No PII Collection
**Status:** [x] Completed  
**Checklist:**
- [x] No IP addresses stored
- [x] No user agents stored
- [x] No cookies/session data stored
- [x] Only atomic counter increment

---

## Phase 4 — Admin Dashboard UI ✅ COMPLETED

### Task 4.1: Add /admin/analytics Route
**Status:** [x] Completed  
**File:** `src/App.tsx`  

---

### Task 4.2: Create AdminAnalytics.tsx Page
**Status:** [x] Completed  
**File:** `src/pages/AdminAnalytics.tsx`  
**Features:**
- Admin auth gate (redirect non-admins)
- KPIGrid component
- GCMetricsTable component
- Loading/error states

---

### Task 4.3: Create useAdminKPIs Hook
**Status:** [x] Completed  
**File:** `src/hooks/useAdminKPIs.tsx`  
**Features:**
- Fetch KPI summary via `get_admin_kpi_summary()` RPC
- Fetch GC metrics via `get_admin_gc_metrics()` RPC
- Admin check via `has_role()` RPC
- React Query for caching

---

### Task 4.4: Create KPICard Component
**Status:** [x] Completed  
**File:** `src/components/admin/KPICard.tsx`  

---

### Task 4.5: Create KPIGrid Component
**Status:** [x] Completed  
**File:** `src/components/admin/KPIGrid.tsx`  
**Layout:** 4 columns × 2 rows (responsive: 2×4 on mobile)

---

### Task 4.6: Create GCMetricsTable Component
**Status:** [x] Completed  
**File:** `src/components/admin/GCMetricsTable.tsx`  
**Columns:**
- Email
- Company Name
- Projects
- Bids Received
- Joined Date

---

### Task 4.7: Add Loading/Error/Empty States
**Status:** [x] Completed  
**States:**
- Loading: Skeleton cards
- Error: Error message with retry button
- Empty: "No data yet" message

---

## Phase 5 — QA & Validation

### Task 5.1: Verify KPI Calculations
**Status:** [ ] Not Started  
**Tests:**
- [ ] Total GCs matches profiles count
- [ ] Active GCs logic is correct
- [ ] Conversion rate math is accurate
- [ ] View count increments properly

---

### Task 5.2: Test Admin Gating
**Status:** [ ] Not Started  
**Tests:**
- [ ] Non-admin user redirected to /projects
- [ ] Admin user can access /admin/analytics
- [ ] RPC functions return NULL for non-admins

---

### Task 5.3: Test View Count Increment
**Status:** [ ] Not Started  
**Tests:**
- [ ] Visit bid room → view_count increases by 1
- [ ] Multiple visits → count increases each time
- [ ] No PII stored

---

### Task 5.4: Performance Testing
**Status:** [ ] Not Started  
**Tests:**
- [ ] KPI summary query < 500ms
- [ ] GC metrics table query < 1s
- [ ] No N+1 query issues

---

### Task 5.5: Update docs/tasks.md
**Status:** [ ] Not Started  
**Changes:**
- Add "Phase 5: Admin Analytics" section
- Reference admin_kpi_tasks.md
- Mark as new feature area

---

## Summary

| Phase | Tasks | Priority |
|-------|-------|----------|
| Phase 1 | 6 tasks | Critical |
| Phase 2 | 10 tasks | High |
| Phase 3 | 3 tasks | Medium |
| Phase 4 | 7 tasks | High |
| Phase 5 | 5 tasks | Medium |
| **Total** | **31 tasks** | — |

---

## Next Steps

1. **Run Phase 1 migration** (Tasks 1.1-1.6) — Database setup
2. **Run Phase 2 migration** (Tasks 2.1-2.10) — RPC functions
3. **Implement Phase 3** — View tracking
4. **Build Phase 4** — Frontend UI
5. **Complete Phase 5** — QA and docs
