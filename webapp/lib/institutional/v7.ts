export type Desk =
  | "Executive"
  | "Macro"
  | "Research"
  | "Quant"
  | "Valuation"
  | "Risk"
  | "Portfolio"
  | "Liquidity"
  | "Execution"
  | "Data";

export type DecisionAction =
  | "INITIATE"
  | "ADD"
  | "HOLD"
  | "WATCH"
  | "TRIM"
  | "EXIT"
  | "REJECT"
  | "HOLD_CASH";

export type EvidenceKind =
  | "MARKET_DATA"
  | "FILING"
  | "EARNINGS"
  | "MACRO_RELEASE"
  | "CENTRAL_BANK"
  | "NEWS"
  | "MODEL"
  | "PORTFOLIO"
  | "RISK";

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  source: string;
  observedAt: string;
  asOf: string;
  freshnessHours: number;
  confidence: number;
  value?: unknown;
  note: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  desk: Desk;
  role: string;
  mission: string;
  competencies: string[];
  requiredEvidence: EvidenceKind[];
  vetoes: string[];
  minimumConfidence: number;
}

export interface AgentVote {
  agentId: string;
  action: DecisionAction;
  score: number;
  confidence: number;
  thesis: string;
  risks: string[];
  evidenceIds: string[];
  dissent?: string | null;
  veto?: string | null;
}

export interface PortfolioContext {
  nav: number;
  cashPct: number;
  liquidityPct: number;
  targetLiquidityPct: number;
  maxSingleNamePct: number;
  currentWeightPct: number;
  proposedWeightPct: number;
  sectorWeightPct: number;
  correlationToBook: number | null;
}

export interface CommitteeInput {
  ticker: string;
  requestedAction: DecisionAction;
  expectedReturnPct: number | null;
  downsidePct: number | null;
  horizonMonths: number;
  evidence: Evidence[];
  votes: AgentVote[];
  portfolio: PortfolioContext;
}

export interface GovernanceIssue {
  severity: "BLOCK" | "WARN";
  code: string;
  message: string;
}

