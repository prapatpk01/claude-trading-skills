# Sentinel Active Momentum Research V23

## Investment mandate

Sentinel is an Active Momentum fund. The research process seeks fundamentally defensible companies whose price, relative strength and institutional participation are moving from accumulation into markup. The fund does not buy momentum alone and does not buy a valuation gap alone: a new allocation requires both an eligible Momentum Lifecycle stage and a defensible Fair Value.

The intended holding window begins at ACCUMULATION, EARLY_MARKUP or MOMENTUM_EXPANSION. The fund avoids chasing MATURE names and reviews a reduction when momentum weakens, the investment thesis changes, or the price approaches Fair Value.

## Search universe, rotation and investment horizon

The discovery process starts with the SEC EDGAR listed-registrant master universe and a liquid-US core. It is designed to cover the breadth represented by the S&P 1500, Nasdaq listings and Russell 3000 segments without claiming that the SEC list itself is an index-constituent file. Liquidity, market-history and research gates determine investability. Holdings, Watchlist names, cash reserves and recently sold names are excluded from Fresh Discovery.

Research is scheduled in four deterministic rotation windows so the same familiar leaders cannot monopolise the queue:

- 3-day fast rotation: liquid leaders, fresh relative strength, volume accumulation and early markup.
- 7-day cross-sectional rotation: broad factor ranking, sector leadership and replacement candidates.
- Monthly rotation: growth, quality, filings, estimates and valuation evidence.
- Quarterly rotation: long-tail and small/mid-cap coverage, including names not recently researched.

Each engine receives its own actual ticker list rather than relabelling one shared multifactor result. To preserve depth and stay inside the request budget, 28–42 scheduled names receive a full deep dive per cycle. The output has two governed layers: Investment Ready for names that clear every gate, and a visible Research Queue for newly sourced names that remain WATCH or RESEARCH INCOMPLETE. Existing Watchlist names are shown in a separate re-underwrite table.

The fund's normal planning window is 4–16 weeks. It may extend to 3–12 months when momentum, the thesis and Fair Value headroom remain intact; the Income Momentum sleeve may run 6–24 months. These are planning ranges, not expiry dates. Technical conditions are monitored daily, a full re-underwrite runs weekly, and earnings, guidance or material news trigger an immediate review.

The exit clock is evidence-driven: the fund trims or exits when momentum weakens, the thesis or investment direction changes, or the price approaches/reaches Fair Value. A position is not sold merely because a calendar window has elapsed, and a profitable winner may continue while the evidence remains constructive.

## Independent discovery engines

Each engine keeps its own search question and ranking evidence. An engine may nominate a stock; it does not bypass the common lifecycle, valuation, risk or human-approval gates.

| Engine | Search question | Primary evidence |
| --- | --- | --- |
| Momentum Lifecycle | Which liquid leaders are beginning to outperform without being mature? | Relative strength versus SPY, 1–3 month return, RSI/MACD context, EMA structure and volume |
| Institutional Accumulation | Where is persistent demand appearing before a mature breakout? | 5-day/20-day volume, up/down volume, relative strength and price compression |
| Growth Acceleration | Which businesses have accelerating growth and improving expectations? | Revenue/EPS/margin acceleration, estimate revisions and momentum confirmation |
| Quality Leadership | Which durable businesses are entering a favorable trend? | ROIC/ROE, margins, balance sheet, free-cash-flow quality and relative strength |
| Valuation Room-to-Run | Where does defensible Fair Value leave enough upside? | Filing-backed DCF, comparables or reliable consensus plus a momentum gate |
| Catalyst / AI Theme | Which AI and innovation beneficiaries have evidence beyond narrative? | Revenue exposure, product adoption, capex, earnings evidence and catalyst momentum |
| Income Momentum | Which income names combine durable distributions with improving trend? | Yield, payout coverage, free cash flow, balance-sheet durability and price trend |

## Common investment-ready pipeline

1. An independent engine nominates the security and retains its own evidence.
2. Data quality and liquidity checks must pass.
3. Momentum score must be at least 65.
4. Momentum Lifecycle must be ACCUMULATION, EARLY_MARKUP or MOMENTUM_EXPANSION.
5. Fair Value must come from a defensible fundamental source. A generic spot-price band is not Fair Value.
6. Valuation Gap must normally be at least 8% for a new allocation.
7. Portfolio fit, cash floor, concentration, risk and human approval remain mandatory.

If Fair Value or required fundamental evidence is missing, the stock is labelled RESEARCH INCOMPLETE. It remains visible with the missing evidence and next action, but it is excluded from ranking for capital allocation.

## Thomas valuation architecture

Thomas routes each holding through an explicit model class: operating company, bank/financial, REIT, ETF/look-through proxy or cash equivalent. The primary path combines filing-backed EPS/DCF, fundamental multiples, yield and price-history anchors where appropriate. When those anchors are insufficient, governed analyst consensus may be used as a secondary source subject to a 0.4x–2.5x spot sanity rail. Thomas never creates Fair Value from a generic band around the current price.

Every complete read records Bear, Base/Fair and Bull values, Valuation Gap, source, confidence, as-of date and expiry. The committee and portfolio underwriting reuse the same valuation ledger; the gap is recalculated against the current price. Missing evidence causes Thomas to abstain and keeps the security in research with zero allocation rather than repeating a false 83% coverage score.

## Momentum Lifecycle

| Stage | Portfolio interpretation |
| --- | --- |
| ACCUMULATION | Eligible for a starter position when institutional/volume evidence confirms |
| EARLY_MARKUP | Preferred entry/add zone when valuation headroom remains |
| MOMENTUM_EXPANSION | Hold or add selectively; use sizing discipline |
| MATURE | Do not chase a new position; protect existing gains |
| WEAKENING | Review trim; require renewed evidence before adding |
| BROKEN | Exit review unless the committee documents a contrary thesis |
| UNCONFIRMED | Watch or complete research; no allocation |

## Fair Value and sell discipline

Valuation Gap is calculated as `(Fair Value / current price - 1) × 100`. Fair Value is not manufactured when filings, DCF, comparables or reliable consensus anchors are unavailable.

- Valuation Gap above 8% with an eligible lifecycle may support initiation or addition.
- Valuation Gap of 5% or less creates TRIM REVIEW because upside is close to fully priced.
- Valuation Gap of 0% or less creates EXIT REVIEW because the base Fair Value is fully priced.
- A WEAKENING lifecycle creates TRIM REVIEW even before Fair Value is fully reached.
- A BROKEN lifecycle or rejected investment thesis creates EXIT REVIEW.
- Profit alone is not a sell signal while momentum, thesis and valuation headroom remain constructive.

All outputs are decision support. No order is executed without the existing committee, risk and human-approval controls.
