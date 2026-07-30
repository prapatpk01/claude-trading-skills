# Sentinel Global Fund — Team Rules v4.0

**Momentum Growth + High Dividend Growth**

**Status:** implemented and live · supersedes v3.0
**Scope:** the two alpha engines, their scoring, the sizing ladder, sell
discipline and precedence. Every threshold below exists in code and is covered
by the test suite; where the written spec needed a decision, §22 says which and
why.

---

## 1. Investment mandate

Total Return + Growing Income, through two alpha engines.

**Engine A — Momentum Growth.** Assets with strong price trend *and* business
or earnings growth above **12%**.

**Engine B — High Dividend Growth.** Assets with a forward/TTM distribution
yield of **5% or more**, where the payout is durable and growing.

The governing principle — neither half is sufficient alone:

| Condition | Verdict |
|---|---|
| Growth without momentum | **WAIT** |
| Momentum without growth | **TACTICAL ONLY** — not a fund position |
| High yield without quality | **REJECT** |
| Growth + yield + momentum | **PRIORITY** (Hybrid Compounder) |

---

## 2. Portfolio architecture

| Sleeve | Target | Range |
|---|---|---|
| Momentum Growth | 55% | 30–65% |
| High Dividend Growth | 35% | 25–45% |
| Cash / Defensive | 10% | 5–40% |

Cash follows the regime; it is not held at 10% regardless of conditions.

| Regime | Growth | Dividend | Cash |
|---|---|---|---|
| Risk-On | 60% | 35% | 5% |
| Neutral | 50% | 35% | 15% |
| Risk-Off | 30% | 45% | 25% |
| Crisis | *no new positions* — raise cash per the risk engine (40% floor) |

> **Adjustment (§22.1).** The original bands were 45–65 / 25–45 / 5–25, which
> the Risk-Off row (Growth 30%) breached — no de-risked book could be in
> policy. The bands are widened to contain the tactical range the rules
> themselves prescribe. Strategic targets are unchanged. Crisis remains outside
> the bands by design and is reported as an intentional departure.

---

## 3. Engine A — Momentum Growth

### 3.1 Growth gate

At least one primary driver above **12%**:

- Forward revenue growth · Forward EPS growth
- Revenue growth · EPS growth
- 3Y revenue CAGR · 3Y EPS CAGR

| Growth | Class |
|---|---|
| ≥ 25% | Hyper Growth |
| 18–25% | Strong Growth |
| 12–18% | Qualified Growth |
| 8–12% | Watch |
| < 8% | Reject for the growth engine |

ETFs are assessed on underlying exposure, not on company metrics that do not
apply to a wrapper.

### 3.2 Momentum Growth Score — 100 points

| Block | Pts | Components |
|---|---|---|
| **Growth Quality** | 30 | Revenue/EPS growth 15 · Forward growth 8 · EPS revision 4 · Margin & FCF 3 |
| **Momentum & RS** | 30 | RS vs SPY 10 · 3M/6M momentum 6 · RSI 4 · MACD 4 · ADX 3 · Acceleration 3 |
| **Trend & Structure** | 20 | >200DMA 5 · 50>200 5 · >50DMA 3 · HH/HL 4 · Base 3 |
| **Volume** | 10 | Accumulation 4 · OBV 2 · Up/down 2 · Breakout volume 2 |
| **Catalyst** | 10 | Revisions, product cycle, industry, guidance, thematic |

| Score | Signal |
|---|---|
| 85–100 | ELITE BUY |
| 75–84 | STRONG BUY |
| 65–74 | BUY |
| 55–64 | WATCH |
| < 55 | REJECT |

**New positions require ≥ 65.**

### 3.3 Growth hard blocks

`GROWTH_LT_12` · `BELOW_200SMA` · `MAJOR_DOWNTREND` ·
`NEGATIVE_REVISION_SHOCK` · `STRUCTURE_BROKEN` · `ILLIQUID` · `EARNINGS_5D`

> **Entry failure ≠ thesis failure.** `STRUCTURE_BROKEN` blocks a *new entry*
> when price breaks down while growth is still above the gate. It escalates to
> an exit review only when the thesis breaks with it. A compounder in a
> drawdown is held, not sold.

---

## 4. Engine B — High Dividend Growth

### 4.1 Yield gate

**≥ 5%** for a new income position.

