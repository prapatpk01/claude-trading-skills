export type ForecastOwner = "INV_RESEARCH" | "AM_HOLDING" | "WATCHLIST";
export type ForecastAction = "BUY CANDIDATE" | "ADD" | "HOLD" | "TRIM" | "SELL REVIEW" | "PROMOTE TO INV" | "WATCH" | "AVOID" | "RESERVE";

const RESERVES = new Set(["SGOV", "BIL", "SHV", "USFR", "TFLO", "ICSH", "JPST", "JAAA"]);
const favorable = new Set(["BULLISH", "SELECTIVE_BULLISH"]);
const risky = new Set(["DEFENSIVE", "BEARISH"]);
const entryStages = new Set(["ACCUMULATION", "EARLY_MARKUP", "MOMENTUM_EXPANSION"]);

export type ForecastActionInput = {
  ticker: string;
  owner: ForecastOwner;
  forecast: any;
  research?: any;
};

export type ForecastActionRead = {
  action: ForecastAction;
  priority: number;
  owner: ForecastOwner;
  reason: string;
  requiresApproval: true;
};

export function forecastActionPolicy(input: ForecastActionInput): ForecastActionRead {
  const ticker = String(input.ticker ?? "").toUpperCase();
  const forecast = input.forecast ?? {};
  const confidence = Number(forecast.confidence ?? 0);
  const expected = Number(forecast.expectedReturnPct ?? 0);
  const outlook = String(forecast.outlook ?? "NEUTRAL");
  const stage = String(forecast.lifecycleStage ?? "UNCONFIRMED");

  if (RESERVES.has(ticker)) {
    return { action: "RESERVE", priority: 0, owner: input.owner, reason: "Cash-buffer / liquidity reserve. Momentum Forecast must not override the reserve policy.", requiresApproval: true };
  }

  if (input.owner === "INV_RESEARCH") {
    const researchReady = input.research?.passed !== false
      && (input.research?.valuationReady === true || Number(input.research?.expectedReturnPct ?? 0) >= 8);
    if (researchReady && favorable.has(outlook) && confidence >= 60 && entryStages.has(stage) && expected > 0) {
      return { action: "BUY CANDIDATE", priority: 90 + Math.min(9, Math.round(Math.max(0, expected))), owner: input.owner, reason: "INV research passed its shortlist/valuation gate and the momentum path remains favorable. Send to CIO for sizing and funding approval.", requiresApproval: true };
    }
    if (risky.has(outlook) || ["WEAKENING", "BROKEN"].includes(stage)) {
      return { action: "AVOID", priority: 20, owner: input.owner, reason: "Forecast risk conflicts with a new-capital decision. Keep out of the buy queue until the trend/lifecycle repairs.", requiresApproval: true };
    }
    return { action: "WATCH", priority: 50, owner: input.owner, reason: "Research idea is not yet aligned strongly enough with forecast confidence and lifecycle for a buy recommendation.", requiresApproval: true };
  }

  if (input.owner === "AM_HOLDING") {
    if (outlook === "BEARISH" || stage === "BROKEN") {
      return { action: "SELL REVIEW", priority: 100, owner: input.owner, reason: "Held position has a broken/bearish momentum path. AM should review thesis, Fair Value and exit discipline before any sale.", requiresApproval: true };
    }
    if (outlook === "DEFENSIVE" || stage === "WEAKENING" || (expected < 0 && confidence >= 60)) {
      return { action: "TRIM", priority: 85, owner: input.owner, reason: "Momentum evidence is weakening. Protect capital by reviewing a trim rather than automatically closing the position.", requiresApproval: true };
    }
    if (favorable.has(outlook) && confidence >= 70 && entryStages.has(stage) && expected >= 5) {
      return { action: "ADD", priority: 75 + Math.min(9, Math.round(expected)), owner: input.owner, reason: "Existing holding has favorable momentum, adequate confidence and positive weighted return. AM may consider adding if thesis, valuation and cash policy agree.", requiresApproval: true };
    }
    return { action: "HOLD", priority: 55, owner: input.owner, reason: "No strong evidence to add, trim or exit. Maintain the position and monitor trigger/invalidation levels.", requiresApproval: true };
  }

  if (favorable.has(outlook) && confidence >= 65 && entryStages.has(stage) && expected >= 4) {
    return { action: "PROMOTE TO INV", priority: 70 + Math.min(9, Math.round(expected)), owner: input.owner, reason: "Watchlist momentum is favorable enough to move into Investment Research for thesis, valuation and catalyst underwriting.", requiresApproval: true };
  }
  if (risky.has(outlook) || stage === "BROKEN") {
    return { action: "AVOID", priority: 25, owner: input.owner, reason: "Watchlist momentum is defensive/bearish. Do not promote until the path repairs.", requiresApproval: true };
  }
  return { action: "WATCH", priority: 45, owner: input.owner, reason: "Keep monitoring; current forecast is not strong enough for Investment Research promotion.", requiresApproval: true };
}
