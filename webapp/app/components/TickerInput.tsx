"use client";
import { useEffect, useRef, useState } from "react";

interface Hit { ticker: string; name: string; type?: string; exchange?: string }

/**
 * Ticker field with symbol suggestions.
 *
 * Typing one or two characters is enough to get a picklist, so a mistyped
 * symbol can't be saved silently and only surface later as a missing price.
 * Keyboard: ↑/↓ to move, Enter to accept, Esc to dismiss.
 */
export default function TickerInput({
  value,
  onChange,
  placeholder = "TICKER",
  autoFocus,
  style,
  onSubmitTicker,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  style?: React.CSSProperties;
  /** Called when a suggestion is picked or Enter accepts a highlighted row. */
  onSubmitTicker?: (t: string) => void;
}) {
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  // suppress the fetch that would otherwise fire right after a pick
  const justPicked = useRef(false);

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 1) {
      setHits([]);
      setOpen(false);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/symbols?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (id !== seq.current) return; // a newer keystroke won
        setHits(json.results ?? []);
        setActive(0);
        setOpen((json.results ?? []).length > 0);
      } catch {
        if (id === seq.current) setHits([]);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 220); // debounce
    return () => clearTimeout(t);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [open]);

  const pick = (h: Hit) => {
    justPicked.current = true;
    onChange(h.ticker);
    setOpen(false);
    setHits([]);
    onSubmitTicker?.(h.ticker);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", ...style }}>
      <input
        className="input-ticker"
        style={{ width: "100%" }}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={12}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onKeyDown={(e) => {
          if (!open || !hits.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % hits.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + hits.length) % hits.length); }
          else if (e.key === "Enter") { e.preventDefault(); pick(hits[active]); }
          else if (e.key === "Escape") { setOpen(false); }
        }}
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {loading && value.trim().length > 0 && !open && (
        <span className="muted" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11 }}>…</span>
      )}
      {open && hits.length > 0 && (
        <div className="ticker-menu" role="listbox">
          {hits.map((h, i) => (
            <button
              key={`${h.ticker}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`ticker-item ${i === active ? "active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(h)}
            >
              <span className="ticker-sym">{h.ticker}</span>
              <span className="ticker-name">{h.name}</span>
              {h.type && <span className="ticker-type">{h.type}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
