// The news pulse — what the flow of economic news is saying, and whether it is
// changing.
//
// The level matters less than the change. A market that has been reading bad
// inflation news for six weeks has priced bad inflation news; the actionable
// moment is when a theme that was quiet starts deteriorating, because that is
// the part price has not absorbed yet. So the pulse computes two windows from a
// single fetch — the last 48 hours against the trailing week — and reports the
// gap as an escalation.
//
// Weighting, stated once so it can be argued with:
//
//   recency  ≤48h ×1.0, ≤7d ×0.5, older ×0.25. Old news is context, not signal.
//   tier     official sources ×1.6 against press ×1.0. The Fed publishing its
//            own decision is the event; an article about it is a report.
//
// Nothing here is a trade instruction. The pulse is a narrative reading, and
// narrative is the input with the worst signal-to-noise of any the fund uses.

import { FEEDS, TIER_WEIGHT, type Feed } from "./feeds";
import { fetchFeed, type FeedItem } from "./rss";
import { classifyHeadline, THEMES, THEME_MEANING, type Theme, type Classification } from "./classify";

export type PulseBand =
  | "Deteriorating" | "Cautious" | "Balanced" | "Improving" | "Expansive";

export interface ScoredHeadline {
  title: string;
  link: string | null;
  published: string | null
  source: string;
  tier: Feed["tier"];
  ageHours: number | null;
  themes: Theme[];
  lean: number | null;
  matched: string[];
  /** recency × tier — how much this headline counted. */
  weight: number;
}

export interface ThemeRead {
  theme: Theme;
  meaning: string;
  /** -100..+100, weighted mean lean across classified headlines. */
  score: number | null;
  headlines: number;
  /** Direction over the last 48h only, where there were enough headlines. */
  recentScore: number | null;
  recentHeadlines: number;
  /** recentScore − score, in points. Negative means it is getting worse. */
  shiftPts: number | null;
  top: ScoredHeadline[];
}

export interface Escalation {
  theme: Theme;
  shiftPts: number;
  direction: "deteriorating" | "improving";
  note: string;
}

export interface SourceReport {
  label: string;
  tier: Feed["tier"];
  covers: string;
  items: number;
  error: string | null;
}

export interface NewsPulse {
  score: number | null;
  band: PulseBand;
  themes: ThemeRead[];
  escalations: Escalation[];
  sources: SourceReport[];
  /** Headlines read, classified, and the share the lexicon understood. */
  total: number;
  classified: number;
  coveragePct: number;
  sourcesOk: number;
  sourcesTotal: number;
  fetchedAt: string;
  notes: string[];
}

const RECENT_HOURS = 48;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round1 = (x: number) => Math.round(x * 10) / 10;
/** Weights need two places — ×0.25 rounded to one becomes ×0.3. */
const round2 = (x: number) => Math.round(x * 100) / 100;

function recencyWeight(ageHours: number | null): number {
  if (ageHours == null) return 0.25; // undated: treated as old rather than fresh
  if (ageHours <= RECENT_HOURS) return 1;
  if (ageHours <= 24 * 7) return 0.5;
  return 0.25;
}

export function classifyPulse(score: number | null): PulseBand {
  if (score == null) return "Balanced";
  if (score <= -30) return "Deteriorating";
  if (score <= -10) return "Cautious";
  if (score < 10) return "Balanced";
  if (score < 30) return "Improving";
  return "Expansive";
}

/** Weighted mean of a set of leans, expressed on a -100..+100 scale. */
function weightedScore(rows: { lean: number | null; weight: number }[]): number | null {
  const scored = rows.filter((r) => r.lean != null);
  if (!scored.length) return null;
  const wsum = scored.reduce((s, r) => s + r.weight, 0);
  if (wsum <= 0) return null;
  const mean = scored.reduce((s, r) => s + (r.lean as number) * r.weight, 0) / wsum;
  return Math.round(clamp(mean, -1, 1) * 100);
}

export interface PulseInput {
  /** Pre-fetched feeds, for testing. Omit to fetch the registry live. */
  fetched?: { id: string; items: FeedItem[]; error: string | null }[];
  now?: Date;
  feeds?: Feed[];
}

