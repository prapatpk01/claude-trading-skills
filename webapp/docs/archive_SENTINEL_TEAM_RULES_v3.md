# Sentinel Global Fund — Team Rules v3.0

**Status:** draft for review · supersedes Governance Rules v2.0
**Scope:** the rules each desk owns, the models they may use, and the order in
which their conclusions bind. Written to match what the application actually
computes — every threshold here exists in code.

---

## 0. Why v3 exists

v2 let two desks reach opposite conclusions about the same position and gave no
rule for which one won. The book review printed this:

> **SCHD** — Momentum 78/100, STRONG BUY · **TRIM** to a 5.9% conviction target
> **BALI** — Momentum 17/100, REJECT (3 hard blocks) · **TRIM** to 2.1%
> **SGOV** — STRETCHED, +20.6% above fair value $83.46 · **TRIM** to 6.6%

All three are wrong, for three different reasons:

| Symptom | Root cause | v3 rule |
|---|---|---|
| Every position reads TRIM | Sleeve budgets split by conviction produced 2–6% "targets" that no rule required | §5 — sizing starts from the position held; the cap is the rule, not a modelled target |
| An income ETF scores 17/100 REJECT | Momentum Scoring v3.0 applied to a covered-call fund measures only that it does not trend | §4 — conviction is graded on the model that fits the sleeve |
| A T-bill fund reads +20.6% overvalued | The yield anchor capitalised a floating distribution at a historical median yield | §6 — constant-NAV instruments get no verdict |

The structural fix is §9: **an explicit precedence order**, so two desks can
disagree without the output becoming incoherent.

---

## 1. Mandate

