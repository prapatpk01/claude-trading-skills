# Sentinel Global Fund — Income Policy Amendment

**Effective:** 11 August 2026  
**Authority:** Fund Manager / CIO policy amendment  
**Scope:** Supersedes any earlier rule in `INVESTMENT_SYSTEM.md` that treats a 5% portfolio distribution yield as a hard objective or requires an income replacement to match/exceed the trimmed asset's headline yield.

## 1. Objective hierarchy

1. **Primary objective:** maximize sustainable total return while respecting the fund's risk, concentration, liquidity and governance rules.
2. **Income objective:** maintain useful portfolio cash generation without sacrificing expected total return, NAV growth or portfolio quality merely to increase headline yield.
3. When income yield and expected total return conflict, **expected total return has priority**.

## 2. Portfolio income bands

| Blended portfolio income yield | Policy status | Required response |
|---|---|---|
| `< 3.25%` | BELOW SOFT FLOOR | Income Team must propose a remediation path. No forced trade and no yield chasing. |
| `3.25%–<3.50%` | WATCH LOW | Monitor; a trade is not required if superior total-return opportunities exist. |
| `3.50%–4.00%` | OPTIMAL | Preferred operating band. Midpoint target is 3.75%. |
| `>4.00%–4.50%` | ACCEPTABLE HIGH | Acceptable only while growth, quality and expected total return are not impaired. |
| `>4.50%` | REVIEW HIGH | Review distribution source, sustainability, option/ROC effects and opportunity cost. Higher yield is not automatically better. |

**Preferred range:** 3.50%–4.00%  
**Preferred midpoint:** 3.75%  
**Soft floor:** 3.25%  
**High-distribution review threshold:** above 4.50%

## 3. No-yield-chasing rule

The fund must not buy, retain, replace or size an asset **solely** to manufacture the portfolio income target. Yield is one portfolio attribute, not a standalone reason to own a security.

A lower-yielding replacement is permitted when the committee has stronger evidence for expected total return, quality, growth, valuation, momentum or diversification and the portfolio remains inside an acceptable income posture.

## 4. Trim and replacement policy

The legacy wording `Income sleeve → replacement yield ≥ trimmed asset` is superseded.

For a required trim:

1. Research identifies a replacement or a temporary reserve destination before execution.
2. Replacement ranking is based primarily on expected total return and quality, with portfolio-level income impact shown explicitly.
3. If no risk asset clears the evidence gates, proceeds may remain as broker USD briefly or park in an approved reserve instrument such as SGOV under the cash-buffer policy.
4. The committee must not keep a weaker asset merely because its distribution yield is high.

## 5. GPIQ and other high-distribution assets

This amendment does **not** create an automatic EXIT, HOLD or position cap for GPIQ or any other covered-call/high-distribution fund. Each position remains subject to the normal committee process: expected total return, thesis quality, valuation, concentration, portfolio income contribution, risk and opportunity cost.

Selling GPIQ is therefore allowed even if it reduces blended portfolio income, provided the resulting portfolio is superior on the fund's total-return-first framework and the income posture is acceptable or has an explicit remediation plan.

## 6. Measurement

The dashboard and committee should report:

- current blended portfolio income yield,
- policy status from the bands above,
- preferred range 3.50%–4.00%,
- soft floor 3.25%,
- high-distribution review threshold 4.50%, and
- an explicit statement that total return has priority over distribution yield.

This amendment is implemented in the machine-readable constitution at `lib/team/constitution.ts` and must be used by portfolio review, committee reporting and tests.