export async function buildNewsPulse(input: PulseInput = {}): Promise<NewsPulse> {
  const feeds = input.feeds ?? FEEDS;
  const now = input.now ?? new Date();
  const fetched =
    input.fetched ?? (await Promise.all(feeds.map((f) => fetchFeed(f.id, f.url))));

  const byId = new Map(feeds.map((f) => [f.id, f]));
  const sources: SourceReport[] = [];
  const rows: ScoredHeadline[] = [];

  for (const res of fetched) {
    const feed = byId.get(res.id);
    if (!feed) continue;
    sources.push({
      label: feed.label, tier: feed.tier, covers: feed.covers,
      items: res.items.length, error: res.error,
    });
    // 25 per source keeps one prolific wire from dominating a 9-source read.
    for (const item of res.items.slice(0, 25)) {
      const ageHours = item.published
        ? Math.max(0, (now.getTime() - Date.parse(item.published)) / 3_600_000)
        : null;
      // Anything older than three weeks is history, not news.
      if (ageHours != null && ageHours > 24 * 21) continue;
      const c: Classification = classifyHeadline(item.title, item.summary);
      rows.push({
        title: item.title,
        link: item.link,
        published: item.published,
        source: feed.label,
        tier: feed.tier,
        ageHours: ageHours == null ? null : Math.round(ageHours),
        themes: c.themes,
        lean: c.lean,
        matched: c.matched,
        weight: round2(recencyWeight(ageHours) * TIER_WEIGHT[feed.tier]),
      });
    }
  }

  const classified = rows.filter((r) => r.themes.length > 0);
  const withLean = rows.filter((r) => r.lean != null);
  const score = weightedScore(rows);

  // ── Per-theme reads, and the 48h-vs-week shift ──
  const themes: ThemeRead[] = [];
  for (const theme of THEMES) {
    const inTheme = rows.filter((r) => r.themes.includes(theme));
    if (!inTheme.length) continue;
    const recent = inTheme.filter((r) => r.ageHours != null && r.ageHours <= RECENT_HOURS);
    const full = weightedScore(inTheme);
    // A shift needs enough recent headlines to be a shift rather than one story.
    const recentScore = recent.filter((r) => r.lean != null).length >= 2 ? weightedScore(recent) : null;
    themes.push({
      theme,
      meaning: THEME_MEANING[theme],
      score: full,
      headlines: inTheme.length,
      recentScore,
      recentHeadlines: recent.length,
      shiftPts: recentScore != null && full != null ? recentScore - full : null,
      top: inTheme
        .filter((r) => r.lean != null)
        .sort((a, b) => Math.abs((b.lean as number) * b.weight) - Math.abs((a.lean as number) * a.weight))
        .slice(0, 4),
    });
  }
  themes.sort((a, b) => b.headlines - a.headlines);

  // ── Escalations: what is moving, not what is bad ──
  const escalations: Escalation[] = [];
  for (const t of themes) {
    if (t.shiftPts == null || Math.abs(t.shiftPts) < 25) continue;
    const deteriorating = t.shiftPts < 0;
    escalations.push({
      theme: t.theme,
      shiftPts: t.shiftPts,
      direction: deteriorating ? "deteriorating" : "improving",
      note: deteriorating
        ? `${t.theme} has turned down sharply in the last two days — ${t.recentScore} against ${t.score} over the full window. ` +
          `A theme moving this fast is usually not yet in the price; treat it as a reason to slow adds in the affected sleeve, not as a sell signal on its own.`
        : `${t.theme} has improved sharply in the last two days — ${t.recentScore} against ${t.score} over the full window. ` +
          `Confirm with price before acting: an improving narrative that the tape does not follow is a trap, not a signal.`,
    });
  }
  escalations.sort((a, b) => Math.abs(b.shiftPts) - Math.abs(a.shiftPts));

  const sourcesOk = sources.filter((s) => !s.error).length;
  const coveragePct = rows.length ? Math.round((classified.length / rows.length) * 100) : 0;

  const notes: string[] = [
    `Read ${rows.length} headlines from ${sourcesOk} of ${sources.length} sources. ${classified.length} matched a theme (${coveragePct}%); ` +
      `${rows.length - classified.length} did not and were left out of every score rather than counted as neutral.`,
    `Direction was readable on ${withLean.length} of ${classified.length} classified headlines — the rest name a theme without leaning either way.`,
    `Weighting: last 48 hours ×1.0, last week ×0.5, older ×0.25; official sources ×1.6 against press ×1.0.`,
    `This is a keyword lexicon, not a language model. It reads what the press is discussing and how the wording leans — not whether a story is true, and not whether the market has already priced it. Every classification shows the phrases that produced it so a wrong read can be seen.`,
  ];
  if (sourcesOk < sources.length) {
    notes.push(
      `Unreachable: ${sources.filter((s) => s.error).map((s) => `${s.label} (${s.error})`).join("; ")}. ` +
        `A missing source narrows the read; it is named here rather than hidden.`
    );
  }
  if (rows.length < 15) {
    notes.push("Fewer than 15 headlines were available. Treat the reading as indicative only — a pulse this thin can be moved by a single story.");
  }

  return {
    score,
    band: classifyPulse(score),
    themes,
    escalations,
    sources,
    total: rows.length,
    classified: classified.length,
    coveragePct,
    sourcesOk,
    sourcesTotal: sources.length,
    fetchedAt: now.toISOString(),
    notes,
  };
}
