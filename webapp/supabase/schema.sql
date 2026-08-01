-- ══════════════════════════════════════════════════════════════════════
--  Equity Research Web — Supabase schema
--  Run this in the Supabase SQL editor (Dashboard → SQL → New query).
-- ══════════════════════════════════════════════════════════════════════

-- ── Portfolio holdings ────────────────────────────────────────────────
create table if not exists public.holdings (
  id            uuid primary key default gen_random_uuid(),
  ticker        text        not null,
  shares        numeric     not null default 0,
  avg_cost      numeric     not null default 0,
  notes         text,
  thesis        text,
  target_price  numeric,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Watchlist ─────────────────────────────────────────────────────────
create table if not exists public.watchlist (
  id            uuid primary key default gen_random_uuid(),
  ticker        text        not null unique,
  reason        text,
  alert_price   numeric,
  created_at    timestamptz not null default now()
);

-- ── Analysis snapshots ────────────────────────────────────────────────
create table if not exists public.analysis_snapshots (
  id            uuid primary key default gen_random_uuid(),
  ticker        text        not null,
  snapshot      jsonb       not null,
  target_price  numeric,
  signal        text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_snapshots_ticker on public.analysis_snapshots (ticker, created_at desc);

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

alter table public.holdings           enable row level security;
alter table public.watchlist          enable row level security;
alter table public.analysis_snapshots enable row level security;

drop policy if exists "anon full access holdings"  on public.holdings;
drop policy if exists "anon full access watchlist" on public.watchlist;
drop policy if exists "anon full access snapshots" on public.analysis_snapshots;

create policy "anon full access holdings"  on public.holdings           for all using (true) with check (true);
create policy "anon full access watchlist" on public.watchlist          for all using (true) with check (true);
create policy "anon full access snapshots" on public.analysis_snapshots for all using (true) with check (true);

alter table public.holdings add column if not exists opened_at date;
alter table public.holdings add column if not exists closed_at date;
update public.holdings set opened_at = created_at::date where opened_at is null;

alter table public.watchlist add column if not exists target_price numeric;
alter table public.watchlist add column if not exists stop_price   numeric;
alter table public.watchlist add column if not exists entry_price  numeric;
alter table public.watchlist add column if not exists source       text;

-- ══════════════════════════════════════════════════════════════════════
-- Sentinel Capital v7.0 — immutable institutional decision audit trail
-- Every recommendation records evidence, independent votes, dissent,
-- governance blocks, portfolio context and the final CIO-approved action.
-- ══════════════════════════════════════════════════════════════════════
create table if not exists public.institutional_decisions (
  id                    uuid primary key default gen_random_uuid(),
  ticker                text not null,
  requested_action      text not null,
  final_action          text not null,
  approved              boolean not null default false,
  conviction            numeric not null default 0,
  confidence            numeric not null default 0,
  proposed_weight_pct   numeric not null default 0,
  funding_source        text not null default 'NONE',
  evidence              jsonb not null default '[]'::jsonb,
  votes                 jsonb not null default '[]'::jsonb,
  issues                jsonb not null default '[]'::jsonb,
  dissent               jsonb not null default '[]'::jsonb,
  portfolio_context     jsonb not null default '{}'::jsonb,
  audit                  jsonb not null default '{}'::jsonb,
  human_approved        boolean not null default false,
  human_approved_at     timestamptz,
  human_approved_by     text,
  execution_status      text not null default 'PENDING_APPROVAL',
  created_at            timestamptz not null default now()
);

create index if not exists idx_institutional_decisions_ticker
  on public.institutional_decisions (ticker, created_at desc);
create index if not exists idx_institutional_decisions_action
  on public.institutional_decisions (final_action, created_at desc);

alter table public.institutional_decisions enable row level security;
drop policy if exists "anon full access institutional decisions" on public.institutional_decisions;
create policy "anon full access institutional decisions"
  on public.institutional_decisions for all using (true) with check (true);

notify pgrst, 'reload schema';
