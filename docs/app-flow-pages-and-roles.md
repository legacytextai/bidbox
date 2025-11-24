\# app-flow-pages-and-roles.md

\#\# 🧭 Overview

BidBox is a two-role system (GC and anonymous Subcontractor) with a minimal page flow optimized for speed, clarity, and trust. All flows revolve around core actions: create project, upload plans, share public link, receive quotes.

\---

\#\# 👤 User Roles

\#\#\# 1\. General Contractor (GC)  
\- Requires login (email/password)  
\- Can create and manage projects  
\- Can view bid submissions  
\- Has private access to GC dashboard and admin tools

\#\#\# 2\. Subcontractor (Sub)  
\- No login  
\- Accesses public \`/bid/\[token\]\` link  
\- Can view plans and submit bid  
\- Can optionally enter name, company, email

\---

\#\# 📄 Core Pages

\#\#\# 1\. \`/auth/\*\`  
\- Register / Login for GCs only  
\- Auth via Supabase email/password

\---

\#\#\# 2\. \`/projects\`  
\- GC home dashboard  
\- View all created projects in tile layout  
\- Each tile: project name, due date, status, submission count, copy link  
\- CTA: “+ New Project”

\---

\#\#\# 3\. \`/projects/new\`  
\- Form to create a project  
\- Fields: name, location, agency, bid date/time, instructions  
\- Upload multiple files (PDFs)  
\- On submit:  
  \- Save project to DB  
  \- Upload files to Supabase Storage  
  \- Generate public token and links  
  \- Redirect to \`/projects/\[id\]\`

\---

\#\#\# 4\. \`/projects/\[id\]\`  
\- GC admin view for individual project  
\- View/edit project metadata  
\- View/delete/add files  
\- See list of bids with timestamps and filenames  
\- “Download All” ZIP button  
\- Delete project option

\---

\#\#\# 5\. \`/bid/\[token\]\`  
\- Public page with no login  
\- Accessed by subs via shared link  
\- Shows:  
  \- Project info  
  \- File list  
  \- Red countdown timer  
  \- Submit Quote button  
\- Upload modal allows:  
  \- File upload  
  \- Optional fields: name, company, email, bid item  
  \- Confirmation on success

\---

\#\# 🔄 End-to-End Flows

\#\#\# GC Flow  
1\. Logs in    
2\. Goes to \`/projects\`    
3\. Clicks “New Project”    
4\. Completes form and uploads files    
5\. Gets public bid link    
6\. Shares it with subs    
7\. Receives bids in real-time    
8\. Manages project via \`/projects/\[id\]\`

\#\#\# Sub Flow  
1\. Receives link to \`/bid/\[token\]\`    
2\. Opens public bid room (no login)    
3\. Views plans and deadline    
4\. Clicks “Submit Your Quote”    
5\. Uploads file (with optional details)    
6\. Gets confirmation    
7\. Done

\---

\#\# 🔐 Access Rules

| Page               | GC | Sub | Auth Required |  
|--------------------|----|-----|----------------|  
| \`/projects\`        | ✅ | ❌  | Yes            |  
| \`/projects/new\`    | ✅ | ❌  | Yes            |  
| \`/projects/\[id\]\`   | ✅ | ❌  | Yes            |  
| \`/bid/\[token\]\`     | ❌ | ✅  | No             |

\---

\#\# 📱 Mobile Considerations

\- Public bid room is optimized for mobile subs  
\- File uploads and forms stack vertically on small screens  
\- Countdown timer and submit button are pinned near top

\---

\#\# 🔁 Future Role Expansion (v1+)

\- Subcontractor accounts \+ saved profile    
\- Invite-based access with analytics    
\- GC teams (multiple users per company)    
\- Admin dashboard with usage insights
