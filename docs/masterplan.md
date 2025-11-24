\#\# BidBox – Master Plan

\---

\#\#\# 🚀 30-Second Elevator Pitch

BidBox is a lean, login-free bid room for general contractors.    
Create a project, upload plans, share a public link, and start receiving subcontractor quotes — all in under 5 minutes.    
No bloat. No portals. Just fast, frictionless bidding.

\---

\#\#\# 🔧 Problem & Mission

\*\*Problem:\*\*    
Small GCs and public works estimators waste hours chasing subcontractor bids using Dropbox, email, and spreadsheets.    
Procore and BuildingConnected are overbuilt and overpriced. Subs ignore logins.

\*\*Mission:\*\*    
Eliminate bidding friction by giving GCs a fast, no-login tool to share plans and collect bids — designed for bid day urgency.

\---

\#\#\# 🎯 Target Audience

\- Small to mid-size general contractors    
\- Public works estimators    
\- Subs responding to GC bid rooms (no login, no accounts)

\---

\#\#\# 🧩 Core Features

\- GC login \+ dashboard  
\- Create new bid project  
\- Upload plans/specs (PDFs)  
\- Auto-generate public bid link (\`/bid/\[token\]\`)  
\- Public bid page with project info \+ countdown \+ upload form  
\- GC project admin panel with:  
  \- Edit metadata  
  \- Upload/delete documents  
  \- View/download bids  
\- All file storage via Supabase (not Lovable file system)

\---

\#\#\# 🛠️ High-Level Tech Stack

\- \*\*Frontend:\*\* React \+ TypeScript \+ shadcn/ui \+ Tailwind CSS    
\- \*\*Backend:\*\* Supabase (Postgres \+ Storage \+ Auth)    
\- \*\*Auth:\*\* Email/password for GCs only    
\- \*\*File Storage:\*\* Supabase Storage    
\- \*\*Public Links:\*\* Secure \`/bid/\[token\]\` pages for subs    
\- \*\*Export:\*\* Download all bids (ZIP or CSV)    
\- \*\*No sub accounts, no email/SMS invites in v0\*\*

Why this stack?    
Fast to scaffold, secure by default, and matches Lovable’s strengths.

\---

\#\#\# 📊 Conceptual Data Model (ERD in words)

\*\*users\*\*    
\- id    
\- email    
\- password\_hash    
\- company\_name  

\*\*projects\*\*    
\- id    
\- gc\_id (FK → users)    
\- name    
\- location    
\- agency    
\- bid\_due\_at    
\- instructions    
\- public\_token    
\- status ("live" or "dead")  

\*\*project\_files\*\*    
\- id    
\- project\_id    
\- file\_name    
\- file\_url  

\*\*bids\*\*    
\- id    
\- project\_id    
\- submitted\_at    
\- file\_url    
\- bidder\_name    
\- company\_name    
\- email    
\- division (optional)

\---

\#\#\# 🎨 UI Design Principles

\- Clarity first, then speed  
\- Public bid page: \*\*minimal, deadline-driven, excruciatingly clear\*\*  
\- GC dashboard: clean tile layout, clear status indicators  
\- No pastel colors — sharp, high-contrast UI  
\- Public form shows countdown \+ drag-and-drop upload \+ instant confirmation  
\- Layout follows an 8pt grid with generous white space

(Krug’s law: “Don’t make me think.”)

\---

\#\#\# 🔐 Security & Compliance Notes

\- All uploaded files stored in Supabase Storage (never on Lovable servers)    
\- Public pages scoped via secure random \`token\`    
\- Row-level security ensures users only access their own projects/bids    
\- Public upload form: rate-limited to prevent spam    
\- File size limit: 25MB (configurable)  

\---

\#\#\# 🗺️ Phased Roadmap

\*\*MVP (v0)\*\*    
\- GC login \+ dashboard    
\- Create project    
\- Upload files    
\- View public bid page    
\- Accept uploads    
\- View/manage bids  

\*\*v1\*\*    
\- Download all bids (ZIP/CSV)    
\- Responsive mobile layout polish    
\- PDF preview viewer    
\- Countdown component  

\*\*v2+ (future)\*\*    
\- Sub invite batching (email/SMS)    
\- Bid status tracking    
\- Bid analytics \+ coverage map    
\- AI bid diff tools    
\- Multi-user GC orgs

\---

\#\#\# ⚠️ Risks & Mitigations

| Risk | Mitigation |  
|------|------------|  
| Subs upload junk files or spam | Add file type validation \+ upload rate limits |  
| GCs forget their links | Add copyable links in dashboard; regenerate token option |  
| File size too big | Enforce Supabase upload limits (25MB) |  
| Confusion between GC/public views | Use visual headers \+ URL structure (\`/projects/\[id\]\` vs \`/bid/\[token\]\`) |

\---

\#\#\# 🌱 Future Expansion Ideas

\- Invite-only bid rooms with tracking    
\- Bidder analytics (viewed/not viewed)    
\- “Bid received” email to GC    
\- Integrate bid forms by division    
\- Optional contractor registry    
\- Public works bid log export format    
\- Stripe-based pricing plans ($49 / $99)

\---
