create extension if not exists pgcrypto;

create table if not exists public.analysis_actions (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  action text not null check (action in ('WATCHLIST','COMMITTEE')),
  rating text,
  conviction numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analysis_actions_ticker_created_idx on public.analysis_actions(ticker,created_at desc);

create table if not exists public.analysis_performance (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  analysis_date date not null default current_date,
  rating text not null,
  entry_price numeric,
  target_price numeric,
  stop_loss numeric,
  conviction numeric,
  status text not null default 'OPEN' check (status in ('OPEN','WON','LOST','EXPIRED','CANCELLED')),
  return_pct numeric,
  review_30d numeric,
  review_90d numeric,
  review_180d numeric,
  review_365d numeric,
  created_at timestamptz not null default now()
);

create index if not exists analysis_performance_ticker_date_idx on public.analysis_performance(ticker,analysis_date desc);
