# THE CALIFORNIA PUBLIC WORKS BID REPORT
## Full Product Spec + First Four Issues

*Internal spec. All reader-facing copy blocks contain no em dashes. Home: Public Works Channel. Send day: Tuesday 6:00am PT (estimators read early; Monday is sweep day and inboxes are full; Tuesday morning owns a quiet slot).*

---

## 1. Editorial identity

**Name:** The California Public Works Bid Report
**From line:** Abdul at BidBox
**Tagline (verbatim, everywhere):** What's bidding. Who won. Every week.
**Voice:** an operator talking to operators. Numbers first, opinions earned, zero hype. If a sentence could appear in a SaaS blog, cut it.
**Length discipline:** readable in under 4 minutes. The report earns its slot by respecting time; the moment it bloats, it dies.
**The one rule:** every issue must contain at least one number the reader can't get anywhere else without an hour of work. That number is the product demo.

## 2. Sections (fixed skeleton, every issue, same order)

### S1: The Number (30 seconds)
One statistic from the week's crawl, stated plainly, with one sentence of why it matters.
> "41 public works projects hit the street across SoCal last week. Median bid window: 19 days."

**Data pull:** count of new postings by region, computed bid-window stats (bid date minus posting date).

### S2: Results Desk (the gossip column, the reason people open)
5 to 8 notable bid results from the week. Fixed row format:
> **[Project], [Agency].** [N] bidders. Low: [Contractor], $[amount] ([X]% under/over engineer's estimate). Spread low-to-second: [Y]%.

One line of commentary on at most two rows, only when the data says something ("nine bidders on a $2M sitework job is a knife fight; margins in that lane are getting thin").

**Data pulls:** bid results scraped from agency postings/board agendas; bidder counts; low bid vs. engineer's estimate delta; low-to-second spread. *This is the section that requires the crawl to capture results, not just solicitations. If results coverage is thin at launch, run fewer rows, never fake density.*

### S3: The Forward Look (the utility, the reason people stay)
The 10 to 15 most notable projects bidding in the next 21 days, grouped by region. Fixed row: Project / Agency / Bid date / Walk (date + MANDATORY flag) / Engineer's estimate / License class.
Footer line (verbatim, every issue):
> "This is the shortlist. Your full county forecast, updated daily, lives in BidBox: [link]"

**Data pulls:** active solicitations filtered by bid date window, sorted by estimate size and mandatory-walk urgency. This section is a straight product export; it should cost near-zero marginal effort.

### S4: Watch List (the differentiator)
3 to 5 projects visible upstream of solicitation: board approvals, budget line items, pre-solicitation notices, CEQA milestones.
> "Anaheim council approved design funds for the Lincoln Ave storm drain rehab (est. $4.2M). Expect solicitation in Q4."

**Data pulls:** council/board agenda crawling, CIP budget documents. Hardest pull, highest perceived value; nobody hands GCs the forward look. Acceptable to launch with 2 items and grow.

### S5: One Lesson (the voice, 120 words max)
One operator lesson tied to something in this issue's data. This is the only editorial section and the only place Abdul's GC background speaks. Rotates themes: addenda discipline, go/no-go screens, sub coverage, bid-day process, reading results for strategy.

### S6: The Sign-off (fixed, verbatim)
> "Forward this to someone who bids public work; they'll owe you one. New here? Get your county's full 30-day forecast free: [link]. And if the pile of portals ever gets old, BidBox watches every agency for you: [trial link]. Good bidding. Abdul"

## 3. Data pipeline requirements (build once, run forever)

| Report section | Crawl requirement | Status check needed |
|---|---|---|
| S1 | New-posting counts + dates | Should exist today |
| S2 | Bid results + bidder lists + amounts | Likely partial; prioritize the 20 highest-volume agencies first |
| S3 | Active solicitations w/ extracted fields | Core product; exists |
| S4 | Agenda/CIP monitoring | New capability; start manual (30 min/week reading 5 big-agency agendas), automate later |
| Weekly QA | Human verify every date and dollar figure before send | Non-negotiable; one wrong bid date costs more than 10 issues earn |

**Production budget:** 90 minutes/week total once S2 coverage exists (export S1/S3, compile S2, 30 min manual S4, write S5, QA). If it's taking 3+ hours, the pipeline is broken; fix the pipeline, don't grind.

## 4. Growth mechanics wired into the report

- Every subscriber came from: lead magnet gates, county forecast pages, LinkedIn derivatives, or the forward loop. Tag sources; watch which compounds.
- The forward loop is the engine: "forward this" line + a one-click subscribe for recipients.
- KPI set (monthly review): subscriber count, open rate (target >45%; this niche runs hot when relevant), forward-driven signups, trials attributed. Vanity metric to ignore: total subs outside CA.
- Milestones: 200 CA subs by issue 8 = working. 500 by issue 26 = a moat forming. Stall below 100 by issue 12 = distribution problem (LinkedIn derivatives and county pages), not a content problem; don't redesign the report.

---

## 5. THE FIRST FOUR ISSUES (outlined)

*Structure locked; illustrative examples marked [SAMPLE] get replaced with live crawl data in production.*

### Issue #1: "The ones nobody saw"
**Job:** establish the core claim (bids die quietly) with data, introduce the format.
- S1: total new postings across SoCal last week + the count posted by agencies outside the big planrooms' coverage [SAMPLE: "41 new projects; 9 of them appeared only on individual agency sites"]
- S2: 6 results; flag one with a huge low-to-second spread as the commentary row ("someone left $180k on the table; that's a coverage story, not a pricing story")
- S3: standard 21-day forward table, SoCal
- S4: 2 watch-list items from OC/LA agendas
- S5 lesson: the go/no-go hour ("kill pursuits on day one, not day twelve")
- Launch note at top, 2 sentences max: what this is, what it will always be. No founder story. The data is the introduction.

### Issue #2: "The addenda issue"
**Job:** own the sharpest pain on record.
- S1: count of addenda issued across tracked active solicitations last week; % of active jobs with 2+ addenda [SAMPLE: "63 addenda across 38 active jobs; 40% of live pursuits changed underneath their bidders last week"]
- S2: standard results desk; commentary on any result where an addendum moved the bid date
- S3: forward table; add a flag column this issue only: jobs that have already issued addenda
- S4: 3 watch-list items
- S5 lesson: the addenda log ritual (two lines per addendum: what changed, what we did)

### Issue #3: "Who's actually winning"
**Job:** first analytical issue; the forwardable one.
- S1: median bidder count per job over the first three weeks of data
- S2: expanded to 8 rows; add a mini-league table: contractors with 2+ wins in the tracked period [SAMPLE format: "Winner / Awards / Combined value / Avg % under estimate"]
- S3: standard forward table
- S4: standard
- S5 lesson: read results like a strategist ("if the same two names keep winning a lane 10% under estimate, that lane is telling you to hunt elsewhere or sharpen up")
- This issue's league table is the natural LinkedIn breakout post; expect it to drive the biggest subscriber bump of the first month.

### Issue #4: "The spread issue"
**Job:** teach one concept (low-to-second spread) and cement the habit loop; first light CTA escalation.
- S1: average low-to-second spread across all tracked results to date, stated with the interpretation [SAMPLE: "average spread 6.8%; anything under 2% means real competition, anything over 10% usually means a coverage or scope-read gap"]
- S2: results desk sorted by spread this issue
- S3: standard forward table
- S4: standard; if any Issue-1 watch-list item has since gone to solicitation, close the loop visibly ("called it in Issue 1; it's out now, bids Sept 3"). This proves the forward look works.
- S5 lesson: what your own spread history tells you (introduces the post-bid 15-minute ritual)
- One-time footer addition: "A few founding slots remain for GCs who want BidBox set up personally: [link]" (first and only hard-sell line of the first month)

**Issues 5+:** rotate the four archetypes (coverage, discipline, competition, pricing), add a fifth periodic archetype (agency deep-dive: one agency's year in bids) once data depth allows.