export interface CommitteeDecision {
  ticker: string;
  action: DecisionAction;
  approved: boolean;
  conviction: number;
  confidence: number;
  proposedWeightPct: number;
  fundingSource: "EXCESS_LIQUIDITY" | "APPROVED_ROTATION" | "NEW_CASH" | "NONE";
  issues: GovernanceIssue[];
  dissent: string[];
  audit: {
    generatedAt: string;
    evidenceCount: number;
    sourceCount: number;
    participatingAgents: string[];
    rulesVersion: "Sentinel-v7.0";
  };
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const finite = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

export const AGENT_PROFILES: AgentProfile[] = [
  {
    id: "cio",
    name: "James Hartwell",
    desk: "Executive",
    role: "Chief Investment Officer",
    mission: "Integrate independent desk views and approve only decisions with positive asymmetric expectancy.",
    competencies: ["capital allocation", "scenario synthesis", "decision governance", "portfolio judgment"],
    requiredEvidence: ["PORTFOLIO", "RISK", "MODEL"],
    vetoes: ["unresolved hard-risk veto", "missing decision audit trail"],
    minimumConfidence: 70,
  },
  {
    id: "cro",
    name: "Miriam Osei",
    desk: "Risk",
    role: "Chief Risk Officer",
    mission: "Protect survival, liquidity and mandate integrity before return maximization.",
    competencies: ["concentration", "drawdown", "stress testing", "liquidity", "model risk"],
    requiredEvidence: ["RISK", "PORTFOLIO", "MARKET_DATA"],
    vetoes: ["position cap breach", "liquidity floor breach", "stale price", "unbounded downside"],
    minimumConfidence: 75,
  },
  {
    id: "macro",
    name: "Daniel Cho",
    desk: "Macro",
    role: "Head of Global Macro Strategy",
    mission: "Translate growth, inflation, liquidity and policy into a probabilistic 1–6 month risk budget.",
    competencies: ["business cycle", "inflation", "rates", "credit", "liquidity", "cross-asset regime"],
    requiredEvidence: ["MACRO_RELEASE", "CENTRAL_BANK", "MARKET_DATA"],
    vetoes: ["macro dislocation without reduced sizing"],
    minimumConfidence: 65,
  },
  {
    id: "fundamental",
    name: "Sofia Reyes",
    desk: "Research",
    role: "Senior Fundamental Analyst",
    mission: "Underwrite business quality, moat durability, management and long-run cash economics.",
    competencies: ["industry structure", "moat", "ROIC", "capital allocation", "management quality"],
    requiredEvidence: ["FILING", "EARNINGS"],
    vetoes: ["broken thesis", "accounting quality failure"],
    minimumConfidence: 70,
  },
  {
    id: "financial",
    name: "Marcus Webb",
    desk: "Research",
    role: "Senior Financial Analyst",
    mission: "Validate earnings quality, revisions, margins, balance sheet and cash conversion.",
    competencies: ["three statements", "earnings quality", "revision trend", "cash flow", "balance sheet"],
    requiredEvidence: ["FILING", "EARNINGS"],
    vetoes: ["insolvency risk", "persistent cash conversion failure"],
    minimumConfidence: 70,
  },
  {
    id: "catalyst",
    name: "Aisha Fontaine",
    desk: "Research",
    role: "Catalyst & Thematic Analyst",
    mission: "Identify measurable events, estimate their horizon and distinguish narrative from evidence.",
    competencies: ["event studies", "PEAD", "theme lifecycle", "regulation", "news verification"],
    requiredEvidence: ["NEWS", "EARNINGS"],
    vetoes: ["fabricated or unverified catalyst"],
    minimumConfidence: 65,
  },
  {
    id: "quant",
    name: "Priya Nair",
    desk: "Quant",
    role: "Head of Quantitative Research",
    mission: "Measure factor exposures, signal robustness, base rates and out-of-sample expectancy.",
    competencies: ["factor models", "signal validation", "attribution", "probability", "backtesting"],
    requiredEvidence: ["MODEL", "MARKET_DATA"],
    vetoes: ["look-ahead bias", "invalid sample", "negative expected value"],
    minimumConfidence: 70,
  },
  {
    id: "valuation",
    name: "Thomas Eriksson",
    desk: "Valuation",
    role: "Head of Valuation",
    mission: "Triangulate DCF, reverse DCF and comparable anchors with explicit uncertainty.",
    competencies: ["DCF", "reverse DCF", "WACC", "scenario analysis", "relative valuation"],
    requiredEvidence: ["FILING", "MODEL"],
    vetoes: ["no credible valuation anchor for a fundamental position"],
    minimumConfidence: 65,
  },
  {
    id: "portfolio",
    name: "Lena Müller",
    desk: "Portfolio",
    role: "Portfolio Manager",
    mission: "Maximize expected portfolio utility, not standalone stock scores.",
    competencies: ["risk budgeting", "correlation", "factor balance", "position sizing", "rotation"],
    requiredEvidence: ["PORTFOLIO", "RISK", "MODEL"],
    vetoes: ["portfolio duplication", "unfunded allocation"],
    minimumConfidence: 70,
  },
  {
    id: "liquidity",
    name: "Naomi Brooks",
    desk: "Liquidity",
    role: "Head of Treasury & Liquidity",
    mission: "Maintain cash-buffer resilience and fund approved opportunities without forced selling.",
    competencies: ["treasury ETFs", "cash ladder", "liquidity stress", "funding waterfall"],
    requiredEvidence: ["PORTFOLIO", "RISK"],
    vetoes: ["liquidity floor breach"],
    minimumConfidence: 75,
  },
  {
    id: "execution",
    name: "Ryan Blackwood",
    desk: "Execution",
    role: "Head Trader",
    mission: "Convert approved intent into executable orders with controlled slippage and event risk.",
    competencies: ["market impact", "limit orders", "liquidity", "entry timing", "transaction costs"],
    requiredEvidence: ["MARKET_DATA", "RISK"],
    vetoes: ["untradeable liquidity", "invalid price", "event blackout"],
    minimumConfidence: 75,
  },
  {
    id: "data",
    name: "Nina Okonkwo",
    desk: "Data",
    role: "Chief Data & Evidence Officer",
    mission: "Guarantee source lineage, freshness, completeness and anti-hallucination controls.",
    competencies: ["lineage", "freshness", "schema validation", "source conflict", "data quality"],
    requiredEvidence: ["MARKET_DATA"],
    vetoes: ["missing price", "stale critical evidence", "source conflict unresolved"],
    minimumConfidence: 80,
  },
];

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function validateEvidence(evidence: Evidence[]): GovernanceIssue[] {
  const issues: GovernanceIssue[] = [];
  if (!evidence.length) issues.push({ severity: "BLOCK", code: "NO_EVIDENCE", message: "No evidence supplied." });
  for (const e of evidence) {
    if (!e.id || !e.source || !e.asOf || !e.note) {
      issues.push({ severity: "BLOCK", code: "MALFORMED_EVIDENCE", message: `Evidence ${e.id || "unknown"} is incomplete.` });
    }
    if (!finite(e.confidence) || e.confidence < 0 || e.confidence > 100) {
      issues.push({ severity: "BLOCK", code: "BAD_EVIDENCE_CONFIDENCE", message: `Evidence ${e.id} has invalid confidence.` });
    }
    if (!finite(e.freshnessHours) || e.freshnessHours < 0) {
      issues.push({ severity: "BLOCK", code: "BAD_FRESHNESS", message: `Evidence ${e.id} has invalid freshness.` });
    }
    const critical = e.kind === "MARKET_DATA" || e.kind === "PORTFOLIO" || e.kind === "RISK";
    if (critical && e.freshnessHours > 48) {
      issues.push({ severity: "BLOCK", code: "STALE_CRITICAL_EVIDENCE", message: `${e.kind} evidence ${e.id} is older than 48 hours.` });
    } else if (e.freshnessHours > 24 * 45) {
      issues.push({ severity: "WARN", code: "STALE_EVIDENCE", message: `Evidence ${e.id} is older than 45 days.` });
    }
  }
  return issues;
}

export function runInstitutionalCommittee(input: CommitteeInput): CommitteeDecision {
  const issues = validateEvidence(input.evidence);
  const evidenceIds = new Set(input.evidence.map((e) => e.id));
  const profiles = new Map(AGENT_PROFILES.map((p) => [p.id, p]));
  const dissent: string[] = [];

  if (!/^[A-Z.\-]{1,10}$/.test(input.ticker)) {
    issues.push({ severity: "BLOCK", code: "INVALID_TICKER", message: "Ticker format is invalid." });
  }
  if (!finite(input.portfolio.nav) || input.portfolio.nav <= 0) {
    issues.push({ severity: "BLOCK", code: "INVALID_NAV", message: "Portfolio NAV must be positive." });
  }
  if (input.portfolio.proposedWeightPct > input.portfolio.maxSingleNamePct) {
    issues.push({ severity: "BLOCK", code: "POSITION_CAP", message: "Proposed weight exceeds the single-name cap." });
  }
  if (input.portfolio.liquidityPct < input.portfolio.targetLiquidityPct && ["INITIATE", "ADD"].includes(input.requestedAction)) {
    issues.push({ severity: "BLOCK", code: "LIQUIDITY_FLOOR", message: "Liquidity is below the macro-required buffer." });
  }
  if (finite(input.downsidePct) && input.downsidePct >= 0) {
    issues.push({ severity: "BLOCK", code: "INVALID_DOWNSIDE", message: "Downside must be represented as a negative percentage." });
  }
  if (["INITIATE", "ADD"].includes(input.requestedAction) && (!finite(input.expectedReturnPct) || !finite(input.downsidePct))) {
    issues.push({ severity: "BLOCK", code: "NO_EXPECTANCY", message: "New risk requires explicit upside and downside estimates." });
  }
  if (finite(input.expectedReturnPct) && finite(input.downsidePct) && input.downsidePct < 0) {
    const rr = input.expectedReturnPct / Math.abs(input.downsidePct);
    if (rr < 1.5) issues.push({ severity: "WARN", code: "WEAK_ASYMMETRY", message: `Expected reward:risk is only ${rr.toFixed(2)}.` });
  }

  const validVotes = input.votes.filter((vote) => {
    const profile = profiles.get(vote.agentId);
    if (!profile) {
      issues.push({ severity: "WARN", code: "UNKNOWN_AGENT", message: `Unknown agent ${vote.agentId}.` });
      return false;
    }
    const missingEvidence = vote.evidenceIds.filter((id) => !evidenceIds.has(id));
    if (missingEvidence.length) {
      issues.push({ severity: "BLOCK", code: "BROKEN_LINEAGE", message: `${profile.name} cites missing evidence: ${missingEvidence.join(", ")}.` });
    }
    if (vote.confidence < profile.minimumConfidence) {
      issues.push({ severity: "WARN", code: "LOW_AGENT_CONFIDENCE", message: `${profile.name} is below the desk confidence floor.` });
    }
    if (vote.dissent) dissent.push(`${profile.name}: ${vote.dissent}`);
    if (vote.veto) issues.push({ severity: "BLOCK", code: `VETO_${vote.agentId.toUpperCase()}`, message: `${profile.name}: ${vote.veto}` });
    return true;
  });

  const requiredAgentIds = ["cio", "cro", "macro", "fundamental", "quant", "portfolio", "data"];
  const participating = new Set(validVotes.map((v) => v.agentId));
  const missingAgents = requiredAgentIds.filter((id) => !participating.has(id));
  if (missingAgents.length) {
    issues.push({ severity: "BLOCK", code: "INCOMPLETE_COMMITTEE", message: `Missing required desks: ${missingAgents.join(", ")}.` });
  }

  const weighted = validVotes.reduce(
    (acc, vote) => {
      const confidenceWeight = clamp(vote.confidence) / 100;
      acc.score += clamp(vote.score) * confidenceWeight;
      acc.confidence += clamp(vote.confidence);
      acc.weight += confidenceWeight;
      return acc;
    },
    { score: 0, confidence: 0, weight: 0 },
  );
  const conviction = weighted.weight ? Math.round(weighted.score / weighted.weight) : 0;
  const confidence = validVotes.length ? Math.round(weighted.confidence / validVotes.length) : 0;
  const blocked = issues.some((i) => i.severity === "BLOCK");

  let action: DecisionAction = blocked ? "REJECT" : input.requestedAction;
  if (!blocked && ["INITIATE", "ADD"].includes(action) && conviction < 65) action = "WATCH";
  if (!blocked && action === "WATCH" && conviction < 45) action = "REJECT";

  const excessLiquidityPct = Math.max(0, input.portfolio.liquidityPct - input.portfolio.targetLiquidityPct);
  const fundingSource: CommitteeDecision["fundingSource"] =
    !["INITIATE", "ADD"].includes(action)
      ? "NONE"
      : excessLiquidityPct >= input.portfolio.proposedWeightPct
        ? "EXCESS_LIQUIDITY"
        : "APPROVED_ROTATION";

  return {
    ticker: input.ticker,
    action,
    approved: !blocked && !["REJECT", "WATCH"].includes(action),
    conviction,
    confidence,
    proposedWeightPct: blocked ? 0 : clamp(input.portfolio.proposedWeightPct, 0, input.portfolio.maxSingleNamePct),
    fundingSource,
    issues,
    dissent,
    audit: {
      generatedAt: new Date().toISOString(),
      evidenceCount: input.evidence.length,
      sourceCount: unique(input.evidence.map((e) => e.source)).length,
      participatingAgents: unique(validVotes.map((v) => v.agentId)),
      rulesVersion: "Sentinel-v7.0",
    },
  };
}

export function runV7SelfTest() {
  const evidence: Evidence[] = [
    { id: "px", kind: "MARKET_DATA", source: "self-test", observedAt: new Date().toISOString(), asOf: new Date().toISOString(), freshnessHours: 0, confidence: 100, note: "Fresh price" },
    { id: "filing", kind: "FILING", source: "self-test", observedAt: new Date().toISOString(), asOf: new Date().toISOString(), freshnessHours: 24, confidence: 95, note: "Latest filing" },
    { id: "macro", kind: "MACRO_RELEASE", source: "self-test", observedAt: new Date().toISOString(), asOf: new Date().toISOString(), freshnessHours: 24, confidence: 90, note: "Macro state" },
    { id: "model", kind: "MODEL", source: "self-test", observedAt: new Date().toISOString(), asOf: new Date().toISOString(), freshnessHours: 1, confidence: 90, note: "Expected return model" },
    { id: "book", kind: "PORTFOLIO", source: "self-test", observedAt: new Date().toISOString(), asOf: new Date().toISOString(), freshnessHours: 0, confidence: 100, note: "Current book" },
    { id: "risk", kind: "RISK", source: "self-test", observedAt: new Date().toISOString(), asOf: new Date().toISOString(), freshnessHours: 0, confidence: 100, note: "Risk budget" },
  ];
  const required = ["cio", "cro", "macro", "fundamental", "quant", "portfolio", "data"];
  const votes: AgentVote[] = required.map((agentId, index) => ({
    agentId,
    action: "INITIATE",
    score: 72 + index,
    confidence: 82,
    thesis: "Self-test institutional vote",
    risks: ["Model uncertainty"],
    evidenceIds: evidence.map((e) => e.id),
  }));
  const decision = runInstitutionalCommittee({
    ticker: "TEST",
    requestedAction: "INITIATE",
    expectedReturnPct: 18,
    downsidePct: -8,
    horizonMonths: 12,
    evidence,
    votes,
    portfolio: {
      nav: 100000,
      cashPct: 2,
      liquidityPct: 15,
      targetLiquidityPct: 8,
      maxSingleNamePct: 10,
      currentWeightPct: 0,
      proposedWeightPct: 3,
      sectorWeightPct: 12,
      correlationToBook: 0.45,
    },
  });
  return {
    ok: decision.approved && decision.action === "INITIATE" && decision.audit.participatingAgents.length === required.length,
    decision,
    agentCount: AGENT_PROFILES.length,
  };
}
