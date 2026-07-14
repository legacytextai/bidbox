import { useEffect, useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/bidbox-logo.png";
import "./landing.css";

const SUCCESS = "Got it. Check your inbox soon.";
const emailSchema = z.string().trim().email().max(255);

type FormType = "guide" | "trial_request" | "newsletter";

function useLeadForm(formType: FormType) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setStatus("error");
      setError("Please enter a valid email.");
      return;
    }
    setStatus("loading");
    const source_path = typeof window !== "undefined" ? window.location.pathname : null;
    const { error: dbError } = await supabase.from("landing_leads").insert({
      email: parsed.data,
      form_type: formType,
      source_path,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
    if (dbError) {
      setStatus("error");
      setError("Something went wrong. Please try again.");
      return;
    }
    supabase.functions.invoke("notify-lead", {
      body: { email: parsed.data, form_type: formType, source_path },
    }).catch((err) => console.error("notify-lead failed:", err));
    setStatus("success");
    setEmail("");
  }

  return { email, setEmail, status, error, submit };
}

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function closeMenu() {
  const menu = document.getElementById("navlinks");
  const btn = document.querySelector<HTMLButtonElement>(".bidbox-landing .menu-btn");
  if (menu) menu.classList.remove("open");
  if (btn) {
    btn.setAttribute("aria-expanded", "false");
    btn.textContent = "☰";
  }
}

function toggleMenu() {
  const menu = document.getElementById("navlinks");
  const btn = document.querySelector<HTMLButtonElement>(".bidbox-landing .menu-btn");
  if (!menu || !btn) return;
  const open = menu.classList.toggle("open");
  btn.setAttribute("aria-expanded", String(open));
  btn.textContent = open ? "✕" : "☰";
}

function anchorClick(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
  e.preventDefault();
  closeMenu();
  scrollToId(id);
}

function scrollToTrialForm(e: React.MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  closeMenu();
  scrollToId("trial-form");
}

