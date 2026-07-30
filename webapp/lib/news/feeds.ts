// Economic news sources — the registry.
//
// Every source here is a public RSS or Atom feed that needs no key, because the
// rest of the app is built the same way and a desk that only works with a paid
// subscription is a desk that stops working.
//
// Sources are tiered, and the tier changes how much a headline counts:
//
//   official  the institution that makes the decision, publishing its own
//             words — the Fed, BLS, BEA, Treasury. A rate decision from
//             federalreserve.gov is the event, not a report about the event.
//   press     financial media. Fast and broad, but it reports narrative as
//             much as fact, and headlines are written to be clicked.
//
// A feed that fails is reported by name rather than dropped, so a dead URL
// shows up as reduced coverage instead of quietly narrowing the read. Editing
// this list is the whole configuration surface: add a feed, and the pulse
// widens; the parser and the classifier need no changes.

export type FeedTier = "official" | "press";

export interface Feed {
  id: string;
  label: string;
  url: string;
  tier: FeedTier;
  /** What this source is good for — shown in the coverage table. */
  covers: string;
}

export const FEEDS: Feed[] = [
  {
    id: "fed-press",
    label: "Federal Reserve — press releases",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    tier: "official",
    covers: "Rate decisions, FOMC statements, policy actions",
  },
  {
    id: "fed-speeches",
    label: "Federal Reserve — speeches",
    url: "https://www.federalreserve.gov/feeds/speeches.xml",
    tier: "official",
    covers: "Guidance ahead of decisions — the tone before the vote",
  },
  {
    id: "bls",
    label: "Bureau of Labor Statistics",
    url: "https://www.bls.gov/feed/bls_latest.rss",
    tier: "official",
    covers: "CPI, PPI, payrolls, unemployment",
  },
  {
    id: "bea",
    label: "Bureau of Economic Analysis",
    url: "https://apps.bea.gov/rss/rss.xml",
    tier: "official",
    covers: "GDP, PCE inflation, personal income",
  },
  {
    id: "treasury",
    label: "US Treasury — press releases",
    url: "https://home.treasury.gov/news/press-releases/feed",
    tier: "official",
    covers: "Debt issuance, sanctions, fiscal actions",
  },
  {
    id: "cnbc-economy",
    label: "CNBC — Economy",
    url: "https://www.cnbc.com/id/20910258/device/rss/rss.html",
    tier: "press",
    covers: "Macro coverage and reaction",
  },
  {
    id: "cnbc-markets",
    label: "CNBC — Markets",
    url: "https://www.cnbc.com/id/10000664/device/rss/rss.html",
    tier: "press",
    covers: "Market-moving headlines through the session",
  },
  {
    id: "yahoo-finance",
    label: "Yahoo Finance — headlines",
    url: "https://finance.yahoo.com/news/rssindex",
    tier: "press",
    covers: "Broad market and single-name news",
  },
  {
    id: "marketwatch",
    label: "MarketWatch — top stories",
    url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    tier: "press",
    covers: "Cross-asset headlines",
  },
];

/** Official sources count for more than commentary about them. */
export const TIER_WEIGHT: Record<FeedTier, number> = {
  official: 1.6,
  press: 1.0,
};
