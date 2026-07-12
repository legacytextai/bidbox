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
    const { error: dbError } = await supabase.from("landing_leads").insert({
      email: parsed.data,
      form_type: formType,
      source_path: typeof window !== "undefined" ? window.location.pathname : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
    if (dbError) {
      setStatus("error");
      setError("Something went wrong. Please try again.");
      return;
    }
    setStatus("success");
    setEmail("");
  }

  return { email, setEmail, status, error, submit };
}

function scrollToTrialForm(e: React.MouseEvent) {
  e.preventDefault();
  const el = document.getElementById("trial-form");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  const menu = document.getElementById("navlinks");
  if (menu?.classList.contains("open")) closeMenu();
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

function anchorClick(_e: React.MouseEvent) {
  closeMenu();
}

const Landing = () => {
  const { user, authReady } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (authReady && user) navigate("/calendar", { replace: true });
  }, [authReady, user, navigate]);

  const guide = useLeadForm("guide");
  const trial = useLeadForm("trial_request");
  const news = useLeadForm("newsletter");

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
            <a href="#how" onClick={anchorClick}>How it works</a>
            <a href="#pricing" onClick={anchorClick}>Pricing</a>
            <a href="#report" onClick={anchorClick}>What's bidding</a>
            <a
              href="/auth"
              onClick={(e) => { e.preventDefault(); closeMenu(); navigate("/auth"); }}
              style={{ color: "var(--blue)", fontWeight: 600 }}
            >
              Log in
            </a>
            <a className="btn btn-primary" href="#trial-form" onClick={scrollToTrialForm}>
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
              <a className="btn btn-primary" href="#trial-form" onClick={scrollToTrialForm}>Start free trial</a>
              <a className="btn btn-ghost" href="#how" onClick={anchorClick}>See how it works</a>
            </div>
            <span className="micro">Set up in minutes · No credit card · Your counties, your trades</span>
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
            </div>
            <div className="vcard">
              <span className="vnum">ANALYSIS</span>
              <h3>Read 400 pages in 4 minutes.</h3>
              <p>Bid date, job walk, bond requirements, licensing, engineer's estimate, addenda count. Extracted from the documents and linked back to the source page so you can verify in one click.</p>
            </div>
            <div className="vcard">
              <span className="vnum">TRACKING</span>
              <h3>Nothing slips.</h3>
              <p>Deadline calendar, addenda alerts, and job walk reminders. The details that disqualify bids get flagged before they cost you the job.</p>
            </div>
            <div className="vcard">
              <span className="vnum">BID DAY</span>
              <h3>Bid day, handled.</h3>
              <p>Share a Bid Room link with your subs. No logins, no accounts. Quotes come back to one organized place, so you walk into bid day calm instead of digging through email threads.</p>
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
              <p>Your counties, your trades, two minutes.</p>
            </div>
            <div className="step">
              <span className="snum">STEP 2</span>
              <h3>BidBox does the digging.</h3>
              <p>Every matching bid found, analyzed, and tracked.</p>
            </div>
            <div className="step">
              <span className="snum">STEP 3</span>
              <h3>Show up ready.</h3>
              <p>Organized pursuits, coordinated subs, clean bid days.</p>
            </div>
          </div>
          <a className="btn btn-primary" href="#trial-form" onClick={scrollToTrialForm}>Start free trial</a>
        </div>
      </section>

      <section className="guide">
        <div className="wrap guide-inner">
          <div>
            <span className="eyebrow">Who built this</span>
            <h2>Built by someone who lived it.</h2>
            <blockquote>This is the tool our estimating desk always needed. I spent years finding jobs the hard way, chasing addenda, and running 4am bid days.</blockquote>
            <div className="attr">Abdul Bidiwi · Founder, BidBox · Former VP of Operations, public works GC</div>
          </div>
          <div className="seo-block">
            <p><strong>Public works contractors waste hours digging through agency portals and still miss bids they should have won. BidBox finds every project worth bidding, flags what it takes to qualify, and gets you ready for bid day. So you win more work without hiring another estimator.</strong></p>
            <br />
            <p>BidBox is a bid management platform for public works general contractors in California. It monitors hundreds of city, county, school district, and special district portals, automatically extracts key requirements from plans and specifications, tracks addenda and deadlines, and coordinates subcontractor quotes through shareable Bid Rooms. Small GCs use BidBox to pursue more public bids with the same team, qualify faster, and stay organized through bid day.</p>
          </div>
        </div>
      </section>

      <section className="magnet" id="report">
        <div className="wrap magnet-inner">
          <div>
            <span className="eyebrow">Free guide</span>
            <h2>The 7 ways GCs lose public works bids before bid day.</h2>
            <p>The missed addendum. The mandatory job walk nobody attended. The bond requirement found too late. Seven silent killers and the checklist that stops every one of them.</p>
            <form className="form-row" onSubmit={guide.submit} noValidate>
              <input
                type="email"
                placeholder="Enter your work email"
                aria-label="Work email"
                required
                value={guide.email}
                onChange={(e) => guide.setEmail(e.target.value)}
                disabled={guide.status === "loading" || guide.status === "success"}
              />
              <button className="btn btn-primary" type="submit" disabled={guide.status === "loading" || guide.status === "success"}>
                {guide.status === "loading" ? "Sending..." : "Send me the guide"}
              </button>
            </form>
            {guide.status === "success" && <div className="form-success">{SUCCESS}</div>}
            {guide.status === "error" && <div className="form-error">{guide.error}</div>}
            <span className="micro" style={{ display: "block", marginTop: 10 }}>
              Includes the weekly California Public Works Bid Report. Unsubscribe anytime.
            </span>
          </div>
          <div className="magnet-card">
            <span className="mc-tag">Inside the guide</span>
            <h3>What kills bids early:</h3>
            <ul>
              <li>The job you never saw</li>
              <li>The addendum that disqualified you</li>
              <li>The mandatory walk nobody attended</li>
              <li>The qualification detail found too late</li>
              <li>The sub quotes that never came</li>
              <li>The bid day scramble</li>
              <li>The lesson nobody logged</li>
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
              <a className="btn btn-ghost" href="#trial-form" onClick={scrollToTrialForm}>Start free trial</a>
            </div>
            <div className="pcard featured">
              <span className="badge">MOST GCs CHOOSE COMMAND</span>
              <h3>Command</h3>
              <div className="price">$449<small>/mo</small></div>
              <div className="p-note">THE FULL BIDDING OPERATION</div>
              <ul>
                <li>Everything in Tracker</li>
                <li>Document analysis and requirement extraction</li>
                <li>Qualification flags: license, DIR, bonds, prequal</li>
                <li>Bid Rooms and sub coordination, no sub logins</li>
              </ul>
              <a className="btn btn-primary" href="#trial-form" onClick={scrollToTrialForm}>Start free trial</a>
            </div>
          </div>
          <p className="p-foot">14-day trial · No credit card · Cancel anytime · Your data exports with you</p>
        </div>
      </section>

      <section className="faq">
        <div className="wrap">
          <span className="eyebrow">FAQ</span>
          <h2>Frequently asked questions.</h2>
          <div className="faq-list">
            <details>
              <summary>Do my subs need accounts?</summary>
              <div className="a">No. That's the point. Subs get one link, see the documents organized by trade, and send quotes back. No logins, no downloads, no friction.</div>
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
              <summary>Can I take my data if I leave?</summary>
              <div className="a">Yes. Your bid history is yours. Ask and we deliver everything as Excel files, anytime, including on your way out. No lock-in, no hostage data.</div>
            </details>
            <details>
              <summary>Is this a planroom?</summary>
              <div className="a">No. Planrooms show you what's out there. BidBox helps you win it: qualification flags, addenda tracking, sub coordination, and bid day prep on top of discovery.</div>
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
          <span className="micro">✓ 14-day trial &nbsp; ✓ No credit card &nbsp; ✓ Set up in minutes</span>
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
              <a href="#how" onClick={anchorClick}>How it works</a>
              <a href="#pricing" onClick={anchorClick}>Pricing</a>
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
              <form className="foot-form" onSubmit={news.submit} noValidate>
                <input
                  type="email"
                  placeholder="Your email"
                  aria-label="Email for the Bid Report"
                  value={news.email}
                  onChange={(e) => news.setEmail(e.target.value)}
                  disabled={news.status === "loading" || news.status === "success"}
                />
                <button type="submit" disabled={news.status === "loading" || news.status === "success"}>
                  {news.status === "loading" ? "..." : "Subscribe"}
                </button>
              </form>
              {news.status === "success" && <div className="form-success" style={{ color: "#fff" }}>{SUCCESS}</div>}
              {news.status === "error" && <div className="form-error">{news.error}</div>}
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
