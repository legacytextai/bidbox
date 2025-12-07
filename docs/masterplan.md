## BidBox – Master Plan

---

### 🚀 30-Second Elevator Pitch

BidBox is the **GC Control Center** — a fast, no-fluff operating system for preconstruction.  
Create a project, upload plans, select required trades, share a public link, and generate call lists from two subcontractor pools — all designed for bid day urgency.  
No bloat. No sub logins. Just clarity, organization, and action.

---

### 🔧 Problem & Mission

**Problem:**    
Small GCs and public works estimators waste hours chasing subcontractor bids using Dropbox, email, and spreadsheets.    
Procore and BuildingConnected are overbuilt and overpriced. Subs ignore logins.  
The real pain is **lack of visibility**, **lack of organization**, and **lack of a unified place to manage trades, coverage, and compliance**.

**Mission:**    
Give GCs a fast, no-login tool that makes them more informed, organized, and effective on bid day — not by replacing phone calls, but by making them smarter.

---

### ⭐ GC Control Center Direction (NEW)

BidBox is evolving from a "simple bid room" into the **GC Control Center**:

**Guiding Principles:**
1. **Do not replace phone calls — empower them.** GCs close gaps by calling subs. BidBox surfaces insights that make calls more efficient.
2. **Subs must experience zero friction.** No logins. No portals. Just: Click link → View plans → Upload quote.
3. **Clarity beats features.** Immediate visibility into trades needed, sub coverage, engagement status, and gaps.
4. **Local specialization is the wedge.** California public works, license-type filtering, curated SoCal directories.

**Four Pillars:**
- **Trade Intelligence**: Select required trades, view coverage heatmap, know where risks are
- **Subcontractor Organization**: Two-pool architecture (Private + Network), map subs to trades
- **Engagement Visibility**: Track views, downloads, submissions, follow-up needs
- **Bid-Day Command Center**: Auto-generated call lists, coverage meters, compliance reminders

See `docs/gc-control-center-prd.md` for full strategic PRD.

---

### 🎯 Target Audience

- Small to mid-size general contractors    
- Public works estimators    
- Subs responding to GC bid rooms (no login, no accounts)

---

### 🧩 Core Features

**MVP Features (Current):**
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

**Control Center Features (New):**
- **Trade Selection**: Select required license types when creating projects (C-10 Electrical, C-20 HVAC, etc.)
- **Two-Pool Subcontractor Architecture**:
  - GC's Private Pool: Subs the GC has personally added
  - BidBox Network Pool: Curated, verified subcontractors
- **Call List Generator**: Excel export grouped by trade, sorted by engagement priority
- **Engagement Tracking**: Views, downloads, submissions per subcontractor
- **Coverage Intelligence**: Visual indicators showing which trades have coverage

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
- **Brand Color**: Vibrant blue (#1D4ED8) for all CTAs, buttons, links, and key accents  
- Sharp, high-contrast UI with white headers and blue accents  
- Public form shows countdown (black digits) + drag-and-drop upload + instant confirmation  
- Layout follows an 8pt grid with generous white space  
- Sidebar uses "BB" logo mark in blue — avoid duplicate "BidBox" text

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

**MVP (v0)** ✅ Complete  
- GC login + dashboard    
- Create project    
- Upload files    
- View public bid page    
- Accept uploads    
- View/manage bids  

**v1** 🔄 In Progress  
- Download all bids (ZIP/CSV)    
- Responsive mobile layout polish    
- PDF preview viewer    
- Countdown component  

**Phase 3.5: Trade Selection Layer** 📋 Planned  
- Create `project_trades` table
- Compile CSLB license type list
- Add trade multi-select to `/projects/new`
- Display selected trades on project admin page

**Phase 4: Subcontractor Directory** 📋 Planned  
- Create `subcontractors` table (BidBox Network Pool, starts empty)
- Create `gc_subcontractors` table (GC's Private Pool)
- Build directory management UI
- Map subs to project trades
- (Future) Seed BidBox Network with real data

**Phase 5: Engagement Tracking** 📋 Planned  
- Track plan views (enhance existing)
- Track file downloads
- Display engagement status per sub

**Phase 6: Call List Generator** 📋 Planned  
- Build ranking logic (Not opened → Viewed → Downloaded → Submitted)
- Merge two pools for project coverage
- Generate Excel (.xlsx) grouped by trade
- Add "Generate Call List (Excel)" button

**v2+ (future)**    
- Sub invite batching (email/SMS)    
- Bid status tracking    
- Bid analytics + coverage map    
- AI bid diff tools    
- Multi-user GC orgs
- Compliance tracking (COIs, license expirations)

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

---

### 💳 Pricing & Stripe Integration (Implemented 2025-11-30)

**Current Pricing Tiers:**
| Tier | Price | Bid Rooms | Status |
|------|-------|-----------|--------|
| Free | $0 | 3 projects | ✅ Active |
| Early Access Lifetime | $199 (one-time) | Unlimited | ✅ Active (Featured) |
| Tier 1 | $49/month | Unlimited | 🔮 Future (Commented out) |

**Implementation Status:**
- ✅ Stripe account & product setup (Price ID: `price_1SZFudHGNQLTHcjYQs0m5Jq6`)
- ✅ Database schema: `stripe_customer_id` in profiles, `subscriptions` table
- ✅ Edge functions: `create-checkout`, `stripe-webhook`
- ✅ Frontend: `useSubscription` hook, PricingMvp checkout, Settings display
- ✅ Free tier enforcement (3 project limit with upgrade prompt)
- ⚠️ PENDING: Register webhook endpoint in Stripe Dashboard

**Documentation:**
- `docs/stripe-tasks.md` - Detailed task breakdown with status
- `docs/stripe-steps.md` - Implementation guide

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
