create extension if not exists pgcrypto;

create table if not exists public.tradingview_intelligence_events (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  event_type text not null default 'TECHNICAL',
  timeframe text,
  signal text,
  strategy text,
  price numeric,
  event_timestamp timestamptz,
  source text not null default 'TRADINGVIEW',
  eps_actual numeric,
  eps_estimate numeric,
  eps_surprise_pct numeric,
  revenue_actual numeric,
  revenue_estimate numeric,
  revenue_surprise_pct numeric,
  next_earnings_at timestamptz,
  fiscal_period text,
  ai_summary text,
  guidance text,
  financials jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  constraint tradingview_event_type_check check (
    event_type in ('TECHNICAL','EARNINGS','FINANCIAL','EARNINGS_FINANCIAL')
  )
);

create index if not exists tradingview_intelligence_ticker_received_idx
  on public.tradingview_intelligence_events (ticker, received_at desc);

create index if not exists tradingview_intelligence_event_received_idx
  on public.tradingview_intelligence_events (event_type, received_at desc);

alter table public.tradingview_intelligence_events enable row level security;

comment on table public.tradingview_intelligence_events is
  'Server-only TradingView technical/earnings/financial intelligence for Sentinel Research OS. No public RLS policies.';
