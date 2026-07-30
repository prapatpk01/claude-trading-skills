// A small RSS / Atom reader.
//
// Written by hand rather than pulled in as a dependency: the app needs four
// fields per item (title, link, date, summary) from two well-known formats, and
// a parser that small is easier to reason about than a general XML tree.
//
// It is deliberately forgiving. Feeds in the wild put titles in CDATA, use
// <updated> instead of <pubDate>, wrap links in attributes, and emit HTML inside
// descriptions. Anything unparseable is skipped rather than thrown, because one
// malformed item should not cost the whole feed.

export interface FeedItem {
  title: string;
  link: string | null;
  /** ISO date, or null when the feed gave no usable timestamp. */
  published: string | null;
  summary: string | null;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  mdash: "—", ndash: "–", hellip: "…", "#39": "'", "#039": "'",
};

/** Unwrap CDATA, decode the entities feeds actually use, strip tags. */
export function decodeText(raw: string): string {
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      const n = parseInt(code.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    if (ENTITIES[code]) return ENTITIES[code];
    if (code.startsWith("#")) {
      const n = parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return m;
  });
  return s.replace(/\s+/g, " ").trim();
}

function firstTag(block: string, ...names: string[]): string | null {
  for (const name of names) {
    const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
    if (m) return m[1];
  }
  return null;
}

/** Atom puts the URL in an attribute; RSS puts it in the element body. */
function extractLink(block: string): string | null {
  const rss = firstTag(block, "link");
  if (rss) {
    const text = decodeText(rss);
    if (/^https?:\/\//i.test(text)) return text;
  }
  const atom = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (atom) return atom[1];
  const guid = firstTag(block, "guid");
  if (guid) {
    const text = decodeText(guid);
    if (/^https?:\/\//i.test(text)) return text;
  }
  return null;
}

function toIso(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(decodeText(raw));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Parse an RSS 2.0 or Atom document into items, newest first where dated. */
export function parseFeed(xml: string): FeedItem[] {
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
  const items: FeedItem[] = [];
  for (const block of blocks) {
    const rawTitle = firstTag(block, "title");
    if (!rawTitle) continue;
    const title = decodeText(rawTitle);
    if (!title) continue;
    const summaryRaw = firstTag(block, "description", "summary", "content");
    items.push({
      title,
      link: extractLink(block),
      published: toIso(firstTag(block, "pubDate", "published", "updated", "dc:date")),
      summary: summaryRaw ? decodeText(summaryRaw).slice(0, 400) || null : null,
    });
  }
  items.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));
  return items;
}

export interface FetchedFeed {
  id: string;
  items: FeedItem[];
  error: string | null;
}

/**
 * Fetch and parse one feed. Never throws: a source that is unreachable, slow,
 * or serving something that isn't a feed comes back as an error string so the
 * desk can name it in its coverage report.
 */
export async function fetchFeed(
  id: string,
  url: string,
  timeoutMs = 6000
): Promise<FetchedFeed> {
  try {
    const res = await fetch(url, {
      headers: {
        // Several publishers reject requests without a browser-shaped agent.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { id, items: [], error: `HTTP ${res.status}` };
    const xml = await res.text();
    const items = parseFeed(xml);
    if (!items.length) return { id, items: [], error: "no items — feed shape may have changed" };
    return { id, items, error: null };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return { id, items: [], error: /timeout|abort/i.test(msg) ? "timed out" : msg.slice(0, 120) };
  }
}
