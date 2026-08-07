-- Applied to Supabase production project jsxoydianiehgrwtaaas on 2026-08-07.
-- Keeps database hardening and Watchlist V14 schema reproducible.

alter view public.live_holdings_ledger set (security_invoker = true);
alter view public.closed_positions_ledger set (security_invoker = true);

drop index if exists public.idx_watchlist_ticker_unique;

revoke all on function public.execute_portfolio_trade(text,text,numeric,numeric,date,text,text,numeric) from public, anon, authenticated;
grant execute on function public.execute_portfolio_trade(text,text,numeric,numeric,date,text,text,numeric) to service_role;
revoke all on function public.reconcile_holding_from_broker(uuid,numeric,numeric,text) from public, anon, authenticated;
grant execute on function public.reconcile_holding_from_broker(uuid,numeric,numeric,text) to service_role;
revoke all on function public.sync_dividend_cash_ledger() from public, anon, authenticated;
grant execute on function public.sync_dividend_cash_ledger() to service_role;
revoke all on function public.sync_holding_projection(uuid) from public, anon, authenticated;
grant execute on function public.sync_holding_projection(uuid) to service_role;
revoke all on function public.sync_holding_projection_trigger() from public, anon, authenticated;
grant execute on function public.sync_holding_projection_trigger() to service_role;

drop policy if exists "anon full access snapshots" on public.analysis_snapshots;
create policy "public read analysis snapshots" on public.analysis_snapshots for select to anon, authenticated using (true);

alter table public.watchlist add column if not exists stage text not null default 'RESEARCH';
alter table public.watchlist add column if not exists updated_at timestamptz not null default now();
alter table public.watchlist add column if not exists promoted_at timestamptz;
alter table public.watchlist add column if not exists archived_at timestamptz;
alter table public.watchlist drop constraint if exists watchlist_stage_check;
alter table public.watchlist add constraint watchlist_stage_check check (stage in ('RESEARCH','WATCH','READY','COMMITTEE','PROMOTED','REJECTED','ARCHIVED'));
create index if not exists idx_watchlist_stage on public.watchlist(stage);
create index if not exists idx_watchlist_updated_at on public.watchlist(updated_at desc);
create index if not exists idx_dividend_ledger_holding_id on public.dividend_ledger(holding_id);
create index if not exists idx_portfolio_reconciliations_holding_id on public.portfolio_reconciliations(holding_id);
