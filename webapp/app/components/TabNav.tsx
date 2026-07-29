"use client";
import { useEffect, useRef, useState } from "react";

export interface TabDef {
  id: string;
  label: string;
}

/**
 * Navigation that adapts to width.
 *
 * A horizontal row of three tabs overflows a phone screen — the third tab sat
 * off-canvas and needed landscape to reach. On narrow screens this renders a
 * button that opens the sections stacked vertically instead; wide screens keep
 * the row. The swap is done in CSS so there is no hydration mismatch.
 */
export default function TabNav({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <>
      {/* Wide screens: the original row */}
      <div className="tabs tabs-wide">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`tab ${active === t.id ? "active" : ""}`}
            onClick={() => onChange(t.id)}
            aria-current={active === t.id ? "page" : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Narrow screens: tap to open a vertical list */}
      <div className="tab-select" ref={wrapRef}>
        <button
          ref={btnRef}
          type="button"
          className="tab-select-btn"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="tab-select-current">{current.label}</span>
          <span className={`tab-select-chevron ${open ? "open" : ""}`} aria-hidden="true">
            ▾
          </span>
        </button>

        {open && (
          <div className="tab-select-menu" role="menu" aria-label="Sections">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                className={`tab-select-item ${active === t.id ? "active" : ""}`}
                onClick={() => pick(t.id)}
              >
                <span>{t.label}</span>
                {active === t.id && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