| Yield | Band |
|---|---|
| 5–8% | Core Income |
| 8–10% | High Income — quality review |
| > 10% | **Yield trap review required** |

A yield above 10% earns **no additional score**. The system must establish
*why* it is high:

1. the distribution grew — **earned**; or
2. the price collapsed — **not an opportunity**.

The check is explicit: a yield above the band with a price down more than 15%
and no distribution growth is reported as a trap, naming both figures.

### 4.2 High Dividend Growth Score — 100 points

| Block | Pts | Detail |
|---|---|---|
| **Yield** | 20 | ≥5% 12 · ≥6% 15 · ≥7% 18 · ≥8% 20 · >10% no extra |
| **Distribution growth** | 25 | ≥12% 25 · 8–12% 20 · 5–8% 15 · 0–5% 8 · <0% 0 |
| **Distribution quality** | 20 | Consistency 5 · Coverage 5 · FCF/earnings 5 · No recent cut 5 |
| **Fundamental growth** | 15 | ≥12% 15 · 8–12% 12 · 5–8% 8 · 0–5% 4 · negative 0 |
| **Momentum & trend** | 15 | RS 4 · >200DMA 4 · 50DMA 3 · MACD 2 · Structure 2 |
| **Valuation** | 5 | Undervalued 5 · Fair 3 · Overvalued 0 |

Signals as Engine A. Entry bar **65**.

### 4.3 Dividend hard blocks

| Code | Trigger |
|---|---|
| `YIELD_LT_5` | New position below 5%. **An existing holding whose yield fell because the price rose is not blocked.** |
| `DIVIDEND_CUT` | Distribution cut > 15% → broken review |
| `UNSUSTAINABLE_PAYOUT` | Coverage below 0.9× |
| `DISTRIBUTION_DECLINE` | TTM distribution growth < 0 → no add |
| `STRUCTURE_BROKEN` | 200DMA breakdown **with** deteriorating fundamentals → exit review |

### 4.4 Dividend growth preference

Yield **×** distribution growth beats yield alone.

| | Yield | Dist. growth | Preference |
|---|---|---|---|
| Asset A | 9% | −8% | lower |
| Asset B | 5.5% | +12% | **higher** |

The objective is not the highest yield. It is
**High Yield × Sustainable Growth × Total Return**.

---

## 5. Hybrid Compounder

Qualifies when *all six* hold:

Growth > 12% · Yield > 5% · Distribution growth > 5% · Engine score ≥ 65 ·
Price > 200DMA · No hard block

A Hybrid Compounder takes priority over a single-engine asset at comparable
valuation and risk, and may run into the high-conviction size band. Missing
conditions are named rather than the test simply failing.

---

## 6. Momentum entry layer

A qualifying score is not permission to buy at any price.

**Required:** price > 200DMA
**Plus at least two of:** 50DMA > 200DMA · positive 3M RS vs SPY · MACD >
signal · ADX > 20 · HH/HL structure · breakout on volume · reclaim of support

**Flagged and reported:** parabolic extension (>40% above the 200DMA), extended
(>25%), late-stage RSI (>78), distribution (OBV falling while price holds).

---

## 7. Valuation — a modifier, not a sell signal

**Momentum Growth**

| Valuation + momentum | Action |
|---|---|
| Cheap + strong | Aggressive add (×1.5) |
| Fair + strong | Add at plan (×1.0) |
| Expensive + strong | Hold, or small add (×0.4) |
| Extreme + **weakening** | Trim |

**High Dividend Growth**

| Condition | Action |
|---|---|
| High yield + undervalued + healthy distribution | Strong add (×1.25) |
| High yield + fair | Add at plan |
| High yield + overvalued | Hold |
| Yield compression + overvaluation + **weak momentum** | Trim |

> **"Weakening" requires two of three** independent reads to agree — MACD below
> signal, negative 3-month relative strength, price below the 50DMA. A single
> MACD cross happens repeatedly inside healthy uptrends; treating it as
> deterioration would sell winners on noise.

---

## 8. Position sizing

| Band | Rule |
|---|---|
| Normal maximum | **15% of NAV** |
| High conviction (ELITE / STRONG BUY / Hybrid) | **15–20%** |
| Hard maximum | **20%** — no purchase may create a position above it |

**Initial allocation:** ELITE 5% · STRONG BUY 4% · BUY 2–3%.

Capital is deployed through confirmation rather than opening the full intended
position at once. Every add is additionally capped so the incremental trade
risks no more than **1.5% of NAV** against its ATR stop.

