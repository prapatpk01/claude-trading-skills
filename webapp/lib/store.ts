// In-memory fallback store used when Supabase is not configured.
// NOTE: data is lost on server restart — dev/demo convenience only.
import { randomUUID } from "crypto";

export interface Holding {
  id: string;
  ticker: string;
  shares: number;
  avg_cost: number;
  notes?: string | null;
  thesis?: string | null;
  target_price?: number | null;
  /** Date the position was opened / exited (YYYY-MM-DD). */
  opened_at?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WatchItem {
  id: string;
  ticker: string;
  reason?: string;
  alert_price?: number | null;
  created_at: string;
}

class MemoryStore {
  holdings: Holding[] = [];
  watchlist: WatchItem[] = [];

  addHolding(h: Omit<Holding, "id" | "created_at" | "updated_at">): Holding {
    const now = new Date().toISOString();
    const item: Holding = { ...h, id: randomUUID(), created_at: now, updated_at: now };
    this.holdings.push(item);
    return item;
  }
  updateHolding(id: string, patch: Partial<Holding>): Holding | null {
    const idx = this.holdings.findIndex((h) => h.id === id);
    if (idx < 0) return null;
    this.holdings[idx] = { ...this.holdings[idx], ...patch, id, updated_at: new Date().toISOString() };
    return this.holdings[idx];
  }
  deleteHolding(id: string): boolean {
    const before = this.holdings.length;
    this.holdings = this.holdings.filter((h) => h.id !== id);
    return this.holdings.length < before;
  }

  addWatch(w: Omit<WatchItem, "id" | "created_at">): WatchItem {
    const item: WatchItem = { ...w, id: randomUUID(), created_at: new Date().toISOString() };
    this.watchlist = this.watchlist.filter((x) => x.ticker !== w.ticker);
    this.watchlist.push(item);
    return item;
  }
  deleteWatch(id: string): boolean {
    const before = this.watchlist.length;
    this.watchlist = this.watchlist.filter((w) => w.id !== id);
    return this.watchlist.length < before;
  }
}

// Persist across hot reloads in dev
const g = globalThis as unknown as { __memStore?: MemoryStore };
export const memStore = g.__memStore ?? (g.__memStore = new MemoryStore());

// Seed a couple of example rows so the UI isn't empty on first run
if (memStore.holdings.length === 0) {
  memStore.addHolding({ ticker: "NVDA", shares: 20, avg_cost: 95, thesis: "AI data-center compute leader; durable moat via CUDA.", target_price: 180 });
  memStore.addHolding({ ticker: "MSFT", shares: 15, avg_cost: 380, thesis: "Azure + Copilot monetization; wide moat.", target_price: 520 });
}
if (memStore.watchlist.length === 0) {
  memStore.addWatch({ ticker: "AMD", reason: "AI GPU share gains; watching for base breakout.", alert_price: 180 });
  memStore.addWatch({ ticker: "AVGO", reason: "Custom silicon + VMware; buy on pullback to 20-EMA.", alert_price: 200 });
}