const Landing = () => {
  const { user, authReady } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (authReady && user) navigate("/calendar", { replace: true });
  }, [authReady, user, navigate]);

  const news = useLeadForm("newsletter");
  const trial = useLeadForm("trial_request");
  const footerNews = useLeadForm("newsletter");

  if (!authReady) return null;

  return (
    <div className="bidbox-landing">
      <header className="site-header">
        <div className="wrap nav">
          <a className="logo" href="#" aria-label="BidBox home">
            <img src={logo} alt="BidBox" />
          </a>
          <button
            className="menu-btn"
            aria-label="Open menu"
            aria-expanded="false"
            onClick={toggleMenu}
          >
            ☰
          </button>
          <nav className="nav-links" id="navlinks">
            <a href="#how" onClick={(e) => anchorClick(e, "how")}>How it works</a>
            <a href="#pricing" onClick={(e) => anchorClick(e, "pricing")}>Pricing</a>
            <a href="#report" onClick={(e) => anchorClick(e, "report")}>What's bidding</a>
            <a
              href="/auth"
              onClick={(e) => { e.preventDefault(); closeMenu(); navigate("/auth"); }}
              style={{ color: "var(--blue)", fontWeight: 600 }}
            >
              Log in
            </a>
            <a className="btn btn-primary" href="/auth?mode=signup" onClick={(e) => { e.preventDefault(); closeMenu(); navigate("/auth?mode=signup"); }}>
              Start free trial
            </a>
          </nav>
        </div>
      </header>

      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <span className="eyebrow">For California public works GCs</span>
            <h1>
              Never miss a public works bid <em>you should have won.</em>
            </h1>
            <p>
              BidBox finds every project worth bidding in your area, pulls the plans and specs,
              flags the requirements, and gets you ready for bid day.
            </p>
            <div className="cta-row">
              <a className="btn btn-primary" href="/auth?mode=signup" onClick={(e) => { e.preventDefault(); navigate("/auth?mode=signup"); }}>Start free trial</a>
              <a className="btn btn-ghost" href="#how" onClick={(e) => anchorClick(e, "how")}>See how it works</a>
            </div>
            <span className="micro">Set up in minutes · 14-day free trial · Your counties, your trades</span>
          </div>

          <div className="bidtab" aria-label="Sample BidBox project pipeline">
            <div className="bidtab-head">
              <span className="bidtab-title">Your pipeline · Orange County</span>
              <span className="live-dot">LIVE</span>
            </div>
            <div className="bt-label bt-row" style={{ borderBottom: "none", paddingBottom: 2 }}>
              <span>Project</span><span>Bid date</span>
              <span className="bt-walk">Job walk</span><span className="bt-add">Addenda</span>
            </div>
            <div className="bt-row">
              <div>
                <div className="bt-project">Storm Drain Rehab, Phase 2</div>
                <div className="bt-agency">City of Anaheim</div>
              </div>
              <span className="bt-date">AUG 06</span>
              <span className="bt-walk"><span className="flag flag-walk">MANDATORY</span></span>
              <span className="bt-add bt-date">3</span>
            </div>
            <div className="bt-row">
              <div>
                <div className="bt-project">Elementary Roofing Package</div>
                <div className="bt-agency">Santa Ana USD</div>
              </div>
              <span className="bt-date">AUG 12</span>
              <span className="bt-walk"><span className="flag flag-ok">JUL 30</span></span>
              <span className="bt-add bt-date">1</span>
            </div>
            <div className="bt-row">
              <div>
                <div className="bt-project">Sidewalk &amp; ADA Ramp Improvements</div>
                <div className="bt-agency">OC Public Works</div>
              </div>
              <span className="bt-date">AUG 19</span>
              <span className="bt-walk"><span className="flag flag-ok">NONE</span></span>
              <span className="bt-add bt-date">0</span>
            </div>
            <div className="toast" role="status">
              <span className="flag">ADDENDUM 3</span>
              <span>Bid form replaced · Storm Drain Rehab</span>
              <span className="t-time">7:02 AM</span>
            </div>
          </div>
        </div>
      </section>

      <div className="coverage">
        <div className="wrap">
          <p>Tracking bids from hundreds of California agencies, including</p>
          <div className="marquee">
            <div className="marquee-track">
              <span>Caltrans</span><span>County of Los Angeles</span><span>OC Public Works</span>
              <span>City of San Diego</span><span>San Bernardino County</span><span>Riverside County</span>
              <span>LAUSD</span><span>City of Anaheim</span><span>Santa Ana USD</span>
              <span>City of Irvine</span><span>+ your local districts</span>
              <span aria-hidden="true">Caltrans</span><span aria-hidden="true">County of Los Angeles</span>
              <span aria-hidden="true">OC Public Works</span><span aria-hidden="true">City of San Diego</span>
              <span aria-hidden="true">San Bernardino County</span><span aria-hidden="true">Riverside County</span>
              <span aria-hidden="true">LAUSD</span><span aria-hidden="true">City of Anaheim</span>
              <span aria-hidden="true">Santa Ana USD</span><span aria-hidden="true">City of Irvine</span>
              <span aria-hidden="true">+ your local districts</span>
            </div>
          </div>
        </div>
      </div>

      <section className="stakes">
        <div className="wrap">
          <span className="eyebrow">The problem</span>
          <h2>Right now, somewhere in California, your next job is buried in a portal you didn't check.</h2>
          <p>
            Public works bids are scattered across hundreds of agency websites. Addenda drop without warning.
            Job walks are mandatory and easy to miss. <strong>The GCs who win aren't better builders. They just never miss the details.</strong> That should be you.
          </p>
        </div>
      </section>

      <section>
        <div className="wrap">
          <span className="eyebrow">What BidBox does</span>
          <h2>Built for how public works bidding actually works.</h2>
          <div className="vgrid">
            <div className="vcard">
              <span className="vnum">DISCOVERY</span>
              <h3>Every bid, one place.</h3>
              <p>BidBox watches the agency portals so you don't have to. New projects in your counties and trades show up in your pipeline automatically, with plans and specs already pulled.</p>
              <div className="v-vig" aria-hidden="true">
                <div className="vr"><span className="vl">CITY OF ANAHEIM</span><span className="vv blue">NEW BID · 6:14 AM</span></div>
                <div className="vr"><span className="vl">RIVERSIDE USD</span><span className="vv blue">NEW BID · 6:15 AM</span></div>
                <div className="vr"><span className="vl">OC PUBLIC WORKS</span><span className="vv blue">NEW BID · 6:15 AM</span></div>
              </div>
            </div>
            <div className="vcard">
              <span className="vnum">ANALYSIS</span>
              <h3>Read 400 pages in 4 minutes.</h3>
              <p>Bid date, job walk, bond requirements, licensing, engineer's estimate, addenda count. Extracted from the documents and linked back to the source page so you can verify in one click.</p>
              <div className="v-vig" aria-hidden="true">
                <div className="vr"><span className="vl">BID BOND</span><span className="vv">10% <span style={{ color: "var(--blue)" }}>→ p.14</span></span></div>
                <div className="vr"><span className="vl">LICENSE</span><span className="vv">CLASS A <span style={{ color: "var(--blue)" }}>→ p.3</span></span></div>
                <div className="vr"><span className="vl">ENGINEER'S EST</span><span className="vv">$4.2M <span style={{ color: "var(--blue)" }}>→ p.1</span></span></div>
              </div>
            </div>
            <div className="vcard">
              <span className="vnum">TRACKING</span>
              <h3>Nothing slips.</h3>
              <p>Deadline calendar, addenda alerts, and job walk reminders. The details that disqualify bids get flagged before they cost you the job.</p>
              <div className="v-vig" aria-hidden="true">
                <div className="vr"><span className="vl">STORM DRAIN REHAB</span><span className="vv orange">ADDENDUM 3 · TODAY</span></div>
                <div className="vr"><span className="vl">JOB WALK</span><span className="vv orange">MANDATORY · JUL 30</span></div>
                <div className="vr"><span className="vl">BID DUE</span><span className="vv">AUG 06 · 2:00 PM</span></div>
              </div>
            </div>
            <div className="vcard">
              <span className="vnum">BID DAY</span>
              <h3>Your subs, one link.</h3>
              <p>Send every sub the full document set with a single link. No logins, no accounts, no 50MB attachments. See how many times your plans have been opened, so you know if your invites are landing.</p>
              <div className="v-vig" aria-hidden="true">
                <div className="vr"><span className="vl">BID ROOM LINK</span><span className="vv blue">SENT · 12 SUBS</span></div>
                <div className="vr"><span className="vl">PLAN VIEWS</span><span className="vv ok">27</span></div>
                <div className="vr"><span className="vl">LOGINS REQUIRED</span><span className="vv">0</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="plan" id="how">
        <div className="wrap">
          <span className="eyebrow">The plan</span>
          <h2>Win more work in three steps.</h2>
          <div className="steps">
            <div className="step">
              <span className="snum">STEP 1</span>
              <h3>Set your coverage.</h3>
              <p>Pick your counties and the work you chase. Two minutes, no onboarding calls, no training. BidBox starts watching immediately.</p>
              <div className="s-vig" aria-hidden="true"><span className="s-chip">ORANGE ✓</span><span className="s-chip">RIVERSIDE ✓</span><span className="s-chip">SITEWORK ✓</span><span className="s-chip">CONCRETE ✓</span></div>
            </div>
            <div className="step">
              <span className="snum">STEP 2</span>
              <h3>BidBox works the portals.</h3>
              <p>Every agency checked daily. New bids land in your pipeline with the documents pulled, key requirements extracted, and every deadline already on your calendar.</p>
              <div className="s-vig" aria-hidden="true"><span className="s-chip dark">41 AGENCIES CHECKED</span><span className="s-chip">3 NEW MATCHES</span></div>
            </div>
            <div className="step">
              <span className="snum">STEP 3</span>
              <h3>You show up ready.</h3>
              <p>Job walks and addenda flagged the moment they drop. Subs get one link to everything. You walk into bid day organized instead of scrambling.</p>
              <div className="s-vig" aria-hidden="true"><span className="s-chip orange">ADDENDUM FLAGGED</span><span className="s-chip dark">BID DAY · READY ✓</span></div>
            </div>
          </div>
          <a className="btn btn-primary" href="/auth?mode=signup" onClick={(e) => { e.preventDefault(); navigate("/auth?mode=signup"); }}>Start free trial</a>
        </div>
      </section>

      <section className="guide">
        <div className="wrap guide-inner">
          <div>
            <span className="eyebrow">The difference</span>
            <h2>What changes when nothing slips.</h2>
            <div className="ba">
              <div className="ba-col ba-before">
                <h4>Before BidBox</h4>
                <ul>
                  <li>Portals checked "when there's time"</li>
                  <li>Addenda discovered on bid day</li>
                  <li>Sub docs scattered across email threads</li>
                  <li>Missed jobs found out at the results</li>
                </ul>
              </div>
              <div className="ba-col ba-after">
                <h4>With BidBox</h4>
                <ul>
                  <li>Every agency watched daily, automatically</li>
                  <li>Addenda flagged the morning they drop</li>
                  <li>One link to your subs, engagement visible</li>
                  <li>You choose your bids instead of finding them late</li>
                </ul>
              </div>
            </div>
            <div className="founder-line">Built by the founder of BidBox, former VP of Operations at a Public Works GC.</div>
          </div>
          <div className="seo-block">
            <p className="seo-lede">Public works contractors waste hours digging through agency portals and still miss bids they should have won. BidBox finds every project worth bidding, flags what it takes to qualify, and gets you ready for bid day.</p>
            <p className="seo-kicker">So you win more work without hiring another estimator.</p>
          </div>
        </div>
      </section>

      <section className="magnet" id="report">
        <div className="wrap magnet-inner">
          <div>
            <div className="report-masthead">
              <span className="report-badge">What's bidding · Who won · Every Tuesday</span>
              <div className="report-name">The California Public Works<br />Bid Report</div>
            </div>
            <h2 className="report-hook">Keep your finger on the pulse.</h2>
            <p>A free weekly email: every public works job bidding in your counties, who won last week's bids, and by how much. The numbers estimators forward to each other, and nobody else publishes.</p>
            <form className="form-row" onSubmit={news.submit} noValidate>
              <input
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                placeholder="Enter your work email"
                aria-label="Work email"
                required
                value={news.email}
                onChange={(e) => news.setEmail(e.target.value)}
                disabled={news.status === "loading" || news.status === "success"}
              />
              <button className="btn btn-primary" type="submit" disabled={news.status === "loading" || news.status === "success"}>
                {news.status === "loading" ? "Sending..." : "Get the Bid Report"}
              </button>
            </form>
            {news.status === "success" && <div className="form-success">{SUCCESS}</div>}
            {news.status === "error" && <div className="form-error">{news.error}</div>}
            <span className="micro" style={{ display: "block", marginTop: 10 }}>
              Free, every Tuesday. Unsubscribe anytime.
            </span>
          </div>
          <div className="magnet-card">
            <span className="mc-tag">Sample issue</span>
            <h3>This week:</h3>
            <ul>
              <li>Who won last week, and by how much</li>
              <li>41 new public works bids across SoCal</li>
              <li>Storm drain rehab: 9 bidders, low bid 11% under estimate</li>
              <li>14 jobs bidding in Orange County in the next 30 days</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="pricing">
        <div className="wrap">
          <span className="eyebrow">Pricing</span>
          <h2>Flat pricing for your whole company.</h2>
          <div className="pgrid">
            <div className="pcard">
              <h3>Tracker</h3>
              <div className="price">$199<small>/mo</small></div>
              <div className="p-note">DISCOVERY + TRACKING</div>
              <ul>
                <li>Every bid in your coverage area</li>
                <li>Pipeline and deadline calendar</li>
                <li>Addenda and job walk alerts</li>
              </ul>
              <a className="btn btn-ghost" href="/auth?mode=signup" onClick={(e) => { e.preventDefault(); navigate("/auth?mode=signup"); }}>Start free trial</a>
            </div>
            <div className="pcard featured">
              <span className="badge">MOST GCs CHOOSE COMMAND</span>
              <h3>Command</h3>
              <div className="price">$449<small>/mo</small></div>
              <div className="p-note">THE FULL BIDDING OPERATION</div>
              <ul>
                <li>Everything in Tracker</li>
                <li>AI document analysis: read 400 pages in 4 minutes</li>
                <li>Requirements extracted and source-linked: bonds, licensing, job walks, deadlines</li>
                <li>Bid Rooms: send subs everything in one link, see who opened the plans</li>
              </ul>
              <a className="btn btn-primary" href="/auth?mode=signup" onClick={(e) => { e.preventDefault(); navigate("/auth?mode=signup"); }}>Start free trial</a>
            </div>
          </div>
          <p className="p-foot">14-day free trial · Cancel anytime before day 14 and pay nothing</p>
        </div>
      </section>

      <section className="faq">
        <div className="wrap">
          <span className="eyebrow">FAQ</span>
          <h2>Frequently asked questions.</h2>
          <div className="faq-list">
            <details>
              <summary>What is BidBox?</summary>
              <div className="a">BidBox is bid management software for California public works general contractors. It watches hundreds of agency websites, finds every project that fits your counties and trades, pulls the plans and specs, extracts the key requirements, and tracks every deadline, job walk, and addendum through bid day. Think of it as an extra estimator who never sleeps and never forgets a portal.</div>
            </details>
            <details>
              <summary>How does BidBox help a small or mid-size GC?</summary>
              <div className="a">Three ways. You see every job worth bidding instead of only the ones you stumble on. You stop losing bids to missed addenda, job walks, and buried requirements. And your bid days get calm: documents to subs in one link, every deadline on one calendar, nothing living in email threads. More bids submitted, fewer disqualifications, same team.</div>
            </details>
            <details>
              <summary>What do I need to do to get it?</summary>
              <div className="a">1. Request your free trial with the form below. 2. Complete your bidder profile. 3. Bid for 14 days free, card on file. Cancel anytime before day 14 and pay nothing.</div>
            </details>
            <details>
              <summary>Do my subs need accounts?</summary>
              <div className="a">No. That's the point. Subs get one link and see everything organized, no logins, no account walls, no giant downloads. Easier access means more subs actually looking at your job.</div>
            </details>
            <details>
              <summary>Which agencies do you cover?</summary>
              <div className="a">California cities, counties, school districts, and special districts. Bid an agency we don't cover yet? Request it and we add it, typically within two weeks.</div>
            </details>
            <details>
              <summary>How accurate is the AI extraction?</summary>
              <div className="a">Every extracted field links directly back to the page in the source document it came from. You never trust a summary; you verify in one click instead of reading 400 pages. Treat it like a sharp junior estimator: it does the reading, you do the confirming.</div>
            </details>
            <details>
              <summary>Is this a planroom?</summary>
              <div className="a">No. Planrooms show you what's out there. BidBox runs the pursuit: extracted requirements, addenda tracking, job walk alerts, sub document distribution, and one calendar through bid day.</div>
            </details>
          </div>
        </div>
      </section>

      <section className="final" id="trial-form">
        <div className="wrap">
          <h2>Ready to stop hunting and start winning?</h2>
          <p>Set your coverage area now and see every public works bid you're missing.</p>
          <form className="form-row" onSubmit={trial.submit} noValidate>
            <input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              spellCheck={false}
              placeholder="Enter your work email"
              aria-label="Work email"
              required
              value={trial.email}
              onChange={(e) => trial.setEmail(e.target.value)}
              disabled={trial.status === "loading" || trial.status === "success"}
            />
            <button className="btn btn-primary" type="submit" disabled={trial.status === "loading" || trial.status === "success"}>
              {trial.status === "loading" ? "Sending..." : "Start free trial"}
            </button>
          </form>
          {trial.status === "success" && <div className="form-success">{SUCCESS}</div>}
          {trial.status === "error" && <div className="form-error">{trial.error}</div>}
          <span className="micro">✓ 14-day free trial &nbsp; ✓ Cancel anytime &nbsp; ✓ Set up in minutes</span>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <div className="foot-grid">
            <div>
              <a className="logo" href="#" aria-label="BidBox home">
                <img src={logo} alt="BidBox" />
              </a>
              <p className="foot-one-liner">Public works contractors waste hours digging through agency portals and still miss bids they should have won. BidBox finds every project worth bidding, flags what it takes to qualify, and gets you ready for bid day.</p>
            </div>
            <div>
              <h4>Product</h4>
              <a href="#how" onClick={(e) => anchorClick(e, "how")}>How it works</a>
              <a href="#pricing" onClick={(e) => anchorClick(e, "pricing")}>Pricing</a>
              <a
                href="/auth"
                onClick={(e) => { e.preventDefault(); navigate("/auth"); }}
              >
                Log in
              </a>
            </div>
            <div>
              <h4>Company</h4>
              <a href="#">Contact</a>
              <a href="/privacy" onClick={(e) => { e.preventDefault(); navigate("/privacy"); }}>Privacy policy</a>
              <a href="/terms" onClick={(e) => { e.preventDefault(); navigate("/terms"); }}>Terms of service</a>
            </div>
            <div>
              <h4>The California Public Works Bid Report</h4>
              <p style={{ fontSize: 13.5 }}>What's bidding. Who won. Every week.</p>
              <form className="foot-form" onSubmit={footerNews.submit} noValidate>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  spellCheck={false}
                  placeholder="Your email"
                  aria-label="Email for the Bid Report"
                  value={footerNews.email}
                  onChange={(e) => footerNews.setEmail(e.target.value)}
                  disabled={footerNews.status === "loading" || footerNews.status === "success"}
                />
                <button type="submit" disabled={footerNews.status === "loading" || footerNews.status === "success"}>
                  {footerNews.status === "loading" ? "..." : "Subscribe"}
                </button>
              </form>
              {footerNews.status === "success" && <div className="form-success" style={{ color: "#fff" }}>{SUCCESS}</div>}
              {footerNews.status === "error" && <div className="form-error">{footerNews.error}</div>}
            </div>
          </div>
          <div className="foot-bottom">
            <span>© 2026 BidBox. All rights reserved.</span>
            <span>Built in Irvine, California.</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
