// Which holdings are still owned.
//
// A row that has been sold stays in the book as history — the holdings table
// shows it with its closing date — but it must not reach anything that
// describes the portfolio as it stands now. A closed position that still feeds
// the dividend calendar promises income from shares nobody owns; one that still
// feeds NAV overstates the book and, with it, understates every weight measured
// against NAV.
//
// Closed means either an explicit closing date or a zero share count.

export interface Closable {
  shares?: number | null;
  closed_at?: string | null;
}

export function isOpen(h: Closable): boolean {
  if (h.closed_at) return false;
  return (h.shares ?? 0) > 0;
}

export function openOnly<T extends Closable>(rows: T[]): T[] {
  return rows.filter(isOpen);
}
