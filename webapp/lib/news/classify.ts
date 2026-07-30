// Reading a headline.
//
// This is a lexicon, not a language model, and the design follows from that.
// A keyword matcher can tell you *what the press is talking about* and *which
// way the wording leans*. It cannot tell you whether the story is true, whether
// the market has already priced it, or what a subtle piece of prose means. So
// the classifier is built to be checkable rather than clever:
//
//   • Two passes. The first decides what the headline is ABOUT; the second
//     decides which way it LEANS. Direction is read per theme, because the
//     same word means opposite things in different places — inflation
//     "cooling" is good news, growth "cooling" is not.
//
//   • Every match is recorded. The desk shows the exact phrases that produced
//     a classification, so a wrong read can be seen and the lexicon corrected.
//
//   • A headline that matches no theme is UNCLASSIFIED, and unclassified
//     headlines are counted and reported, never scored as neutral. Scoring
//     misses as zero would pull every reading toward the middle and hide how
//     much the lexicon failed to understand (Rule #5).
//
// The output is a lean in [-1, +1] per headline. It is an input to judgement,
// not a signal to trade.

export type Theme =
  | "Monetary policy"
  | "Inflation"
  | "Labour market"
  | "Growth"
  | "Credit & liquidity"
  | "Trade & geopolitics"
  | "Energy"
  | "Earnings & guidance"
  | "AI & tech capex";

export const THEMES: Theme[] = [
  "Monetary policy", "Inflation", "Labour market", "Growth",
  "Credit & liquidity", "Trade & geopolitics", "Energy",
  "Earnings & guidance", "AI & tech capex",
];

/** Why each theme matters to a barbell book — shown beside the tally. */
export const THEME_MEANING: Record<Theme, string> = {
  "Monetary policy": "Sets the discount rate on every future cash flow, and the cost of the cash sleeve.",
  Inflation: "Decides how much room policy has. Hot prints remove the cuts the growth sleeve is priced for.",
  "Labour market": "The consumer's income. Cracks here precede earnings cuts by quarters, not weeks.",
  Growth: "The denominator of every multiple. A slowdown compresses valuation before it cuts earnings.",
  "Credit & liquidity": "The first place stress shows. Spreads widen before equity indices break.",
  "Trade & geopolitics": "Supply-chain and tariff risk — hits margins directly and unevenly by sector.",
  Energy: "An input cost for everything and a tax on the consumer when it spikes.",
  "Earnings & guidance": "The bottom-up read. Aggregate guidance direction leads index earnings revisions.",
  "AI & tech capex": "The current leadership theme. Capex commentary drives the largest index weights.",
};

interface Matcher {
  re: RegExp;
  label: string;
}

const m = (label: string, pattern: string): Matcher => ({ label, re: new RegExp(pattern, "i") });

