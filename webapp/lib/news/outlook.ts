// The forward view — what three independent reads say together.
//
//   regime     where the market IS      (price: trend, volatility, drawdown)
//   sentiment  how CROWDED that is      (positioning: Fear & Greed)
//   news       what is BEING SAID       (narrative: this desk)
//
// Kept separate on purpose, and combined only here. The reason is that the
// interesting information lives in the DISAGREEMENTS. When price is strong,
// positioning is euphoric, and the news flow has quietly turned down, that is
// the late-cycle setup — and it is invisible to any one of the three reads on
// its own. The mirror case, panic positioning with an improving news flow, is
// where the fund's best entries have come from.
//
// What news is allowed to do, stated as a rule rather than left implicit:
//
//   News can change the PACE and the SEQUENCE of a decision already taken.
//   It cannot change a sleeve target, a position cap, or a score.
//
// That boundary is not timidity, it is the honest limit of the input. A keyword
// read of press headlines is the noisiest measurement the fund makes; letting it
// move real allocation would import that noise straight into the book. Slowing
// an add by a week costs very little when the read is wrong and saves a great
// deal when it is right — an asymmetry worth having.

import type { RegimeAssessment } from "../team/governance";
import type { FearGreedRead } from "../team/fearGreed";
import type { NewsPulse } from "./pulse";
import { macroCalendar, imminent, type MacroEvent } from "./calendar";

export type DivergenceKind =
  | "late-cycle"      // price and positioning strong, news deteriorating
  | "early-recovery"  // price and positioning weak, news improving
  | "priced-in"       // news bad, positioning already fearful
  | "crowded-confirm" // news good, positioning already greedy
  | "aligned"         // all three agree
  | "insufficient";   // not enough news to say

export interface Divergence {
  kind: DivergenceKind;
  headline: string;
  reading: string;
  /** How much weight to give this — a divergence on 12 headlines is not a signal. */
  confidence: "low" | "moderate" | "firm";
}

export interface NarrativeGate {
  addPosture: "proceed" | "stage" | "hold";
  trimPosture: "normal" | "accelerate";
  reason: string;
  /** The boundary, restated in the output so it travels with the advice. */
  limit: string;
}

export interface Outlook {
  divergence: Divergence;
  gate: NarrativeGate;
  /** Next four weeks, in order of what to do first. */
  actions: string[];
  /** What would confirm the current stance. */
  confirms: string[];
  /** What would break it. */
  invalidates: string[];
  calendar: MacroEvent[];
  imminent: MacroEvent[];
  notes: string[];
}

export interface OutlookInput {
  regime: RegimeAssessment | null;
  fearGreed: FearGreedRead;
  pulse: NewsPulse;
  now?: Date;
}

const NEG = -10;
const POS = 10;

function confidenceFor(pulse: NewsPulse): "low" | "moderate" | "firm" {
  if (pulse.classified < 12 || pulse.sourcesOk < 2) return "low";
  if (pulse.classified < 30 || pulse.sourcesOk < 4) return "moderate";
  return "firm";
}

