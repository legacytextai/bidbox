## BidBox – Master Plan

---

### 🚀 30-Second Elevator Pitch

BidBox is a lean, login-free bid room for general contractors.    
Create a project, upload plans, share a public link, and start receiving subcontractor quotes — all in under 5 minutes.    
No bloat. No portals. Just fast, frictionless bidding.

---

### 🔧 Problem & Mission

**Problem:**    
Small GCs and public works estimators waste hours chasing subcontractor bids using Dropbox, email, and spreadsheets.    
Procore and BuildingConnected are overbuilt and overpriced. Subs ignore logins.

**Mission:**    
Eliminate bidding friction by giving GCs a fast, no-login tool to share plans and collect bids — designed for bid day urgency.

---

### 🎯 Target Audience

- Small to mid-size general contractors    
- Public works estimators    
- Subs responding to GC bid rooms (no login, no accounts)

---

### 🧩 Core Features

- GC login + dashboard  
- Create new bid project  
- Upload plans/specs (PDFs)  
- Auto-generate public bid link (`/bid/[token]`)  
- Public bid page with project info + countdown + upload form  
- GC project admin panel with:  
  - Edit metadata  
  - Upload/delete documents  
  - View/download bids  
- All file storage via Supabase (not Lovable file system)

---

### 🛠️ High-Level Tech Stack

- **Frontend:** React + TypeScript + shadcn/ui + Tailwind CSS    
- **Backend:** Supabase (Postgres + Storage + Auth)    
- **Auth:** Email/password for GCs only    
- **File Storage:** Supabase Storage    
- **Public Links:** Secure `/bid/[token]` pages for subs    
- **Export:** Download all bids (ZIP or CSV)    
- **No sub accounts, no email/SMS invites in v0**

Why this stack?    
Fast to scaffold, secure by default, and matches Lovable's strengths.

---

### 📊 Conceptual Data Model (ERD in words)

**users**    
- id    
- email    
- password_hash    
- company_name  

**projects**    
- id    
- gc_id (FK → users)    
- name    
- location    
- agency    
- bid_due_at    
- instructions    
- public_token    
- status ("live" or "dead")  

**project_files**    
- id    
- project_id    
- file_name    
- file_url  

**bids**    
- id    
- project_id    
- submitted_at    
- file_url    
- bidder_name    
- company_name    
- email    
- division (optional)

---

### 🎨 UI Design Principles

- Clarity first, then speed  
- Public bid page: **minimal, deadline-driven, excruciatingly clear**  
- GC dashboard: clean tile layout, clear status indicators  
- No pastel colors — sharp, high-contrast UI  
- Public form shows countdown + drag-and-drop upload + instant confirmation  
- Layout follows an 8pt grid with generous white space

(Krug's law: "Don't make me think.")

---

### 🔐 Security & Compliance Notes

- All uploaded files stored in Supabase Storage (never on Lovable servers)    
- Public pages scoped via secure random `token`    
- Row-level security ensures users only access their own projects/bids    
- Public upload form: rate-limited to prevent spam    
- File size limit: 25MB (configurable)  

---

### 🗺️ Phased Roadmap

**MVP (v0)**    
- GC login + dashboard    
- Create project    
- Upload files    
- View public bid page    
- Accept uploads    
- View/manage bids  

**v1**    
- Download all bids (ZIP/CSV)    
- Responsive mobile layout polish    
- PDF preview viewer    
- Countdown component  

**v2+ (future)**    
- Sub invite batching (email/SMS)    
- Bid status tracking    
- Bid analytics + coverage map    
- AI bid diff tools    
- Multi-user GC orgs

---

### ⚠️ Risks & Mitigations

| Risk | Mitigation |  
|------|------------|  
| Subs upload junk files or spam | Add file type validation + upload rate limits |  
| GCs forget their links | Add copyable links in dashboard; regenerate token option |  
| File size too big | Enforce Supabase upload limits (25MB) |  
| Confusion between GC/public views | Use visual headers + URL structure (`/projects/[id]` vs `/bid/[token]`) |

---

### 🌱 Future Expansion Ideas

- Invite-only bid rooms with tracking    
- Bidder analytics (viewed/not viewed)    
- "Bid received" email to GC    
- Integrate bid forms by division    
- Optional contractor registry    
- Public works bid log export format    
- Stripe-based pricing plans ($49 / $99)

---

### 🤖 Future AI Roadmap

These features represent high-leverage, high-value AI capabilities that will differentiate BidBox after the MVP and v1 are stable. AI is not required for initial launch but is intended to be a major competitive advantage as the platform grows.

Here are three extremely high-value, actually valuable AI features that subcontractors AND GCs would truly appreciate — not gimmicks.
These would differentiate you from Procore and BuildingConnected.

**🔥 AI Feature #1 — Bid Scope Comparison (Leveling Assistant)**

The killer feature.
GCs HATE manually comparing bids.
- Subs exclude random items.
- People miss huge scope gaps.
- Bid day becomes chaos.

AI would:
- Read all uploaded bid PDFs
- Extract line items, scope notes, exclusions, inclusions, unit costs
- Normalize the text (every sub uses different format)
- Highlight:
  - Missing scope
  - Suspicious exclusions
  - Outlier prices
  - Major differences between subs

GC gets a clean output like:

```
Division 16 — Electrical
- Sub A missing conduit demo
- Sub B excludes temp power
- Sub C 22% lower on fixtures but higher on panels
- All subs lack trenching; flag for addendum request
```

This feature ALONE is a $199/mo product.

**🔥 AI Feature #2 — Auto-Build CSI Trade Breakdown from Plans**

GC uploads plans/specs → AI automatically generates:
- CSI trade list
- Suggested subcategories
- Quantities or takeoff notes
- Risks and high-cost areas
- List of subcontractors needed

Example:
Upload plans → AI outputs:
```
- Earthwork — 3,500 CY import/export
- Paving — 12,000 SF
- Striping — 200 LF
- Concrete sidewalks — 3,200 SF
- Electrical — 12 pull boxes, panel upgrades
- Landscaping — 45 trees, irrigation redesign
```

This saves estimators HOURS.

**🔥 AI Feature #3 — Subcontractor Quote Risk Scoring**

AI evaluates each sub's proposal for:
- Ambiguity in scope
- Missing required items
- High-risk exclusions
- Possible underbidding
- Past bid patterns (local DB)
- Language indicating change order risk

Example:
```
Risk Score: 27/100 (Low)
✓ Clear scope
✓ No major exclusions
✓ Includes materials and labor
✓ Matches project plans

Risk Score: 81/100 (High)
⚠ Multiple vague exclusions
⚠ Missing required addendum references
⚠ "Alternate" wording in price
⚠ Under industry benchmark by 33%
```

GCs would LOVE THIS.

---

**Note:** AI features are not part of MVP or v1. These capabilities will be developed only after core workflows are stable and validated with early GCs and subcontractors.

---