### 8.1 Adding to winners

Permitted when the thesis is intact, growth remains >12% (Engine A) or the
distribution thesis holds (Engine B), momentum is positive, structure is intact
and no concentration limit is breached.

**A position need not become undervalued again before it can be added to.** A
successful breakout/retest or a controlled pullback in an intact trend
authorises an add at fair valuation.

---

## 9. Sell discipline

Selling follows **thesis, structure and risk** — not ordinary volatility.

**Growth exit review** — growth falls materially below 12%, and/or revisions
deteriorate, the thesis breaks, or the long-term trend reverses.
*A single weak quarter does not force liquidation.*

**Dividend exit review** — distribution cut >15%, coverage deteriorates
materially, the payout becomes structurally unsustainable, cash generation
deteriorates, or long-term structure breaks.
*Yield falling because the price rose is not a sell signal.*

An **EXIT REVIEW is a decision to take, not an order to send.** Execution is on
the stop or into strength, never at the open on a gap.

---

## 10. Regime engine

| Regime | Priority | Deployment |
|---|---|---|
| **Risk-On** | Momentum Growth · Hybrids · dividend names with positive momentum | Full |
| **Neutral** | Quality growth · Hybrids · dividend growth | Three-quarters; avoid weak momentum |
| **Risk-Off** | Dividend quality · defensive dividend growth · cash | Income only, half size; growth requires an exceptional score |
| **Crisis** | Capital preservation | Frozen |

---

## 10b. News flow — the third read (Nina Okonkwo)

The fund reads the market three ways, and never averages them:

| Read | Measures | Source | Sets |
|---|---|---|---|
| **Regime** | where the market **is** | price — trend, volatility, drawdown | the base sleeve allocation |
| **Sentiment** | how **crowded** that is | Fear & Greed | a tilt on the allocation |
| **News** | what is being **said** | public economic feeds | the **pace** of execution |

The information lives in the disagreements, so the desk names them:

| Divergence | Condition | Meaning |
|---|---|---|
| **Late-cycle** | news ≤ −10, tape Risk-On **or** F&G > 55 | deteriorating fundamentals under a rising market — stop adding into strength |
| **Early recovery** | news ≥ +10, tape Risk-Off **or** F&G < 35 | narrative turned before the tape — stage entries, require price confirmation |
| **Priced in** | news ≤ −10 **and** F&G < 35 | the story is in the price; follow the sentiment tilt, not the headlines |
| **Crowded confirm** | news ≥ +10 **and** F&G > 55 | everyone reads the same thing; keep new size small |
| **Aligned** | none of the above | the news desk issues no instruction |
| **Insufficient** | fewer than 6 classified headlines | the read is withheld rather than manufactured |

### What news is allowed to do

> **News changes the pace and the sequence of a decision already taken. It never
> changes a sleeve target, a position cap, or a score.**

That boundary is the honest limit of the input. A keyword read of press
headlines is the noisiest measurement the fund makes; letting it move real
allocation would import that noise into the book. Slowing an add by a week costs
little when the read is wrong and saves a great deal when it is right.

The gate has two settings only: `adds ∈ {proceed, stage, hold}` and
`trims ∈ {normal, accelerate}`.

### Method

- **Themes** — nine: monetary policy, inflation, labour, growth, credit &
  liquidity, trade & geopolitics, energy, earnings & guidance, AI & tech capex.
- **Two passes** — pass one decides what a headline is *about*, pass two which
  way it *leans*. Direction is read per theme, because inflation "cooling" is
  good news and growth "cooling" is not. Labour cues are anchored to their
  subject: "payrolls rose" and "unemployment rose" are opposite news.
- **Weighting** — recency ×1.0 / ×0.5 / ×0.25 at 48 hours / 1 week / older;
  official sources (Fed, BLS, BEA, Treasury) ×1.6 against press ×1.0.
- **Escalation** — the last 48 hours against the trailing week. A shift of 25
  points or more is flagged, because the actionable moment is when a quiet theme
  starts moving, not when a bad theme stays bad.