function readDivergence(input: OutlookInput): Divergence {
  const { regime, fearGreed, pulse } = input;
  const news = pulse.score;
  const fg = fearGreed.value;
  const confidence = confidenceFor(pulse);

  if (news == null || pulse.classified < 6) {
    return {
      kind: "insufficient",
      headline: "Not enough classified news to compare against price",
      reading:
        `Only ${pulse.classified} headlines matched a theme. The regime and sentiment reads stand on their own; ` +
        `the narrative read is withheld rather than manufactured from a handful of stories.`,
      confidence: "low",
    };
  }

  const riskOn = regime?.regime === "Risk-On";
  const riskOff = regime?.regime === "Risk-Off" || regime?.regime === "Crisis";
  const greedy = fg > 55;
  const fearful = fg < 35;

  if (news <= NEG && (riskOn || greedy)) {
    return {
      kind: "late-cycle",
      headline: "Price is strong, the news flow is not — the divergence to respect",
      reading:
        `The news read is ${news} while the tape is ${regime?.regime ?? "unclassified"} and Fear & Greed sits at ${fg}. ` +
        `Deteriorating fundamentals under a rising market is the ordinary shape of a late cycle: positioning holds prices up ` +
        `until it doesn't. This is not a sell signal — price is the arbiter and price is still constructive — but it is the ` +
        `moment to stop adding into strength and to make sure the cash sleeve is at its floor rather than below it.`,
      confidence,
    };
  }

  if (news >= POS && (riskOff || fearful)) {
    return {
      kind: "early-recovery",
      headline: "The news flow has turned up before the tape — where entries come from",
      reading:
        `The news read is +${news} while the tape is ${regime?.regime ?? "unclassified"} and Fear & Greed sits at ${fg}. ` +
        `An improving narrative into fearful positioning is the setup that pays best, because the buyers have not arrived yet. ` +
        `It is also the easiest to be early on: stage entries and require price confirmation on each tranche rather than ` +
        `committing the whole size to a narrative.`,
      confidence,
    };
  }

  if (news <= NEG && fearful) {
    return {
      kind: "priced-in",
      headline: "Bad news, and positioning already knows",
      reading:
        `The news read is ${news} and Fear & Greed is ${fg}. Both are negative, which means the story is largely in the price. ` +
        `The mistake here is selling into it: capitulation is where the fund's rules point the other way. Follow the sentiment ` +
        `tilt rather than the headlines.`,
      confidence,
    };
  }

  if (news >= POS && greedy) {
    return {
      kind: "crowded-confirm",
      headline: "Good news into crowded positioning",
      reading:
        `The news read is +${news} with Fear & Greed at ${fg}. The narrative confirms the tape, which is comfortable and ` +
        `therefore worth being careful about — everyone is reading the same thing. Hold what is working, keep new size small, ` +
        `and let the sentiment overlay take risk off at the top of the band rather than adding to it.`,
      confidence,
    };
  }

  return {
    kind: "aligned",
    headline: "Narrative, price and positioning broadly agree",
    reading:
      `News read ${news >= 0 ? "+" : ""}${news}, tape ${regime?.regime ?? "unclassified"}, Fear & Greed ${fg}. ` +
      `Nothing is pulling against anything else, so the news desk adds no instruction of its own: run the regime and ` +
      `sentiment plan as it stands.`,
    confidence,
  };
}

function buildGate(d: Divergence, pulse: NewsPulse): NarrativeGate {
  const limit =
    "News changes the pace and the order of decisions already taken. It does not change a sleeve target, a position cap, or a score.";
  const worsening = pulse.escalations.filter((e) => e.direction === "deteriorating");

  if (d.kind === "late-cycle") {
    return {
      addPosture: worsening.length >= 2 ? "hold" : "stage",
      trimPosture: "accelerate",
      reason:
        worsening.length >= 2
          ? `Two or more themes are deteriorating fast (${worsening.map((e) => e.theme).join(", ")}) while price is still strong. ` +
            `New adds wait for the news flow to stabilise or for price to confirm the strength; trims already justified by the cap ` +
            `or by valuation are taken now rather than next week.`
          : `Price still supports the position but the narrative is weakening. Adds are staged in tranches with price confirmation ` +
            `on each; trims already justified are brought forward.`,
      limit,
    };
  }
  if (d.kind === "crowded-confirm") {
    return {
      addPosture: "stage",
      trimPosture: "accelerate",
      reason:
        "Everyone is reading the same constructive story. Stage new size rather than committing it, and take the trims the " +
        "sentiment overlay calls for while there is a bid to sell into.",
      limit,
    };
  }
  if (d.kind === "early-recovery") {
    return {
      addPosture: "stage",
      trimPosture: "normal",
      reason:
        "The narrative has turned before the tape. Stage entries in thirds with price confirmation on each — the read is right " +
        "often enough to act on and early often enough that size must be earned.",
      limit,
    };
  }
  if (d.kind === "priced-in") {
    return {
      addPosture: "proceed",
      trimPosture: "normal",
      reason:
        "The bad news is in the price and positioning is fearful. Headlines are not a reason to slow a deployment the sentiment " +
        "overlay has already called for.",
      limit,
    };
  }
  if (d.kind === "insufficient") {
    return {
      addPosture: "proceed",
      trimPosture: "normal",
      reason:
        "Too little classified news to justify altering the pace of anything. The regime and sentiment plan runs unmodified.",
      limit,
    };
  }
  return {
    addPosture: worsening.length >= 2 ? "stage" : "proceed",
    trimPosture: "normal",
    reason:
      worsening.length >= 2
        ? `The three reads agree, but ${worsening.map((e) => e.theme).join(" and ")} ${worsening.length > 1 ? "are" : "is"} ` +
          `deteriorating quickly enough to be worth staging adds through.`
        : "Nothing in the news flow argues for changing the pace of the existing plan.",
    limit,
  };
}

