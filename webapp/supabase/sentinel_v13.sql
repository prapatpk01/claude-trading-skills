create table if not exists portfolio_nav_history (
  id uuid primary key default gen_random_uuid(),
  nav_date date not null unique,
  nav numeric not null check (nav >= 0),
  cash_flow numeric not null default 0,
  benchmark_spy numeric,
  benchmark_qqq numeric,
  benchmark_acwi numeric,
  source text not null default 'portfolio-ledger',
  created_at timestamptz not null default now()
);

create table if not exists watchlist_events (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  event_type text not null check (event_type in ('SCORE_CHANGE','VALUATION','MOMENTUM','EARNINGS','THESIS','RISK','PROMOTION','REMOVAL')),
  score_before numeric,
  score_after numeric,
  message text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists committee_decision_memory (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid,
  ticker text,
  decision text not null,
  rationale text not null,
  votes jsonb not null default '[]'::jsonb,
  scenario_before jsonb not null default '{}'::jsonb,
  scenario_after jsonb not null default '{}'::jsonb,
  outcome_status text not null default 'OPEN',
  outcome_return_pct numeric,
  review_date date,
  created_at timestamptz not null default now()
);

create table if not exists fund_operating_timeline (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('RESEARCH','ANALYSIS','WATCHLIST','COMMITTEE','APPROVAL','TRADE','DIVIDEND','RECONCILIATION','PERFORMANCE','ALERT')),
  ticker text,
  reference_id text,
  title text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_watchlist_events_ticker_created on watchlist_events(ticker,created_at desc);
create index if not exists idx_committee_memory_ticker_created on committee_decision_memory(ticker,created_at desc);
create index if not exists idx_operating_timeline_created on fund_operating_timeline(created_at desc);