/** Pass one — what is this headline about? */
const THEME_TERMS: Record<Theme, Matcher[]> = {
  "Monetary policy": [
    m("Fed", "\\bfed(eral reserve)?\\b"), m("FOMC", "\\bfomc\\b"), m("Powell", "\\bpowell\\b"),
    m("rate decision", "\\b(interest )?rates?\\b.*\\b(decision|hold|cut|hike|raise|lower)\\b|\\b(cut|hike|raise|lower)s?\\b.*\\brates?\\b"),
    m("policy stance", "\\b(hawkish|dovish|monetary policy|quantitative (easing|tightening)|balance sheet)\\b"),
    m("central bank", "\\b(ecb|bank of (england|japan)|central bank)\\b"),
  ],
  Inflation: [
    m("CPI", "\\bcpi\\b"), m("PCE", "\\bpce\\b"), m("PPI", "\\bppi\\b"),
    m("inflation", "\\b(inflation|disinflation|deflation)\\b"),
    m("prices", "\\b(consumer|producer|price) (prices?|index|pressures?)\\b|\\bcost of living\\b"),
  ],
  "Labour market": [
    m("payrolls", "\\b(nonfarm )?payrolls?\\b"), m("jobs report", "\\bjobs? (report|data|growth|market)\\b"),
    m("unemployment", "\\bunemployment\\b"), m("jobless claims", "\\bjobless claims\\b"),
    m("layoffs", "\\b(layoffs?|job cuts?|hiring|wage growth|labor market|labour market)\\b"),
  ],
  Growth: [
    m("GDP", "\\bgdp\\b"), m("recession", "\\brecession\\b"),
    m("PMI / ISM", "\\b(ism|pmi|manufacturing index|services index)\\b"),
    m("consumer", "\\b(retail sales|consumer (spending|confidence|sentiment))\\b"),
    m("activity", "\\b(economic (growth|activity|outlook)|soft landing|hard landing|housing starts)\\b"),
  ],
  "Credit & liquidity": [
    m("credit spreads", "\\b(credit spreads?|high yield spreads?|junk bonds?)\\b"),
    m("defaults", "\\b(defaults?|bankruptc(y|ies)|delinquenc(y|ies))\\b"),
    m("banks", "\\b(bank (failure|stress|lending)|regional banks?|funding (stress|costs?)|liquidity)\\b"),
    m("ratings", "\\b(downgrade[ds]?|upgrade[ds]?)\\b.*\\b(rating|credit|outlook)\\b|\\bcredit rating\\b"),
    m("yields", "\\b(treasury yields?|10-year|bond yields?|yield curve)\\b"),
  ],
  "Trade & geopolitics": [
    m("tariffs", "\\btariffs?\\b"), m("sanctions", "\\bsanctions?\\b"),
    m("export controls", "\\b(export controls?|trade (war|deal|talks|restrictions?))\\b"),
    m("conflict", "\\b(war|strikes? on|military|invasion|attack on|ceasefire)\\b"),
    m("elections", "\\b(election|shutdown|debt ceiling)\\b"),
  ],
  Energy: [
    m("oil", "\\b(oil|crude|brent|wti)\\b"), m("OPEC", "\\bopec\\b"),
    m("gas / power", "\\b(natural gas|gasoline|energy prices?|power prices?|electricity)\\b"),
  ],
  "Earnings & guidance": [
    m("earnings", "\\bearnings?\\b"), m("guidance", "\\b(guidance|outlook|forecast)\\b"),
    m("beat / miss", "\\b(beats?|misses|missed|tops?|falls short)\\b.*\\b(estimates?|expectations?|forecasts?)\\b"),
    m("revenue / margins", "\\b(revenue|profit|margins?|buybacks?|dividend (increase|cut|hike))\\b"),
  ],
  "AI & tech capex": [
    m("AI", "\\b(a\\.?i\\.?|artificial intelligence)\\b"),
    m("data centres", "\\b(data ?cent(er|re)s?|hyperscalers?)\\b"),
    m("chips", "\\b(chips?|semiconductors?|gpus?|accelerators?|foundry)\\b"),
    m("capex", "\\b(capex|capital (expenditure|spending))\\b"),
  ],
};

/**
 * Pass two — which way does it lean? Read per theme, because direction is not a
 * property of a word: "cools" is constructive on inflation and destructive on
 * growth, and a lexicon that ignores that gets the sign wrong half the time.
 *
 * `pos` = supportive of risk assets. `neg` = hostile to them.
 */
