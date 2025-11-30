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

## Phase 2 — Backend KPI Functions (RPC)

### Task 2.1: Create get_total_gcs() Function
**Status:** [ ] Not Started  
**Returns:** INTEGER  
**SQL:**
```sql
CREATE OR REPLACE FUNCTION public.get_total_gcs()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  RETURN (SELECT COUNT(*)::INTEGER FROM public.profiles);
END;
$$;
```

---

### Task 2.2: Create get_active_gcs_30d() Function
**Status:** [ ] Not Started  
**Returns:** INTEGER  
**Description:** Count GCs who created a project OR received a bid in last 30 days  
**SQL:**
```sql
CREATE OR REPLACE FUNCTION public.get_active_gcs_30d()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  RETURN (
    SELECT COUNT(DISTINCT gc_id)::INTEGER
    FROM (
      -- GCs who created projects in last 30 days
      SELECT gc_id FROM public.projects
      WHERE created_at >= NOW() - INTERVAL '30 days'
      
      UNION
      
      -- GCs who received bids in last 30 days
      SELECT p.gc_id FROM public.projects p
      JOIN public.bids b ON b.project_id = p.id
      WHERE b.submitted_at >= NOW() - INTERVAL '30 days'
    ) AS active_gcs
  );
END;
$$;
```

---

### Task 2.3: Create get_total_projects() Function
**Status:** [ ] Not Started  
**Returns:** INTEGER  
**SQL:**
```sql
CREATE OR REPLACE FUNCTION public.get_total_projects()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  RETURN (SELECT COUNT(*)::INTEGER FROM public.projects);
END;
$$;
```

---

### Task 2.4: Create get_avg_projects_per_gc() Function
**Status:** [ ] Not Started  
**Returns:** NUMERIC(10,2)  
**SQL:**
```sql
CREATE OR REPLACE FUNCTION public.get_avg_projects_per_gc()
RETURNS NUMERIC(10,2)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_projects INTEGER;
  total_gcs INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  SELECT COUNT(*) INTO total_projects FROM public.projects;
  SELECT COUNT(*) INTO total_gcs FROM public.profiles;
  
  IF total_gcs = 0 THEN
    RETURN 0;
  END IF;
  
  RETURN ROUND(total_projects::NUMERIC / total_gcs, 2);
END;
$$;
```

---

### Task 2.5: Create get_total_bids() Function
**Status:** [ ] Not Started  
**Returns:** INTEGER  
**SQL:**
```sql
CREATE OR REPLACE FUNCTION public.get_total_bids()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  RETURN (SELECT COUNT(*)::INTEGER FROM public.bids);
END;
$$;
```

---

### Task 2.6: Create get_avg_bids_per_project() Function
**Status:** [ ] Not Started  
**Returns:** NUMERIC(10,2)  
**SQL:**
```sql
CREATE OR REPLACE FUNCTION public.get_avg_bids_per_project()
RETURNS NUMERIC(10,2)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_bids INTEGER;
  total_projects INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  SELECT COUNT(*) INTO total_bids FROM public.bids;
  SELECT COUNT(*) INTO total_projects FROM public.projects;
  
  IF total_projects = 0 THEN
    RETURN 0;
  END IF;
  
  RETURN ROUND(total_bids::NUMERIC / total_projects, 2);
END;
$$;
```

---

### Task 2.7: Create get_conversion_rate() Function
**Status:** [ ] Not Started  
**Returns:** NUMERIC(10,2) (percentage)  
**Description:** % of projects that received at least 1 bid  
**SQL:**
```sql
CREATE OR REPLACE FUNCTION public.get_conversion_rate()
RETURNS NUMERIC(10,2)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  projects_with_bids INTEGER;
  total_projects INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  SELECT COUNT(DISTINCT project_id) INTO projects_with_bids FROM public.bids;
  SELECT COUNT(*) INTO total_projects FROM public.projects;
  
  IF total_projects = 0 THEN
    RETURN 0;
  END IF;
  
  RETURN ROUND((projects_with_bids::NUMERIC / total_projects) * 100, 2);
END;
$$;
```

---

### Task 2.8: Create get_total_bid_room_views() Function
**Status:** [ ] Not Started  
**Returns:** INTEGER  
**Depends on:** Task 1.5  
**SQL:**
```sql
CREATE OR REPLACE FUNCTION public.get_total_bid_room_views()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  RETURN (SELECT COALESCE(SUM(view_count), 0)::INTEGER FROM public.projects);
END;
$$;
```

---

