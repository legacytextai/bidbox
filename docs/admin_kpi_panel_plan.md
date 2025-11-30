# Admin KPI Analytics Panel — Plan

**BidBox Platform Analytics for Admins**  
Last Updated: 2025-11-30

---

## 1. Purpose & Goals

### Why Platform KPIs Matter Now
BidBox is in early growth stage with 3 GCs and 5 projects. Tracking platform-level metrics enables:

- **Growth Monitoring**: Track GC acquisition and retention trends
- **Engagement Validation**: Measure if bid rooms are actually being used
- **Product-Market Fit**: Identify power users vs. one-time users
- **Feature Prioritization**: Data-driven decisions on what to build next

### Success Metrics
| Goal | Target | Measurement |
|------|--------|-------------|
| GC Growth | +5 GCs/month | Total Registered GCs trend |
| Engagement | 60%+ projects receive bids | Conversion Rate KPI |
| Retention | 40%+ GCs active in 30d | Active GCs (30d) KPI |

---

## 2. KPI Specifications (8 Metrics)

| # | KPI Name | Description | Data Source | Calculation |
|---|----------|-------------|-------------|-------------|
| 1 | **Total Registered GCs** | All GC accounts on platform | `profiles` | `COUNT(*)` |
| 2 | **Active GCs (30d)** | GCs who created a project OR received a bid in last 30 days | `projects`, `bids` | Complex join with 30-day filter |
| 3 | **Total Projects Created** | All projects platform-wide | `projects` | `COUNT(*)` |
| 4 | **Projects per GC** | Average projects created per GC | `projects` | `COUNT(*) / COUNT(DISTINCT gc_id)` |
| 5 | **Total Bid Submissions** | All bids received across platform | `bids` | `COUNT(*)` |
| 6 | **Avg Bids per Project** | Average number of bids per project | `bids`, `projects` | `COUNT(bids) / COUNT(projects)` |
| 7 | **Conversion Rate** | % of projects that received at least 1 bid | `bids`, `projects` | `(Projects with ≥1 bid / Total projects) × 100` |
| 8 | **Bid Room Views** | Total anonymous page views of bid rooms | `projects.view_count` | `SUM(view_count)` |

### KPI Card Display Format
```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Total GCs      │  │  Active (30d)   │  │  Total Projects │  │  Projects/GC    │
│      3          │  │      2          │  │      5          │  │     1.67        │
└─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Total Bids     │  │  Avg Bids/Proj  │  │  Conversion %   │  │  Bid Room Views │
│      12         │  │     2.4         │  │     80%         │  │      156        │
└─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## 3. Data Architecture

### 3.1 Database Changes Required

#### A. Add View Count to Projects Table
```sql
ALTER TABLE public.projects 
ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
```

**Why:** Simple, atomic increment. No separate table needed for MVP.

#### B. Create Admin Role System (Security Best Practice)

**Step 1: Create Role Enum**
```sql
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
```

**Step 2: Create user_roles Table**
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

**Step 3: Create has_role() Security Definer Function**
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

**Step 4: RLS Policies for user_roles**
```sql
-- Only admins can view roles
CREATE POLICY "Admins can view all roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Service role can manage roles (for initial setup)
CREATE POLICY "Service role can manage roles"
ON public.user_roles FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
```

**Why user_roles table instead of is_admin flag on profiles:**
- ✅ Prevents privilege escalation attacks
- ✅ Supports multiple roles per user (future: moderator)
- ✅ Cleaner separation of concerns
- ✅ Industry best practice

### 3.2 Server-Side RPC Functions

All KPI functions will be `SECURITY DEFINER` with admin check:

```sql
-- Example pattern for all KPI functions
CREATE OR REPLACE FUNCTION public.get_total_gcs()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM public.profiles
  WHERE public.has_role(auth.uid(), 'admin')
$$;
```

**Functions to Create:**
1. `get_total_gcs()` → INTEGER
2. `get_active_gcs_30d()` → INTEGER
3. `get_total_projects()` → INTEGER
4. `get_avg_projects_per_gc()` → NUMERIC
5. `get_total_bids()` → INTEGER
6. `get_avg_bids_per_project()` → NUMERIC
7. `get_conversion_rate()` → NUMERIC
8. `get_total_bid_room_views()` → INTEGER
9. `get_admin_kpi_summary()` → JSON (combined)
10. `get_admin_gc_metrics()` → TABLE (for detailed view)

### 3.3 View Count Increment

**Option A (Recommended): Edge Function Update**
Update `get-public-project` edge function to increment view count:

```typescript
// In get-public-project/index.ts
// After fetching project, increment view_count
await supabaseAdmin
  .from('projects')
  .update({ view_count: project.view_count + 1 })
  .eq('id', project.id);
```

**Option B: Separate RPC Function**
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

## 4. Frontend Architecture

### 4.1 Route
```
/admin/analytics
```

### 4.2 Components Structure
```
src/
├── pages/
│   └── AdminAnalytics.tsx        # Main admin page
├── components/
│   └── admin/
│       ├── KPICard.tsx           # Individual KPI card
│       ├── KPIGrid.tsx           # 4x2 grid of KPI cards
│       └── GCMetricsTable.tsx    # Detailed GC table
├── hooks/
│   └── useAdminKPIs.tsx          # Data fetching hook
```

### 4.3 Admin Auth Gate
```typescript
// In AdminAnalytics.tsx
const { data: isAdmin, isLoading } = useQuery({
  queryKey: ['admin-check'],
  queryFn: async () => {
    const { data } = await supabase.rpc('has_role', { 
      _user_id: user.id, 
      _role: 'admin' 
    });
    return data;
  }
});

if (!isAdmin) {
  return <Navigate to="/projects" />;
}
```

### 4.4 UI/UX Design
- **Style**: Clean, minimal, matches BidBox aesthetic
- **Colors**: Use design system tokens (--primary, --muted, etc.)
- **Layout**: 
  - Header: "Platform Analytics" title
  - KPI Grid: 4 columns × 2 rows
  - GC Table: Below KPIs, sortable columns
- **Responsive**: Stack KPIs 2×4 on mobile

---

## 5. Security Considerations

### 5.1 Admin Access Control
- ❌ **NEVER** check admin status via localStorage/sessionStorage
- ❌ **NEVER** use hardcoded email checks on frontend
- ✅ **ALWAYS** use `has_role()` function with server-side validation
- ✅ **ALWAYS** use SECURITY DEFINER functions for KPI queries

### 5.2 Data Protection
- RPC functions return NULL/empty if user is not admin
- No client-side admin detection (prevents privilege escalation)
- View count increment is anonymous (no PII collected)

### 5.3 Initial Admin Setup
```sql
-- Run once to set initial admin (constructionaisolutions.co@gmail.com)
INSERT INTO public.user_roles (user_id, role)
VALUES ('324e7848-6c4d-4fe5-a826-91427265a76e', 'admin');
```

---

## 6. Future Enhancements

### Phase 2 (Post-MVP)
- [ ] Time-series charts (GC growth over time)
- [ ] Bid submission trends graph
- [ ] Export KPIs to CSV
- [ ] Date range filtering

### Phase 3 (Advanced)
- [ ] Real-time dashboard updates
- [ ] Email alerts for milestones (e.g., 100th GC)
- [ ] Cohort analysis (retention by signup month)
- [ ] Revenue tracking integration

---

## 7. Documentation References

- `docs/admin_kpi_tasks.md` — Detailed implementation tasks
- `docs/tasks.md` — Main project task tracker
- `docs/masterplan.md` — Overall project vision