export function buildOutlook(input: OutlookInput): Outlook {
  const now = input.now ?? new Date();
  const { pulse, fearGreed, regime } = input;
  const divergence = readDivergence(input);
  const gate = buildGate(divergence, pulse);
  const calendar = macroCalendar(now);
  const soon = imminent(calendar, 5);

  // ── What to do, in order ──
  const actions: string[] = [];
  if (gate.addPosture === "hold") {
    actions.push("Hold new adds across the growth sleeve until the deteriorating themes stabilise or price confirms. Existing positions are unaffected — this is a pace decision, not an exit.");
  } else if (gate.addPosture === "stage") {
    actions.push("Stage every add in thirds, with price confirmation required before each tranche. A narrative read is not enough to commit full size.");
  }
  if (gate.trimPosture === "accelerate") {
    actions.push("Bring forward any trim already justified by the position cap or by valuation. Selling into a bid beats selling after it leaves.");
  }
  for (const e of pulse.escalations.slice(0, 3)) {
    actions.push(`${e.theme} — ${e.note}`);
  }
  for (const e of soon) {
    actions.push(
      `${e.label} in ${e.daysAway === 0 ? "today" : `${e.daysAway} day${e.daysAway === 1 ? "" : "s"}`} (${e.window}). ` +
      `Decide now, not after: ${e.ifHostile}`
    );
  }
  if (!actions.length) {
    actions.push("Nothing in the news flow or the calendar changes the plan this week. Run the regime and sentiment allocation as it stands.");
  }

  // ── What would confirm, and what would break, the current stance ──
  const confirms: string[] = [];
  const invalidates: string[] = [];

  const worst = pulse.themes.filter((t) => t.score != null).sort((a, b) => (a.score as number) - (b.score as number))[0];
  const best = pulse.themes.filter((t) => t.score != null).sort((a, b) => (b.score as number) - (a.score as number))[0];

  if (best) confirms.push(`${best.theme} holding at ${(best.score as number) >= 0 ? "+" : ""}${best.score} or better over the next fortnight — it is the strongest leg of the current read.`);
  if (regime) confirms.push(`The index holding above the moving averages that put the regime at ${regime.score}/100 — price remains the arbiter, not the narrative.`);
  confirms.push(`Fear & Greed staying inside ${Math.max(0, fearGreed.value - 15)}–${Math.min(100, fearGreed.value + 15)}. A move outside that band changes the sentiment tilt before the news changes.`);

  if (worst && (worst.score as number) < 0) {
    invalidates.push(`${worst.theme} deteriorating a further 25 points — at that pace it stops being narrative and starts appearing in earnings.`);
  }
  invalidates.push("Credit spreads widening while equities hold. Credit leads, and a divergence there outranks everything on this page.");
  if (regime) invalidates.push(`The regime score dropping through the next band — that changes the sleeve targets themselves, which the news desk cannot do.`);
  const fomc = calendar.find((e) => e.theme === "Monetary policy");
  if (fomc) invalidates.push(`A hawkish surprise at the ${fomc.window} FOMC. ${fomc.ifHostile}`);

  const notes: string[] = [
    "Three separate reads: regime (price), sentiment (positioning), news (narrative). They are never averaged — the information is in where they disagree.",
    gate.limit,
    `Confidence in the narrative read: ${divergence.confidence} — based on ${pulse.classified} classified headlines from ${pulse.sourcesOk} of ${pulse.sourcesTotal} sources.`,
    "Release dates are projected from published conventions and marked [E]. The FOMC is given at month resolution because the committee sets the date; it is not guessed. Confirm any date a decision depends on at the source.",
  ];

  return { divergence, gate, actions, confirms, invalidates, calendar, imminent: soon, notes };
}