| Item | Value |
|---|---|
| Benchmark | SPY total return × 1.3 per year |
| Income objective | ≥ 5% blended forward yield |
| Strategy | Barbell — Growth/Momentum · Income/Dividend · Cash/Defensive |
| Sleeve targets | 55 / 30 / 13 |
| Single-name cap | 20% of NAV (Rule #3) |
| Watch band | 20–23%, conditional — see §5 |
| Per-trade risk | ≤ 1.5% of NAV (Rule #4) |
| Total open risk | ≤ 8% of NAV |

Both objectives are live simultaneously. Neither excuses failing the other:
a book that beats SPY on 2% yield has missed, and so has a 7%-yield book that
trails the benchmark.

---

## 2. The desks

Each desk gets a **mandate** (what it decides), **inputs** (what it may use),
and **boundaries** (what it may not decide). The boundaries are new in v3 and
are what prevent contradictory output.

### 2.1 Executive

**James Hartwell — CIO**
- Mandate: final verdict; deployment authorisation.
- Inputs: every desk's output, the gate result, the precedence order in §9.
- Rules:
  - **Gate 9 is never automated.** The system prepares a decision; it does not approve one.
  - May override any desk, but must record which rule the override suspends.
  - May not authorise a deployment that fails a hard block without invoking Rule #1 explicitly.
- Boundary: does not compute scores; consumes them.

**Miriam Osei — CRO**
- Mandate: gate compliance, data integrity, bias detection.
- Rules:
  - Every scored input carries a flag: **[V]** verified from a primary source, **[E]** estimated from a related figure, **[U]** unavailable.
  - **[U] scores zero. It is never estimated into a number** (Rule #5).
  - Gate 7 fails below 70% verified inputs.
  - Win rates are labelled by their basis: *Verified* (closed trades), *Component Estimate* (modelled), or *Unverified*. An unlabelled win rate may not be published.
- Boundary: may block, may not size or select.

**Nina Okonkwo — Data & Source Engineer** · **Leo Tanaka — Real-time Data**
- Mandate: source lineage, feed quality, timestamps.
- Rules:
  - Every data point records its source and retrieval time.
  - Feed grades: **A** live/same-session · **B** ≤ 24h · **C** older or derived.
  - A grade-C input may not clear Gate 1.
  - Where two sources conflict, the higher grade wins; if grades tie, the figure is flagged [E] and the conflict is reported, not silently resolved.

### 2.2 Research

**Sofia Reyes — Sr. Fundamental Analyst**
- Mandate: business quality, moat, thesis.
- Rules:
  - Moat is scored **wide / narrow / none** with the evidence named. An unevidenced moat is *none*.
  - A thesis must state what would falsify it. A thesis with no falsifier is not a thesis.
  - Thesis review is mandatory on: a distribution cut, a 200-day SMA break, or two consecutive earnings misses.
- Boundary: does not set price targets — that is Valuation.

**Marcus Webb — Sr. Financial Analyst**
- Mandate: earnings trend, margins, revision momentum.
- Rules:
  - Ratios are computed from the **latest full fiscal year**. A trailing-twelve-month figure is used only when it agrees with the fiscal year within 60% — stitched quarterly data with gaps produced a 3.7% ROE for a 28.4% business.
  - Fiscal-year data must come from a 10-K; quarterly spans are validated at 80–100 days and a TTM at 250–290 contiguous days.
  - Beat/miss is tracked over eight quarters; a pattern is three or more in the same direction.

**Aisha Fontaine — Momentum & Catalyst Analyst**
- Mandate: catalyst scoring, post-earnings drift, event calendar.
- Rules:
  - Catalysts score 0–25 on strength × horizon × uniqueness.
  - **No new entry inside a 5-day earnings blackout** (hard block `EARNINGS_5D`).
  - Tier-1 macro events (FOMC, CPI, NFP) cap deployment at one-third (Rule #2). These dates are not in the free feed — Gate 8 stays manual and says so.
- Boundary: a catalyst may raise a score; it may **never** clear a hard block.

**Maya Chen — Momentum & Catalyst Analyst**
- Mandate: Momentum Scoring v3.0 and swing setups — **for the Growth/Momentum sleeve only**.
- Rules: §3 and §4.1.
- Boundary (new in v3): **may not score income or cash instruments.** Applying a trend model to a covered-call fund or a T-bill fund produces a number that describes the model, not the position.

### 2.3 Quant

**Priya Nair — Quantitative Strategist**
- Mandate: win-rate tracking, factor attribution, the SAMP structural read.
- Rules:
  - SAMP (Sentinel Adaptive Structure v1.6) runs as an **independent second opinion**. Where SAMP and v3.0 disagree, the disagreement is reported — it is not averaged away.
  - A negative SAMP direction blocks a scanner setup regardless of score.
  - Win rates are recomputed on closed trades only and carry Miriam's label.

**Thomas Eriksson — Head of Valuation**
- Mandate: fair value, margin of safety.
- Rules: §6. In summary:
  - Fair value is a **blend of independent anchors**, never one model.
  - The DCF is one anchor among several, weighted below the earnings and yield anchors, and halved again when the terminal value exceeds 80% of enterprise value.
  - Terminal growth is bounded at `min(2.5%, WACC − 4%)`.
  - Any anchor implying a fair value outside 0.4–2.5× the market price is discarded, as is one sitting more than 2.2× from where the others agree.
  - **Constant-NAV instruments receive no verdict.**

### 2.4 Macro

**Daniel Cho — Head of Macro Strategy**
- Mandate: regime score, cash floor, thematic rotation.
- Rules: §7.
  - The regime score is 0–100 from measurable inputs only. Rates and credit cannot be verified from price data and are scored **neutral, not guessed** (Rule #5).
  - Thematic leadership is **measured, not asserted**: proxy ETFs ranked on relative strength against SPY plus their own trend health.
  - The regime decides which risk profiles may receive new capital. It does not pick names.
- Boundary: may forbid a purchase; may not compel one.

### 2.5 Risk

**Kai Tanaka — Portfolio Risk Analyst**
- Mandate: position sizing, stops, concentration.
- Rules: §5, plus:
  - Every position carries an ATR stop at 2× ATR(14) (Rule #4).
  - Quarter-Kelly sizing, floored at 3% and capped at 20% of NAV.
  - An add is capped so the incremental trade risks ≤ 1.5% of NAV against its stop.
- Boundary: **Risk's cap is absolute.** No valuation or conviction argument raises it beyond the watch band in §5.

### 2.6 Portfolio

**Lena Müller — Portfolio Manager**
- Mandate: sleeve balance, dual objectives, blended yield.
- Rules:
  - Sleeve drift beyond ±5 points raises a Rule #7 alert.
  - Sleeve drift is a **book-level** finding. It is reported as a rebalancing action; it does **not** generate per-name trim instructions. (This is precisely what v2 got wrong.)
  - A holding's sleeve is inferred from yield and beta; the classification is published so it can be overridden.

### 2.7 Execution

**Ryan Blackwood — Execution Trader**
- Mandate: entry mechanics, slippage.
- Rules:
  - Exits execute on the stop or into strength — **never at the open on a gap**.
  - Entries stagger per the regime's deploy rule (§7).
  - Trades below the greater of 0.75% of NAV or $200 are not worth the spread and are suppressed.

---

## 3. Momentum Scoring v3.0 — Growth sleeve only

100 points across six phases:

| Phase | Weight | Measures |
|---|---|---|
| 3A Momentum & RS | 35 | RSI, MACD, ADX, relative strength vs SPY |
| 3B Volume accumulation | 25 | OBV, MFI, up/down volume, dollar volume |
| 3C Structure & trend | 15 | 20/50/200 MA stack, base pattern |
| 3D High-beta expansion | 10 | Beta, ATR expansion |
| 3E Sector strength | 8 | Group leadership |
| 3F Catalyst drift | 7 | Aisha's catalyst score |

**Hard blocks** — any one is disqualifying for a *new entry*:

`RSI_WEAK` · `ADX_LOW` · `OBV_DISTRIBUTION` · `BELOW_200SMA` · `ILLIQUID` · `EARNINGS_5D`

**Signal:** ≥75 STRONG BUY · 58–74 BUY · 42–57 WATCH · <42 REJECT.
Two or more blocks is an automatic REJECT. **Rule #1:** exactly one block with
a score above 80 downgrades to SOFT-BLOCK WATCH rather than REJECT.

---

## 4. Conviction — graded per sleeve

> **v3 change.** One model no longer grades every instrument.

### 4.1 Growth/Momentum → Momentum Scoring v3.0

| Signal | Grade |
|---|---|
| STRONG BUY | STRONG |
| BUY | ADEQUATE |
| WATCH / REJECT | WEAK |
| `BELOW_200SMA` present | **BROKEN** |

### 4.2 Income/Dividend → Distribution Quality

Scored 0–100 from three terms:

- **Yield against the 5% objective** — ≥7% +20 · ≥5% +15 · ≥3% +6 · below that, nothing.
- **Distribution growth (TTM vs prior TTM)** — ≥5% +20 · flat to +5% +12 · −10% to 0 −5 · worse than −10% **−25 and a BROKEN block**.
- **Consistency** — payments below the prior payment, as a share of payments: ≤10% +15 · ≤30% +5 · above that −10.

**Grade caps.** Stability alone must not carry a thin payer:
- yield < 3% → grade capped at **WEAK**, however steady;
- yield < 5% → grade capped at **ADEQUATE**.

A 22% distribution cut is BROKEN regardless of score.

### 4.3 Cash/Defensive → not graded

Held for liquidity against the regime cash floor, not for return. No conviction
score applies, and no valuation trim may be issued against it.

---

## 5. Sizing — the cap is the rule

> **v3 change.** There is no modelled "ideal weight". Sizing starts from the
> position held and moves only when a rule says to.

| Weight | Action |
|---|---|
| **> 23%** | Mandatory trim to 20%. **No valuation or conviction argument overrides this.** |
| **20–23%** | Permitted as **WATCH** — but only while *both* hold: price is at or below fair value, **and** the name is running with a leading theme (§7). The overweight carries a published **trim trigger**, so the gain is capped rather than left open. If either condition fails, trim to 20%. |
| **≤ 20%** | **Hold by default.** |

Inside the cap:

- **ADD** requires *all* of: a cheap price (UNDERVALUED or DEEP VALUE), sleeve-appropriate conviction of ADEQUATE or better, no hard block, and a regime that permits deployment into that risk profile.
  Step size: 5% of NAV at STRONG, 3% at ADEQUATE, ×1.5 at DEEP VALUE, ×0.75 in a Neutral regime, then capped by the room to 20% and by the 1.5%-of-NAV trade risk limit.
- **TRIM** requires a rich price *and* a position ≥ 5% of NAV. Below 5%, a valuation trim is noise rather than risk control, and the desk says so instead of issuing it.
  Size: one third at STRETCHED, one fifth at OVERVALUED.
- **EXIT** fires when conviction is **BROKEN** and there is no *fundamental* valuation support beneath it. A trend regression calling the far side of a fall "cheap" does not count as support — that is the regression describing the decline.

**Every trim and every exit must name its cause: the cap, or the valuation, or
a broken thesis.** A trim with no stated cause is a defect.

---

## 6. Fair value — the anchor stack

Fair value is a weighted blend of the anchors each instrument's data supports.

| Anchor | Weight | Applies to | Method |
|---|---|---|---|
| Earnings multiple | 2–3 | Operating companies with an SEC EPS history | Median P/E the market actually paid, on forward EPS |
| Dividend yield | 2–3 | BDCs, REITs, income ETFs | TTM distribution capitalised at the median yield the market demanded |
| Discounted cash flow | 0.75–1.5 | Companies with usable statements | 5-year FCF; halved when terminal value > 80% of EV |
| Trend regression | 1–1.5 | Anything with a year of prices | Log-linear fit, weighted by R² |

**Rejection rules — an anchor is discarded when:**
- the median multiple exceeds 60× (a denominator that broke, not a multiple anyone paid);
- it implies a fair value outside **0.4–2.5×** the market price;
- a regression's R² is below 0.3 (no trend to be above or below);
- with three or more anchors, it sits more than **2.2×** from where the others agree.

**Verdict bands**, on deviation from blended fair value:

| Deviation | Verdict |
|---|---|
| ≤ −2.5 × band | DEEP VALUE |
| −2.5 to −1 × band | UNDERVALUED |
| within ±1 band | FAIR |
| +1 to +2.5 × band | OVERVALUED |
| ≥ +2.5 × band | STRETCHED |

The band is ±8% at base and **widens with anchor dispersion**, to ±16% when the
anchors disagree by 100% of fair value. A name whose valuation is genuinely
uncertain is not labelled overvalued on a coin-flip.

**Constant-NAV instruments** — price range < 8% and realized volatility < 4%
over a year — are labelled **CASH EQUIVALENT**. Fair value is the price, and
the desk states why rather than inventing a number.

**With no usable anchor, no verdict is issued.** Silence is a valid output.

---

## 7. Regime and thematic rotation

### 7.1 Regime score (0–100)

Volatility 30 · index trend/breadth 25 · tape momentum 20 · drawdown 15 ·
rates & credit 10 (**scored neutral — not verifiable from price data**).

| Score | Regime | Cash floor | Deploy rule |
|---|---|---|---|
| ≥ 70 | 🟢 Risk-On | 10% | Full deployment permitted |
| 40–69 | 🟡 Neutral | 15% | Up to 75% of plan |
| 20–39 | 🔴 Risk-Off | 25% | One-third of plan only |
| < 20 | ⚫ Crisis | 40% | Freeze — no new deployment |

### 7.2 Leadership, measured

Sector and theme proxies (XLK, XLC, XLY, XLI, XLF, XLE, XLB, XLV, XLP, XLU,
XLRE, SMH, IGV, BOTZ, ITA, XBI, KRE, XHB, GLD, TLT) are ranked on excess return
vs SPY over 1M (×0.9), 3M (×1.4) and 6M (×0.7), adjusted for trend health
(+6 above the 50-day, +8 above the 200-day, −10 below it).

A group **leads** when leadership ≥ 58, its trend is intact, and 3-month
relative strength is positive. *Outperforming on the way down is not
leadership.*

### 7.3 What the regime permits

| Regime | Posture | New capital may enter |
|---|---|---|
| Risk-On | Aggressive — lean into leadership | high-beta, cyclical, defensive |
| Neutral | Selective — leaders only | cyclical, defensive |
| Risk-Off | Defensive — protect the book | defensive only |
| Crisis | Capital preservation | nothing |

The scanner builds its universe from the intersection: groups that are both
leading **and** permitted, expanded round-robin to their liquid constituents so
one hot theme cannot monopolise the list. **When the intersection is empty, the
scan returns nothing and says why. Waiting is the position.**

---

## 8. Governance rules

| # | Rule |
|---|---|
| 1 | One hard block with a score > 80 downgrades to WATCH, not REJECT |
| 2 | Tier-1 macro events cap deployment at one-third |
| 3 | No single name above 20% of NAV; 20–23% only under the §5 watch band; > 23% is a mandatory trim |
| 4 | Every position carries a 2× ATR stop; per-trade risk ≤ 1.5% of NAV |
| 5 | Unverifiable inputs score zero and are flagged [U] — never estimated into a number |
| 6 | Win rates carry their basis label (Verified / Component Estimate / Unverified) |
| 7 | Sleeve drift beyond ±5 points raises a book-level rebalancing alert — **not** per-name trims |

---

## 9. Precedence — who wins when desks disagree

> **The core v3 addition.** Applied top-down; the first rule that fires decides.

1. **Risk cap (Kai).** Above 23% of NAV, trim. Nothing overrides it.
2. **Broken structure (Maya / Sofia).** Conviction BROKEN with no fundamental valuation support → exit.
3. **Regime veto (Daniel).** The regime may forbid new capital. It never compels a purchase.
4. **Valuation (Thomas).** A rich price blocks an add and, above 5% of NAV, calls a partial trim. A cheap price permits — but does not require — an add.
5. **Conviction (Maya / Lena).** Sets the *size* of a permitted add. It cannot create permission that 1–4 withheld.
6. **Theme (Daniel).** Unlocks the 20–23% watch band and prioritises among permitted adds. It is a tiebreaker, never a licence.
7. **Default.** Hold.

**Consequences of this ordering, stated explicitly:**

- A STRONG BUY at a rich price **may** take a partial trim. That is coherent: strong asset, poor entry.
- A STRONG BUY is **never** trimmed for being above a modelled target weight, because no such target exists.
- A BROKEN income position (distribution cut) exits on the same rule as a broken growth position (200-SMA break) — the sleeves differ, the precedence does not.
- Sleeve drift never reaches a per-name instruction. It is Lena's book-level action list.

---

## 10. The nine pre-trade gates

| # | Gate | Owner |
|---|---|---|
| 1 | Regime timestamp verified (≤ 24h) | Daniel Cho |
| 2 | Regime score ≥ 40 | Daniel Cho |
| 3 | Momentum score ≥ 58 | Maya Chen |
| 4 | Soft-block check (Rule #1) | Maya Chen |
| 5 | Position ≤ 20% of NAV (Rule #3) | Kai Tanaka |
| 6 | ATR stop defined (Rule #4) | Kai Tanaka |
| 7 | Data quality ≥ 70% with V/E/U flags | Miriam Osei |
| 8 | Stagger near Tier-1 events (Rule #2) | Aisha Fontaine |
| 9 | **CIO sign-off — always manual** | James Hartwell |

Gates 3 and 4 apply to the Growth sleeve. For an income position, gate 3 reads
the distribution-quality grade instead, and passes at ADEQUATE or better.

---

## 11. Known limits

Stated so no reader mistakes silence for coverage.

- **Tier-1 macro dates** (FOMC, CPI, NFP) are not in the free data feed. Gate 8 stays manual.
- **Funds are not looked through.** An ETF's sector is the wrapper's, so a book heavy in ETFs shows less sector detail than it truly has.
- **Cost basis is user-supplied and unaudited [E]** until reconciled against a broker statement.
- **Theme leadership is proxy-based.** A leading proxy does not mean every name inside the group is leading.
- **Return figures** are computed from current share counts valued back through time, not from a transaction ledger.

---

*For research and education only. Not investment advice.*