const DIRECTION: Record<Theme, { pos: Matcher[]; neg: Matcher[] }> = {
  "Monetary policy": {
    pos: [
      m("cut / easing", "\\b(cuts?|cutting|lowers?|lowered|lowering|eas(e|es|ed|ing)|dovish|pause[ds]?|pivot)\\b"),
      m("stimulus", "\\b(stimulus|liquidity injection|quantitative easing)\\b"),
    ],
    neg: [
      m("hike / tightening", "\\b(hikes?|raises?|raised|raising|tighten(s|ed|ing)?|hawkish|higher for longer|restrictive)\\b"),
      m("cuts off the table", "\\b(no cuts?|delay(s|ed|ing)? (rate )?cuts?|fewer cuts?|rules out)\\b"),
    ],
  },
  Inflation: {
    pos: [m("cooling", "\\b(cool(s|ed|ing)?|eas(e|es|ed|ing)|slow(s|ed|ing|er)?|fell|falls?|declin(e|es|ed|ing)|below (forecast|expectations?|estimates?)|disinflation)\\b")],
    neg: [m("hotter", "\\b(hot(ter)?|accelerat(e|es|ed|ing)|ros[e]?|rise[s]?|rising|climb(s|ed|ing)?|jump(s|ed)?|surge[ds]?|above (forecast|expectations?|estimates?)|sticky|re-?accelerat)\\b")],
  },
  // Labour is the one theme where direction cannot be read from a verb alone:
  // "payrolls rose" and "unemployment rose" are opposite news carried by the
  // same word. So the cues are anchored to their subject, and a bare verb is
  // not enough to set a sign.
  "Labour market": {
    pos: [
      m("hiring up", "\\b(payrolls?|jobs?|hiring|employment|wages?)\\b[^.,;]{0,30}\\b(ros[e]?|rise[s]?|rising|jump(s|ed)?|beat[s]?|add(s|ed)|gain(s|ed)?|surge[ds]?|strong|robust|solid|accelerat)"),
      m("unemployment down", "\\bunemployment\\b[^.,;]{0,30}\\b(fell|falls?|drop(s|ped)?|declin(e|es|ed|ing)|eas(e|es|ed)|lower|record low)"),
      m("claims down", "\\bclaims\\b[^.,;]{0,30}\\b(fell|falls?|drop(s|ped)?|declin(e|es|ed))"),
    ],
    neg: [
      m("layoffs", "\\b(layoffs?|job cuts?|cut(s|ting)? (jobs|staff)|hiring freeze|redundanc)"),
      m("unemployment up", "\\bunemployment\\b[^.,;]{0,30}\\b(ros[e]?|rise[s]?|rising|jump(s|ed)?|climb(s|ed)?|surge[ds]?|higher|up to)"),
      m("hiring down", "\\b(payrolls?|jobs?|hiring|employment)\\b[^.,;]{0,30}\\b(fell|falls?|drop(s|ped)?|plunge[ds]?|slow(s|ed|ing|er)?|weak(en|ens|ened|er)?|miss(es|ed)?|fell short|declin(e|es|ed|ing)|contract)"),
      m("claims up", "\\bclaims\\b[^.,;]{0,30}\\b(ros[e]?|rise[s]?|jump(s|ed)?|surge[ds]?|climb(s|ed)?)"),
    ],
  },
  // "Growth" is also the name of the theme, so the positive cues use verb forms
  // only — matching the bare noun would make every growth headline read as
  // good news, including the ones about growth disappearing.
  Growth: {
    pos: [m("expansion", "\\b(grows|growing|expand(s|ed|ing)?|beat[s]?|stronger|accelerat(e|es|ed|ing)|rebound(s|ed|ing)?|soft landing|resilient|upgrade[ds]? (its )?(forecast|outlook))\\b")],
    neg: [m("slowdown", "\\b(slow(s|ed|ing|down|er)?|contract(s|ed|ing|ion)?|shrink(s|ing)?|recession|weak(en|ens|ened|er)?|miss(es|ed)?|fell|falls?|declin(e|es|ed|ing)|downgrade[ds]?|cut[s]? (its )?(forecast|outlook)|hard landing|stall(s|ed|ing)?)\\b")],
  },
  "Credit & liquidity": {
    pos: [m("spreads tighten", "\\b(tighten(s|ed|ing)?|narrow(s|ed|ing)?|upgrade[ds]?|improv(e|es|ed|ing)|record (issuance|demand)|eas(e|es|ed|ing))\\b")],
    neg: [m("stress", "\\b(widen(s|ed|ing)?|spike[ds]?|stress|default(s|ed)?|bankruptc|downgrade[ds]?|delinquenc|failure|contagion|rescue|bailout|freeze[s]?|inverted)\\b")],
  },
  "Trade & geopolitics": {
    pos: [m("de-escalation", "\\b(deal|agreement|ceasefire|truce|lift(s|ed)?|exempt(s|ion|ed)?|resum(e|es|ed|ing)|de-?escalat)\\b")],
    neg: [m("escalation", "\\b(impos(e|es|ed|ing)|rais(e|es|ed|ing)|threat(en|ens|ened|ening)?|escalat|retaliat|ban(s|ned)?|restrict(s|ed|ions?)?|attack|strike[ds]?|invasion|shutdown|halt(s|ed)?)\\b")],
  },
  Energy: {
    // Cheap energy helps the consumer and the margin; expensive energy taxes both.
    pos: [m("prices fall", "\\b(fall(s|ing)?|fell|drop(s|ped)?|slid(es?)?|declin(e|es|ed|ing)|tumbl(e|es|ed|ing)|lower|glut|oversupply)\\b")],
    neg: [m("prices rise", "\\b(surge[ds]?|spike[ds]?|jump(s|ed)?|ros[e]?|rise[s]?|rising|climb(s|ed|ing)?|rall(y|ies|ied)|supply (cut|disruption)|higher)\\b")],
  },
  "Earnings & guidance": {
    pos: [m("beat / raise", "\\b(beat(s|ing)?|top(s|ped)?|exceed(s|ed)?|rais(e|es|ed|ing) (its )?(guidance|outlook|forecast)|record (profit|revenue)|upgrade[ds]?|surge[ds]?|strong (quarter|results))\\b")],
    neg: [m("miss / cut", "\\b(miss(es|ed)?|falls? short|cut(s)? (its )?(guidance|outlook|forecast)|warn(s|ed|ing)?|downgrade[ds]?|slump(s|ed)?|plunge[ds]?|disappoint(s|ing|ed)?|weak (quarter|results|demand))\\b")],
  },
  "AI & tech capex": {
    pos: [m("capex up", "\\b(rais(e|es|ed|ing)|boost(s|ed|ing)?|increas(e|es|ed|ing)|record|expand(s|ing)?|ramp(s|ing)?|demand|order(s|ed)?|build(s|ing)?|sold out)\\b")],
    neg: [m("capex doubt", "\\b(cut(s|ting)?|delay(s|ed|ing)?|pause[ds]?|scal(e|es|ed|ing) back|bubble|overbuil(d|t)|digest(ion)?|slow(s|ed|ing|down)?|glut|cancel(s|led|ed)?)\\b")],
  },
};

