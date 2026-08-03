create table if not exists public.research_engine_performance (
  id uuid primary key default gen_random_uuid(),
  engine_id text not null,
  pick_id text not null unique,
  ticker text not null,
  proposed_at timestamptz not null default now(),
  horizon_days integer not null,
  entry_low numeric,
  entry_high numeric,
  stop_loss numeric,
  target1 numeric,
  target2 numeric,
  status text not null default 'OPEN' check (status in ('OPEN','WON','LOST','EXPIRED','CANCELLED')),
  entry_price numeric,
  exit_price numeric,
  max_gain_pct numeric,
  max_drawdown_pct numeric,
  realized_return_pct numeric,
  tp1_hit boolean not null default false,
  tp2_hit boolean not null default false,
  stop_hit boolean not null default false,
  closed_at timestamptz,
  outcome_reason text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists research_engine_performance_engine_idx on public.research_engine_performance(engine_id, proposed_at desc);
create index if not exists research_engine_performance_ticker_idx on public.research_engine_performance(ticker, proposed_at desc);

alter table public.research_engine_performance enable row level security;

create policy if not exists "read research performance" on public.research_engine_performance for select using (true);
