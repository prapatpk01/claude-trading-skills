# Equity Research Terminal

A web app that turns a **stock ticker** into an institutional-grade equity research
workbook, tracks your **portfolio & watchlist**, and runs a **momentum swing scanner** —
built on Next.js 14 (App Router) + Supabase, with **Yahoo Finance** as the default
data source (free, no API key — same source as Python's `yfinance`).

## Features

### 1. 🔎 Ticker Analysis → downloadable 6-sheet XLSX
Type a ticker and get a live on-screen brief plus a downloadable Excel workbook with
**live formulas, conditional formatting, and source references**:

| Sheet | Contents |
| --- | --- |
| 1. Executive Summary | Overview, current metrics, blended target price, quick thesis, signal drivers |
| 2. Industry & Competition | Sector, TAM/CAGR inputs, growth drivers, peer table, moat assessment |
| 3. Financials & Earnings | Historical revenue/margins (formula-driven), returns, debt profile, earnings beat/miss |
| 4. Thesis, Catalysts & Risks | Bull/Base/Bear scenarios (probability-weighted), 12-month catalyst timeline, risks |
| 5. 3-Statement Model | 5-year IS / CFS / BS forecast — editable assumption cells recompute the model |
| 6. Valuation & Scenarios | WACC build-up, DCF cash flows, terminal value, **live sensitivity grid**, scenario targets |

**How the scenario targets are built.** A bare 5-year DCF systematically undervalues
high-multiple compounders — with a beta-driven WACC and a fast growth taper it can land
70%+ below spot, printing a "bull case" below the current price. So the primary method is
relative: sample the **P/E the market has actually paid** for this company over the past
five years (monthly, against the annual EPS reported at the time), then apply the 25th /
50th / 75th percentile multiples to a forward EPS estimate. Years with anomalously
depressed EPS (write-downs, acquisition amortization) are excluded — they produce
enormous "P/E" readings that reflect a broken denominator — and the band is capped at
±50% of the median multiple. The DCF still runs and is reported as a cross-check, with
beta Blume-adjusted (`0.67·β + 0.33`) so a noisy 2.0+ raw beta can't push WACC past 13%.
Scenario probabilities respond to momentum and to how stretched price is versus the base
case, rather than being fixed.

The 3-statement model and DCF are **linked with real Excel formulas** — edit the blue
assumption cells (growth, margins, WACC, terminal growth) and every downstream number,
including the sensitivity table, recalculates in Excel.

### ⚖️ Sentinel Investment Committee (built in — no API key)
Every section has a **Generate** button that runs the *Sentinel Global Fund* framework
locally over real market data. There is no external model call: the same inputs always
produce the same answer, and every number traces back to a published rule.

| Where | What it runs |
| --- | --- |
| Ticker Analysis | Full committee memo — macro regime, business quality, earnings trend, **Momentum Scoring v3.0**, catalyst/event risk, valuation, sizing & ATR stop, portfolio fit, the **nine pre-trade gates**, CIO verdict |
| Portfolio | Sleeve balance vs the 55/30/13 targets, **Rule #7** drift alerts, **Rule #3** concentration zones, correlation flags, dual-objective scorecard, regime cash floor, prioritised action list |
| Valuation Desk | Fair value per holding from up to three independent anchors, a cheap/fair/rich verdict, and the size change it implies — add *n* shares, trim *n* shares, or exit |
| Watchlist | Every name scored and ranked through v3.0, with hard blocks applied |
| Momentum Scanner | v3.0 score per candidate; names failing a hard block are listed separately with the rule that excluded them |

**Momentum Scoring v3.0** (100 pts): 3A Momentum 35 (RSI · MACD · ADX · RS) · 3B Volume &
Flow 25 (OBV+MFI · volume expansion) · 3C Structure 15 (MA stack · pattern) · 3D High-Beta 10
(ATR% · beta×liquidity) · 3E Trend Maturity 8 (Bollinger position · bars since 20-EMA cross) ·
3F Volatility 7 (ATR expansion · Bollinger state).

**Hard blocks** override any score: ADX < 20 · price below the 200-SMA · OBV distribution while
price rises · RSI < 45 without MA confirmation · dollar volume under $10M. **Rule #1** downgrades
a single block to WATCH when the score exceeds 80; two or more blocks always reject.

**Quant desk — SAMP engine.** Priya Nair's desk runs a faithful port of §0 of
*Sentinel Adaptive Structure v1.6* (Pine v6), the fund's own TradingView indicator, so the
same signal can be evaluated server-side over the app's candles. Five pressure components
(trend velocity, DMI directional pressure, market structure, price action, volume flow) are
combined with **regime-adaptive weights** — strong trend / transition / range — then smoothed
into three layers: **L1 direction**, **L2 strength**, **L3 acceleration**.

A signal fires only when **context, location, trigger and pressure** all agree: macro context by
profile, a room/chase filter that refuses to buy into nearby resistance or an extended move, one
of three triggers (pullback reclaim, sweep reversal, breakout with optional retest), two-bar
pressure persistence, a setup-quality score past its threshold, and a cooldown state machine that
allows one signal per confirmed setup. Pressure crossing a threshold never fires a trade by
itself — which is why a relentless trend can legitimately produce **no** signal.

**Analytical layers above the desks.** Three checks catch what a single desk misses:

- **Multi-timeframe confirmation** — the daily read is checked against the weekly structure.
  A daily signal fighting the weekly trend is the classic failed breakout, so the
  disagreement is stated rather than averaged away.
- **Earnings quality** — cash conversion (OCF / net income), free-cash-flow margin, the
  accrual ratio, the three-year operating-margin trend, and leverage. Reported profit is an
  opinion; cash is a fact, and the gap between them is graded.
- **Conviction & cross-desk conflict** — the desks are combined into one score *and* the
  places they disagree are named: momentum against the pressure engine, daily against
  weekly, momentum against valuation, cheap against poor quality, single-name strength
  against a risk-off tape. Two or more conflicts mark the idea **Conflicted** regardless of
  score, because a high score built on desks pointing opposite ways is a worse trade than a
  moderate one they all agree on.

**The scanner returns nothing when nothing qualifies.** A name is only presented when it
clears the hard blocks, scores above the watch floor, has non-negative SAMP pressure and
offers at least 1:3 reward:risk. Everything it rejected is listed with the rule that
excluded it, and any of those names can be pushed straight to the watchlist.

**Ideas are tracked to their outcome.** A setup saved from the scanner keeps its target,
stop and entry. The app then replays the daily bars from the day it was added and reports
what actually happened — target reached, stop taken out, or still working — with days held,
maximum favourable and adverse excursion, and progress toward target. Levels are judged on
intrabar extremes, and a bar that touches both is read as the stop first, since daily bars
cannot say which came first. The aggregate hit rate is labelled a **Component Estimate**
under Rule #6 until there are enough resolved trades to call it verified.

**Rule #5 is enforced**: any input the free data feed cannot verify is flagged `[U]` and scores
**zero** — it is never estimated. Items the feed genuinely cannot supply (scheduled FOMC/CPI dates,
the earnings blackout, consensus estimates) are reported as such rather than invented, and
**Gate 9 (CIO sign-off) is always manual** — the system prepares a decision, it never approves one.

### 2. 💼 Portfolio & Watchlist
Record holdings (shares, cost basis, personal target, rolling thesis), see live
market value / unrealized P&L, and maintain a watchlist with alert levels and reasons.
Persisted in Supabase; falls back to an in-memory store when Supabase isn't configured.

#### 🍩 Allocation donut — what you own, in what sector, at what weight
A donut of the book by **sector** or **by holding**, with a breakdown table beside it giving
each slice's value and weight.

Sector comes from the **SEC's own SIC code** on each filer — same keyless, datacenter-friendly
source as the rest of the fundamentals — folded onto the eleven GICS sectors people expect.
SIC predates several of the industries it now has to describe, so the mapping carries explicit
overrides where the filing code and the real sector part ways: computer equipment (357x) is
technology rather than machinery, household products are staples rather than chemicals, managed
care is health care rather than insurance, footwear is discretionary rather than rubber, and a
short named list covers filers like Alphabet and Visa whose SIC code describes a business they
have long since outgrown.

**Funds are not looked through.** An ETF's SIC code describes the wrapper, not the holdings, so
classifying SCHD as *Financials* because it registers as an investment office would be worse
than useless. Known wrappers are labelled `Fund / ETF` and the chart says what share of the
book that is, so you can read the ring knowing where it stops.

Charting notes: the palette is the reference categorical order in dark steps, validated against
this app's chart surface with the data-viz validator. Six slots pass on the adjacent pairlist
but **not** all-pairs — the list that governs whenever a reader matches a legend swatch to a
ring position — so identity never rests on colour: every slice is directly labelled, labels are
de-collided vertically, and the table is ordered to match the ring. Slices cap at six plus
`Other`, with a 2px surface gap between segments.

#### 💰 Valuation Desk — fair value & position sizing
Prices every holding against **its own history**, then turns the gap into an instruction.

Up to three independent anchors are computed, and only the ones an instrument's data
actually supports:

| Anchor | What it asks | Works for |
| --- | --- | --- |
| Earnings multiple | What P/E has the market actually paid for these earnings? | Operating companies with an SEC EPS history |
| Dividend yield | What yield has the market demanded from this distribution? | BDCs, REITs, income ETFs |
| Trend regression | Where does price sit against its own long-run drift? | Anything with a year of prices, incl. broad ETFs |

The blend is guarded rather than trusted. An anchor is discarded when the median multiple
is implausible (a company whose EPS was near zero three years ago carries a "P/E" in the
hundreds), when it implies a fair value outside 0.4–2.5× the market price, when a
regression fits too poorly to define a trend, or when it sits more than 2.2× away from
where the other methods agree. The **FAIR band widens as the surviving anchors disagree**,
so an uncertain name is not labelled overvalued on a coin-flip — and with no usable anchor
the desk returns no verdict instead of a guess.

Verdicts are `DEEP VALUE · UNDERVALUED · FAIR · OVERVALUED · STRETCHED`, and the action
follows the fund's own rules:

- **Target weight** = each sleeve's budget split by conviction (momentum score raises it,
  a rich price lowers it), capped at **20% per name (Rule #3)** — with the capped excess
  redistributed to names that can still absorb it, not silently dropped.
- **Adds are suppressed** into any hard block, into an overvalued price (with the buy limit
  quoted), in a Crisis regime, and for growth names in a Risk-Off regime.
- **Adds are capped** by the **1.5%-of-NAV trade risk limit (Rule #4)** against the ATR stop.
- **Exit** fires on a broken 200-day SMA with no *fundamental* valuation support beneath it —
  a trend regression calling the far side of a fall "cheap" does not count.
- Sleeve budgets are renormalised over the sleeves actually held, so an unfilled cash sleeve
  doesn't masquerade as a trim signal on every position.

Every row expands to show its anchors, its confidence, and the reasoning behind the call.

### 3. 📡 Momentum Swing Scanner
Ranks a universe by a **Momentum-Centric Alpha Score** (Momentum & RS 40% · Volume
Accumulation 25% · Structure & Trend 20% · Catalyst Drift 15%) and returns the top swing
setups for a **7–15 day** horizon with entry range, target (measured-move), stop, and R:R,
plus a market-regime read (SPY vs 20-EMA, realized-vol VIX proxy).

## Getting started

```bash
cd webapp
cp .env.example .env        # add your API keys (see below)
npm install
npm run dev                 # http://localhost:3000
```

### Data sources — no API key required
The app layers several **free, keyless** sources so it degrades gracefully:

| Layer | Source | Provides |
| --- | --- | --- |
| Prices | **Yahoo Finance** chart endpoint (`yahoo-finance2`, same source as Python's `yfinance`) | Daily OHLCV, all technicals |
| Quote/fundamentals | Yahoo `quote` / `quoteSummary` | Live quote, ratios — *when reachable* |
| **Fundamentals & statements** | **SEC EDGAR XBRL** company facts | Revenue, income, balance sheet, cash flow, EPS, shares, industry |
| Derived | Price history | 52-week range, beta vs SPY, market cap, P/E, P/S |
| Optional | Alpha Vantage / Finnhub (`ALPHA_VANTAGE_API_KEY`) | Extra fallback + earnings surprises |

> ⚠️ **Why SEC EDGAR matters:** Yahoo's `quote` and `quoteSummary` endpoints require a
> cookie+crumb handshake that Yahoo **blocks for datacenter IPs**. On Vercel/Railway those
> calls fail while the public chart endpoint keeps working — which is why fundamentals used
> to show `0` / `n/a` in production. SEC EDGAR is an official public API with no such
> restriction, so statements and key figures now populate on any host. Set a contact
> `SEC_USER_AGENT` (SEC asks for one); a default is provided.

Optionally switch the price provider with `DATA_PROVIDER=alphavantage` + `ALPHA_VANTAGE_API_KEY`.

### Environment variables (`.env`)
| Var | Purpose | Required |
| --- | --- | --- |
| `DATA_PROVIDER` | `yahoo` (default) or `alphavantage` | Optional |
| `ALPHA_VANTAGE_API_KEY` | Only if `DATA_PROVIDER=alphavantage` | Optional |
| `FINNHUB_API_KEY` | Fallback quote in the Alpha Vantage path | Optional |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Portfolio/watchlist persistence | Optional (in-memory fallback) |

> The Yahoo endpoints are unofficial and can rate-limit under heavy use; the app degrades
> gracefully and surfaces warnings. For a private single-user app this is rarely an issue.

### Supabase setup (optional)
1. Create a project at <https://supabase.com/dashboard>.
2. Open **SQL Editor** → run [`supabase/schema.sql`](supabase/schema.sql).
3. Put the project URL + service-role key in `.env`.

> The bundled schema uses permissive single-tenant RLS (personal use). For multi-user,
> add a `user_id` column and scope policies to `auth.uid()`.

## Deploy

All XLSX generation and data fetching run in Node.js API routes, so any Node host works.

### Railway (recommended if you already use Railway)
The app lives in the `webapp/` subfolder, so point the service at it:

1. **New → Deploy from GitHub repo** → pick `claude-trading-skills`.
2. Service **Settings → Root Directory = `webapp`** (required — otherwise the build can't find `package.json`).
3. Nixpacks auto-detects Next.js and uses [`webapp/railway.json`](railway.json)
   (`npm ci && npm run build` → `npm run start`). Railway injects `PORT`, which
   `next start` reads automatically — no extra config needed.
4. **Variables** tab → add (data source needs no key — Yahoo Finance by default):
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   ```
5. **Settings → Networking → Generate Domain** to get a public URL.

> 💡 Cost: a Next.js web service stays *always-on*, unlike a bot that idles.
> On the Hobby plan ($5 credit/mo) an always-on ~512 MB service can consume most
> of that credit on its own, so running it **alongside** a bot may tip you into
> paid usage. To cut cost, cap memory in service settings or scale to 0 when idle.

### Vercel
Import the repo, set **Root Directory = `webapp`**, add the env vars above, deploy.

## Architecture
```
app/
  page.tsx                 # dashboard shell (3 tabs)
  components/              # AnalyzeTab, PortfolioTab, ScannerTab, format helpers
  api/
    analyze/               # GET ?ticker → full AnalysisResult JSON
    workbook/              # GET ?ticker → .xlsx download (exceljs)
    scan/                  # GET ?tickers → momentum scan
    quote/                 # GET ?tickers → light quotes for portfolio
    portfolio/ watchlist/  # CRUD (Supabase or in-memory)
lib/
  yahoo.ts                 # Yahoo Finance (yahoo-finance2) adapter — default source
  marketData.ts            # provider dispatch (Yahoo default) + Alpha Vantage/Finnhub
  indicators.ts            # RSI, MACD, EMA/SMA, ATR, RS, volume ratios
  analysis.ts              # technicals, momentum score, DCF, signal
  analyze.ts               # buildAnalysis(): assembles the full research payload
  scan.ts                  # market regime + universe scan
  team/positionValuation.ts # fair-value anchors + add/trim/exit sizing per holding
  sectors.ts               # SIC -> GICS sector mapping + allocation weights
  workbook.ts              # 6-sheet exceljs builder (formulas + conditional formatting)
  supabase.ts / store.ts   # persistence + in-memory fallback
supabase/schema.sql        # tables, triggers, RLS
```

## Disclaimer
For research and educational use only. Not investment advice. Data may be delayed or
incomplete depending on provider limits. Always do your own research.
