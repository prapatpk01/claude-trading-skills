-- ══════════════════════════════════════════════════════════════════════
--  Equity Research Web — Supabase schema
--  Run this in the Supabase SQL editor (Dashboard → SQL → New query).
-- ══════════════════════════════════════════════════════════════════════

-- ── Portfolio holdings ────────────────────────────────────────────────
create table if not exists public.holdings (
  id            uuid primary key default gen_random_uuid(),
  ticker        text        not null,
  shares        numeric     not null default 0,
  avg_cost      numeric     not null default 0,          -- average cost basis per share
  notes         text,
  thesis        text,                                    -- rolling investment thesis
  target_price  numeric,                                 -- personal target
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Watchlist ─────────────────────────────────────────────────────────
create table if not exists public.watchlist (
  id            uuid primary key default gen_random_uuid(),
  ticker        text        not null unique,
  reason        text,                                    -- why it's being watched
  alert_price   numeric,                                 -- price level of interest
  created_at    timestamptz not null default now()
);

-- ── Analysis snapshots (optional history of ticker analyses) ──────────
create table if not exists public.analysis_snapshots (
  id            uuid primary key default gen_random_uuid(),
  ticker        text        not null,
  snapshot      jsonb       not null,                    -- full analysis payload
  target_price  numeric,
  signal        text,                                    -- BUY / HOLD / SELL
  created_at    timestamptz not null default now()
);

create index if not exists idx_snapshots_ticker on public.analysis_snapshots (ticker, created_at desc);

-- keep updated_at fresh on holdings
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_holdings_touch on public.holdings;
create trigger trg_holdings_touch
  before update on public.holdings
  for each row execute function public.touch_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────
-- This MVP is single-tenant (personal use). RLS is enabled and the anon
-- key is allowed full access. For multi-user, replace these policies with
-- auth.uid()-scoped rules and add a user_id column to each table.
alter table public.holdings           enable row level security;
alter table public.watchlist          enable row level security;
alter table public.analysis_snapshots enable row level security;

drop policy if exists "anon full access holdings"  on public.holdings;
drop policy if exists "anon full access watchlist" on public.watchlist;
drop policy if exists "anon full access snapshots" on public.analysis_snapshots;

create policy "anon full access holdings"  on public.holdings           for all using (true) with check (true);
create policy "anon full access watchlist" on public.watchlist          for all using (true) with check (true);
create policy "anon full access snapshots" on public.analysis_snapshots for all using (true) with check (true);

-- ══════════════════════════════════════════════════════════════════════
--  Migration — position dates (safe to run on an existing database)
--  Adds when a position was opened and, if it has been exited, closed.
-- ══════════════════════════════════════════════════════════════════════
alter table public.holdings add column if not exists opened_at date;
alter table public.holdings add column if not exists closed_at date;

-- Backfill the open date for existing rows from when they were recorded.
update public.holdings set opened_at = created_at::date where opened_at is null;

-- PostgREST caches the schema; reload it so the new columns are visible.
notify pgrst, 'reload schema';
