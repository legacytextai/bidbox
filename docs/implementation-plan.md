\#\# BidBox – Implementation Plan

\---

\#\#\# 🧱 Step-by-Step Build Sequence

\*\*Phase 1 – Foundations: Data Model \+ Storage\*\*

\- \[ \] Set up Supabase project with Postgres \+ Storage  
\- \[ \] Create tables: \`users\`, \`projects\`, \`project\_files\`, \`bids\`  
\- \[ \] Enable Supabase Auth (email/password for GCs only)  
\- \[ \] Create Supabase Storage bucket: \`project-files\`  
\- \[ \] Write helper: generate secure \`public\_token\` for each project

\---

\*\*Phase 2 – GC Internal Pages (Private)\*\*

\- \[ \] \`/auth/register\` & \`/auth/login\`  
  \- GC signup/login form  
  \- Save \`company\_name\`, email, password

\- \[ \] \`/projects\` (GC dashboard)  
  \- Show tile layout of all GC’s projects  
  \- Each tile: name, bid due, status, submission count, copy public link  
  \- “+ New Project” tile → \`/projects/new\`

\- \[ \] \`/projects/new\`  
  \- Form: project name, location, agency, due date, instructions  
  \- File upload component (multiple PDF uploads)  
  \- On submit:  
    \- Save project \+ metadata  
    \- Store files in Supabase  
    \- Generate \`public\_token\`  
    \- Redirect to \`/projects/\[id\]\`

\- \[ \] \`/projects/\[id\]\`  
  \- Show/edit project metadata (bid due, status)  
  \- Display uploaded files (view/delete/add)  
  \- Show all bids submitted (name, timestamp, file links)  
  \- Button: “Download All Bids” (ZIP — stretch goal)

\---

\*\*Phase 3 – Public Bid Page (No Login)\*\*

\- \[ \] \`/bid/\[token\]\` public route  
  \- Load project via \`public\_token\`  
  \- Show: name, agency, due date, instructions  
  \- “Download Project Files” list  
  \- Countdown timer (stretch goal)  
  \- “Submit Your Quote” button (opens modal)

\- \[ \] Submit Quote Modal  
  \- Fields: name, company, email, bid item (optional), file upload  
  \- Validate file type (.pdf, .xls, .docx)  
  \- On submit:  
    \- Save \`bid\` row in DB  
    \- Store file in Supabase  
    \- Show confirmation message

\---

\*\*Phase 4 – Polish \+ Export\*\*

\- \[ \] Add “Download All Submissions” as ZIP (GC side)  
\- \[ \] Format export CSV (name, company, email, file link, timestamp)  
\- \[ \] Make \`/bid/\[token\]\` responsive (mobile-first)  
\- \[ \] Optional: PDF previewer  
\- \[ \] Add 200–300ms fade-in success message for subs

\---

\#\#\# ⏱️ Timeline with Checkpoints

| Day(s) | Tasks |  
|--------|-------|  
| 1–2 | Set up Supabase project, tables, auth |  
| 3–4 | Build GC auth flow \+ dashboard (\`/projects\`) |  
| 5–6 | Implement project creation form \+ file upload |  
| 7–8 | Build GC project admin view (\`/projects/\[id\]\`) |  
| 9–10 | Build public \`/bid/\[token\]\` page \+ form |  
| 11 | Bid submission \+ confirmation handling |  
| 12 | Polish dashboard layout, exports |  
| 13 | Mobile \+ UX polish |  
| 14 | Internal test & deployment (Lovable deploy)

\---

\#\#\# 👥 Team Roles & Rituals

\*\*You (Solo Builder / Dev-CTO)\*\*

\- Drive build forward  
\- Make clear scope trade-offs  
\- Use Lovable for scaffolding, then refine by hand

\*\*Optional Usability Helpers\*\*

\- Ask 1 estimator friend to try \`/projects/new\` form  
\- Ask 1 sub to upload a test bid from \`/bid/\[token\]\`

\*\*Rituals\*\*

\- ✅ Test each screen solo with fake data before launch  
\- 🧪 Run a 3-user test on public \`/bid/\[token\]\` before sharing  
\- 🧹 Set a 30-minute design debt cleanup after build

\---

\#\#\# 🚀 Optional Integrations & Stretch Goals

\- \[ \] Countdown timer (public page)  
\- \[ \] PDF embed viewer  
\- \[ \] “Download all bids” ZIP  
\- \[ \] Basic spam protection (rate limit uploads)  
\- \[ \] Light usage analytics per GC  
\- \[ \] Add password reset (Supabase auth helper)

\---
