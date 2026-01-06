# app-flow-pages-and-roles.md

## 🧭 Overview

BidBox is a two-role system (GC and anonymous Subcontractor) with a minimal page flow optimized for speed, clarity, and trust. All flows revolve around core actions: create project, upload plans, share public link, receive quotes.

---

## 👤 User Roles

### 1. General Contractor (GC)  
- Requires login (email/password)  
- Can create and manage projects  
- Can view bid submissions  
- Has private access to GC dashboard and admin tools

### 2. Subcontractor (Sub)  
- No login  
- Accesses public `/bid/[token]` link  
- Can view plans and submit bid  
- Can optionally enter name, company, email

---

## 📄 Core Pages

### 1. `/auth/*`  
- Register / Login for GCs only  
- Auth via Supabase email/password

---

### 2. `/projects`  
- GC home dashboard  
- View all created projects in tile layout  
- Each tile: project name, due date, status, submission count, copy link  
- CTA: "+ New Project"

---

### 3. `/projects/new`  
- Form to create a project  
- Fields: name, location, agency, bid date/time, **job walk date/time (optional)**, instructions  
- Upload multiple files (PDFs)  
- Select required trades from trade types
- On submit:  
  - Save project to DB  
  - Upload files to Supabase Storage  
  - Generate public token and links  
  - Redirect to `/projects/[id]`

---

### 4. `/projects/[id]`  
- GC admin view for individual project  
- View/edit project metadata (including job walk date)
- View/delete/add files  
- See list of bids with timestamps and filenames  
- "Download All" ZIP button  
- Delete project option

---

### 5. `/bid/[token]`  
- Public page with no login  
- Accessed by subs via shared link  
- Shows:  
  - Project info (name, GC company, location, agency)
  - **Estimating Contact** (from GC profile or fallback to GC email)
  - **Required Trades** (if selected, shown as colored badges by category)
  - File list (downloadable)
  - Red countdown timer  
  - Submit Quote button  
- Upload modal allows:  
  - File upload  
  - Optional fields: name, company, email, bid item  
  - Confirmation on success

---

### 6. `/settings`
- GC profile and subscription settings
- View/edit Company Name
- View/edit **Estimating Email** (optional, displayed on public bid room as contact)
- View subscription status
- Upgrade to paid plan

---

### 7. `/calendar`
- GC calendar dashboard (primary landing page after login)
- Monthly view (Mon-Fri only)
- Event types:
  - **Bid Due** (red badge) - Clickable, routes to project
  - **Job Walk** (gray badge) - Clickable, routes to project
- **Print Calendar** button: Single-page landscape PDF
- Metrics cards: Projects Scheduled, Bids Submitted (placeholder), Top 3 (placeholder)

---

## 🔄 End-to-End Flows

### GC Flow  
1. Logs in    
2. Goes to `/calendar` (primary landing)
3. Clicks "New Project" or navigates to `/projects`
4. Completes form and uploads files    
5. Gets public bid link    
6. Shares it with subs    
7. Receives bids in real-time    
8. Manages project via `/projects/[id]`

### Sub Flow  
1. Receives link to `/bid/[token]`    
2. Opens public bid room (no login)    
3. Views plans, deadline, and required trades
4. Clicks "Submit Your Quote"    
5. Uploads file (with optional details)    
6. Gets confirmation    
7. Done

---

## 🔐 Access Rules

| Page               | GC | Sub | Auth Required |  
|--------------------|----|-----|----------------|  
| `/projects`        | ✅ | ❌  | Yes            |  
| `/projects/new`    | ✅ | ❌  | Yes            |  
| `/projects/[id]`   | ✅ | ❌  | Yes            |  
| `/calendar`        | ✅ | ❌  | Yes            |  
| `/settings`        | ✅ | ❌  | Yes            |  
| `/bid/[token]`     | ❌ | ✅  | No             |

---

## 🔄 Landing Page Auto-Redirect

**Behavior (Added 2026-01-06)**: Authenticated users who navigate to the root URL (`/`) are automatically redirected to `/calendar`.

**Implementation**:
- `LandingMvp.tsx` checks auth state on mount
- Uses `useAuth()` hook for `user` and `authReady` state
- Redirects via `navigate("/calendar", { replace: true })`
- Renders nothing until auth state is confirmed (prevents flash)

**Rationale**:
- Prevents signed-in users from getting stuck on marketing page
- Matches standard SaaS behavior (app URL = app for logged-in users)
- Uses `replace: true` to keep browser history clean

---

## 📱 Mobile Considerations

- Public bid room is optimized for mobile subs  
- File uploads and forms stack vertically on small screens  
- Countdown timer and submit button are pinned near top

---

## 🔁 Future Role Expansion (v1+)

- Subcontractor accounts + saved profile    
- Invite-based access with analytics    
- GC teams (multiple users per company)    
- Admin dashboard with usage insights