- **Coverage (Rule #5)** — a headline matching no theme is *unclassified* and is
  reported, never scored as neutral. Every classification lists the phrases that
  produced it so a wrong read can be seen and the lexicon corrected.
- **Dates** — projected from each agency's published release convention and
  marked **[E]**. The FOMC is given at month resolution with no day count: the
  committee sets the date and the app has no verifiable source for it.

---

## 10c. Who does what — the standing duty and the two research seats

**Standing duty, before any desk's own remit:** every member jointly manages the
holdings portfolio. Every seat may table a view at the portfolio review, and
every seat may file a risk to the register **with the measurement behind it**. A
fund where only the CRO is allowed to see risk has one pair of eyes on it.

The portfolio review therefore returns a **round table** — all fourteen seats,
including the ones with nothing to add, because what the fund cannot currently
see is itself worth knowing — and a **risk register** sorted by severity, each
item naming who filed it, the evidence, and the proposed action.

### The two research seats, split by the question they answer

| Seat | Question | Owns |
|---|---|---|
| **Maya Chen** — Momentum Analyst | *What is moving?* | Momentum Scoring v3.0, the hard blocks, Engine A's entry layer |
| **Aisha Fontaine** — Catalyst & Thematic Analyst | *Is there a reason?* | Theme, thesis, catalyst score, measured PEAD, the event calendar |

### The scanner runs as three owned stages

1. **Maya — momentum screen.** Whole universe, price and filings only. v3.0 with
   its hard blocks, plus the 12% growth gate and entry layer.
2. **Aisha — theme, thesis & catalyst.** Shortlist only (top 12 by momentum),
   because this stage costs a full data pull per name. Engine A is **re-scored**
   here with the catalyst line filled, which the cheap screen cannot do.
3. **Priya Nair + Kai Tanaka — entry, stop & target, jointly.** Priya's SAMP
   pressure read can veto the timing; Kai's ATR stop sets the geometry and can
   veto on reward:risk. **Both must sign; neither can overrule the other into a
   trade.**

Ranking is by **joint conviction** — momentum 70%, catalyst 30% scaled by its own
coverage — not by momentum alone. That is the point of putting a second research
desk in the path.

### The catalyst model (0–25, Aisha's scale)

| Component | Pts | Source |
|---|---|---|
| Surprise magnitude | 7 | Reported vs consensus, latest quarter |
| Surprise consistency | 5 | Beats in the last four quarters |
| **Post-earnings drift — measured** | 7 | Realised return since the report **less the benchmark over the same sessions** |
| Growth acceleration | 3 | Revenue YoY quarter on quarter — **[E] a proxy for estimate revisions**, which have no free source |
| Next scheduled catalyst | 3 | Projected reporting date; **0 inside the 2-day blackout** |

- Scored over what could be **evaluated**, with coverage reported (Rule #5).
- A **miss**, or drift running ≥5% against the index after a report, marks the
  catalyst **negative** — v3.0 deducts 3 points for it.
- The 0–25 scale converts to Engine A's 0–10 catalyst line in one place, so the
  two cannot drift apart.
- The desk's score deliberately **does not inflate** v3.0's /100 total; the
  thresholds are stated on that scale. It is reported alongside, and only the two
  documented adjustments move the number.

### Two dormant rules now connected

- Engine A's catalyst line had **never** been supplied, so 10 of its 100 points
  were structurally unreachable and every score read "Catalyst 0/10, not
  evaluated".
- v3.0's **5-day earnings blackout** (`EARNINGS_5D`, a documented REJECT) had
  never fired, because no caller supplied the day count. The catalyst desk
  projects the date; the memo now passes it.

---

## 11. Precedence

Applied top-down; the first level that fires decides, and every recommendation
reports which level decided it.

1. **Risk hard limit**
2. **Broken fundamental thesis**
3. **Dividend sustainability**
4. **Market regime**
5. **Structural trend**
6. **Growth / income qualification**
7. **Valuation**
8. **Engine score**
9. **Catalyst**
10. **Default = HOLD**

- A high engine score cannot override a broken business.
- A 10% yield cannot override an unsustainable distribution.
- A cheap valuation cannot override a structural decline.

---

## 12. Pre-trade gates

| # | Gate | Owner |
|---|---|---|
| 1 | Data verified and current | Nina Okonkwo |
| 2 | Regime permits deployment | Daniel Cho |
| 3 | Correct engine identified | James Hartwell |
| 4 | Growth > 12% **or** yield ≥ 5% | Sofia Reyes / Lena Müller |
| 5 | Engine score ≥ 65 | Maya Chen |
| 6 | No hard block | Miriam Osei |
| 7 | Trend / structure confirmation | Maya Chen |
| 8 | Valuation **reviewed** | Thomas Eriksson |
| 9 | Position and risk limits | Kai Tanaka |
| 10 | Event / catalyst risk reviewed | Aisha Fontaine |
| 11 | **CIO approval — always manual** | James Hartwell |

Gate 8 is a review, not a veto: §7 makes valuation size a trade, not block one.
A Hybrid Compounder must pass both engines' qualification independently.

---

## 13. Portfolio objectives

Three outcomes, simultaneously:

| Objective | Target |
|---|---|
| Capital growth | > 12% annualised total return |
| Income | ≥ 5% forward portfolio yield |
| Income growth | positive annual distribution growth, preferably > 5% |

The system optimises **Total Return + Income + Income Growth**, not any one of
them independently.

---

## 14. Scoring honesty — coverage normalisation

Several v4 inputs do not exist in any free, keyless data source: **forward
estimates, analyst revisions, fund distribution coverage.** Rule #5 forbids
guessing them.

Scoring them zero would be equally wrong — it would push every name below the
65 entry bar *for want of data rather than want of quality*. So each engine
reports three numbers:

- **points earned**
- **points that could be evaluated**
- **coverage-normalised score** = earned ÷ evaluable × 100

The signal is taken from the normalised score, and **coverage is published
beside it** (for example "79/100, 75% of the model evaluable"). Unavailable
components are named, not hidden.

---

## 15. Core principle

The fund does not buy growth at any price, momentum without fundamentals, high
yield without sustainability, or cheap assets in structural decline.

It looks for:

> **Growth > 12% + strong momentum + healthy structure**
>
> or
>
> **Yield > 5% + sustainable distribution + distribution growth + positive momentum**

with the highest priority on **Growth + Income + Momentum + Quality**.

The objective is to own assets whose **fundamentals, price trend and cash
distributions are compounding in the same direction.**

---

## 22. Decisions taken where the spec was silent or in conflict

Recorded so nothing was changed quietly.

**22.1 Allocation bands (§2).** The written ranges (Growth 45–65%) excluded the
written Risk-Off allocation (30%). Bands widened to 30–65% and cash to 5–40% so
the tactical range fits inside them; strategic targets untouched. Crisis stays
outside by design and is reported as intentional.

**22.2 "Weakening momentum" (§7).** Undefined in the spec. Implemented as two of
three: MACD below signal, negative 3M relative strength, price below the 50DMA.
One signal alone is noise.

**22.3 "High conviction" (§8).** Undefined. Implemented as ELITE BUY, STRONG BUY
or Hybrid Compounder — these open the 15–20% band; everything else caps at 15%.

**22.4 `STRUCTURE_BROKEN` severity (§3.3 vs §5).** The spec lists it as a hard
block but also says momentum deterioration must not force an exit while growth
is intact. Implemented as: blocks entry always, escalates to exit review only
when growth is also below the gate.

**22.5 Crisis allocation (§2).** The spec gives no numbers, only "stop opening
positions and raise cash per the risk engine". Implemented as 25/35/40 with the
40% cash floor from the regime engine, flagged as outside the strategic bands.

**22.6 Catalyst scoring (§3.2, 10 pts).** Earnings revisions, product cycle and
guidance are not in the free feed. The component is marked unavailable and
excluded from the normalised score rather than assumed.

---

## Known limits

- **Forward estimates and analyst revisions are unavailable.** Engine A's
  Growth Quality block runs at reduced coverage; the percentage is always shown.
- **Fund distribution coverage is unavailable** for most wrappers — Engine B's
  Coverage component is excluded, not assumed.
- **Tier-1 macro dates** (FOMC, CPI, NFP) are not in the free feed. §10b
  projects them from each agency's release convention and marks them [E]; FOMC
  is month-resolution only. Gate 10 stays manual for any date a decision
  actually depends on.
- **The news read is a lexicon, not a language model.** It measures what the
  press is discussing and how the wording leans. It cannot judge whether a story
  is true, whether it is already priced, or what subtle prose means, and it will
  misread sarcasm, negation at distance, and single-name news dressed as macro.
  Coverage is reported every run so the size of the blind spot is visible.
- **ETFs are not looked through** to their underlying sector exposure.
- **Cost basis is user-supplied and unaudited** until reconciled to a broker
  statement.

---

*For research and education only. Not investment advice.*