### Task 2.9: Create get_admin_kpi_summary() Function
**Status:** [ ] Not Started  
**Returns:** JSON  
**Description:** Combined function returning all KPIs in one call (efficiency)  
**SQL:**
```sql
CREATE OR REPLACE FUNCTION public.get_admin_kpi_summary()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  SELECT json_build_object(
    'total_gcs', (SELECT COUNT(*) FROM public.profiles),
    'active_gcs_30d', (
      SELECT COUNT(DISTINCT gc_id) FROM (
        SELECT gc_id FROM public.projects WHERE created_at >= NOW() - INTERVAL '30 days'
        UNION
        SELECT p.gc_id FROM public.projects p
        JOIN public.bids b ON b.project_id = p.id
        WHERE b.submitted_at >= NOW() - INTERVAL '30 days'
      ) AS active
    ),
    'total_projects', (SELECT COUNT(*) FROM public.projects),
    'avg_projects_per_gc', COALESCE(
      ROUND((SELECT COUNT(*)::NUMERIC FROM public.projects) / 
            NULLIF((SELECT COUNT(*) FROM public.profiles), 0), 2), 0
    ),
    'total_bids', (SELECT COUNT(*) FROM public.bids),
    'avg_bids_per_project', COALESCE(
      ROUND((SELECT COUNT(*)::NUMERIC FROM public.bids) / 
            NULLIF((SELECT COUNT(*) FROM public.projects), 0), 2), 0
    ),
    'conversion_rate', COALESCE(
      ROUND((SELECT COUNT(DISTINCT project_id)::NUMERIC FROM public.bids) / 
            NULLIF((SELECT COUNT(*) FROM public.projects), 0) * 100, 2), 0
    ),
    'total_views', (SELECT COALESCE(SUM(view_count), 0) FROM public.projects)
  ) INTO result;
  
  RETURN result;
END;
$$;
```

---

### Task 2.10: Create get_admin_gc_metrics() Function
**Status:** [ ] Not Started  
**Returns:** TABLE  
**Description:** Detailed GC metrics for the admin table view  
**SQL:**
```sql
CREATE OR REPLACE FUNCTION public.get_admin_gc_metrics()
RETURNS TABLE (
  id UUID,
  email TEXT,
  company_name TEXT,
  project_count BIGINT,
  bid_count BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    p.id,
    p.email,
    p.company_name,
    (SELECT COUNT(*) FROM public.projects pr WHERE pr.gc_id = p.id) AS project_count,
    (SELECT COUNT(*) FROM public.bids b 
     JOIN public.projects pr ON pr.id = b.project_id 
     WHERE pr.gc_id = p.id) AS bid_count,
    p.created_at
  FROM public.profiles p
  ORDER BY p.created_at DESC;
END;
$$;
```

---

## Phase 3 — Anonymous View Tracking

### Task 3.1: Create increment_view_count() RPC Function
**Status:** [ ] Not Started  
**Description:** Increment view count for a project (called from edge function)  
**SQL:**
```sql
CREATE OR REPLACE FUNCTION public.increment_view_count(p_project_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.projects
  SET view_count = view_count + 1
  WHERE id = p_project_id;
$$;
```

---

### Task 3.2: Update get-public-project Edge Function
**Status:** [ ] Not Started  
**File:** `supabase/functions/get-public-project/index.ts`  
**Changes:**
- After fetching project, call `increment_view_count(project.id)`
- Use service role client for the increment
- No PII collected

---

### Task 3.3: Verify No PII Collection
**Status:** [ ] Not Started  
**Checklist:**
- [ ] No IP addresses stored
- [ ] No user agents stored
- [ ] No cookies/session data stored
- [ ] Only atomic counter increment

---

## Phase 4 — Admin Dashboard UI

### Task 4.1: Add /admin/analytics Route
**Status:** [ ] Not Started  
**File:** `src/App.tsx`  
**Changes:**
```tsx
import AdminAnalytics from "./pages/AdminAnalytics";

// In Routes
<Route path="/admin/analytics" element={<AdminAnalytics />} />
```

---

### Task 4.2: Create AdminAnalytics.tsx Page
**Status:** [ ] Not Started  
**File:** `src/pages/AdminAnalytics.tsx`  
**Features:**
- Admin auth gate (redirect non-admins)
- KPIGrid component
- GCMetricsTable component
- Loading/error states

---

### Task 4.3: Create useAdminKPIs Hook
**Status:** [ ] Not Started  
**File:** `src/hooks/useAdminKPIs.tsx`  
**Features:**
- Fetch KPI summary via `get_admin_kpi_summary()` RPC
- Fetch GC metrics via `get_admin_gc_metrics()` RPC
- Admin check via `has_role()` RPC
- React Query for caching

---

### Task 4.4: Create KPICard Component
**Status:** [ ] Not Started  
**File:** `src/components/admin/KPICard.tsx`  
**Props:**
```tsx
interface KPICardProps {
  title: string;
  value: number | string;
  icon?: LucideIcon;
  format?: 'number' | 'percentage' | 'decimal';
}
```

---

### Task 4.5: Create KPIGrid Component
**Status:** [ ] Not Started  
**File:** `src/components/admin/KPIGrid.tsx`  
**Layout:** 4 columns × 2 rows (responsive: 2×4 on mobile)

---

### Task 4.6: Create GCMetricsTable Component
**Status:** [ ] Not Started  
**File:** `src/components/admin/GCMetricsTable.tsx`  
**Columns:**
- Email
- Company Name
- Projects
- Bids Received
- Joined Date

---

### Task 4.7: Add Loading/Error/Empty States
**Status:** [ ] Not Started  
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