/**
 * Words that change the SIZE of a lean without changing its sign. A surprise
 * moves markets more than a scheduled confirmation of what was expected.
 */
const AMPLIFIERS: Matcher[] = [
  m("unexpected", "\\b(unexpected(ly)?|surprise[ds]?|shock(s|ed|ing)?|abrupt(ly)?)\\b"),
  m("record", "\\b(record|highest|lowest|steepest|biggest|worst|best) (since|in|ever)?\\b"),
  m("emergency", "\\b(emergency|crisis|panic|unprecedented)\\b"),
  m("sharp move", "\\b(plunge[ds]?|soar(s|ed)?|collapse[ds]?|crash(es|ed)?|skyrocket)\\b"),
];

export interface Classification {
  themes: Theme[];
  /** -1 (hostile to risk) .. +1 (supportive). Null when no direction was read. */
  lean: number | null;
  /** The exact phrases that produced this read, for audit. */
  matched: string[];
  amplified: boolean;
}

/**
 * Classify one headline. Title and summary are read together — publishers often
 * put the direction in the second sentence.
 */
export function classifyHeadline(title: string, summary?: string | null): Classification {
  const text = summary ? `${title}. ${summary}` : title;
  const themes: Theme[] = [];
  const matched: string[] = [];

  for (const theme of THEMES) {
    const hit = THEME_TERMS[theme].find((t) => t.re.test(text));
    if (hit) {
      themes.push(theme);
      matched.push(`${theme}: ${hit.label}`);
    }
  }
  if (!themes.length) return { themes: [], lean: null, matched: [], amplified: false };

  // Direction is averaged across the themes present: a headline about both a
  // hot CPI print and a dovish Fed is genuinely mixed, and the read should say
  // so rather than picking whichever matched first.
  let sum = 0;
  let counted = 0;
  for (const theme of themes) {
    const { pos, neg } = DIRECTION[theme];
    const p = pos.find((t) => t.re.test(text));
    const n = neg.find((t) => t.re.test(text));
    if (p && !n) { sum += 1; counted++; matched.push(`+ ${p.label}`); }
    else if (n && !p) { sum -= 1; counted++; matched.push(`− ${n.label}`); }
    else if (p && n) {
      // Both directions present — the headline is mixed on this theme, which is
      // information. It contributes nothing rather than a coin flip.
      counted++;
      matched.push(`± mixed (${p.label} / ${n.label})`);
    }
  }
  if (!counted || sum === 0) {
    return { themes, lean: counted ? 0 : null, matched, amplified: false };
  }

  // A clean, unambiguous read is 0.7 rather than 1.0, so that amplification has
  // somewhere to go. Reserving the top of the scale for surprises is the point:
  // if a routine print already scored 1.0, "unexpectedly plunges" could not
  // register as bigger news than "fell as forecast".
  const amp = AMPLIFIERS.find((a) => a.re.test(text));
  if (amp) matched.push(`×1.4 ${amp.label}`);
  const base = (sum / counted) * 0.7;
  const lean = Math.max(-1, Math.min(1, base * (amp ? 1.4 : 1)));
  return { themes, lean, matched, amplified: Boolean(amp) };
}
