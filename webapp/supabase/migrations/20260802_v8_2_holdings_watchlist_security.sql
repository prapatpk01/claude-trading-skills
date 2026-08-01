-- Sentinel Investment v8.2 — holdings/watchlist security and integrity
-- Safe to re-run. Public clients may read, but only service_role can write.

begin;

-- Data integrity constraints. Existing production rows satisfy these gates.
alter table public.holdings
  drop constraint if exists holdings_ticker_format_chk,
  drop constraint if exists holdings_shares_positive_chk,
  drop constraint if exists holdings_avg_cost_nonnegative_chk,
  drop constraint if exists holdings_target_price_positive_chk;

alter table public.holdings
  add constraint holdings_ticker_format_chk
    check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$') not valid,
  add constraint holdings_shares_positive_chk
    check (shares > 0) not valid,
  add constraint holdings_avg_cost_nonnegative_chk
    check (avg_cost >= 0) not valid,
  add constraint holdings_target_price_positive_chk
    check (target_price is null or target_price > 0) not valid;

alter table public.holdings validate constraint holdings_ticker_format_chk;
alter table public.holdings validate constraint holdings_shares_positive_chk;
alter table public.holdings validate constraint holdings_avg_cost_nonnegative_chk;
alter table public.holdings validate constraint holdings_target_price_positive_chk;

alter table public.watchlist
  drop constraint if exists watchlist_ticker_format_chk,
  drop constraint if exists watchlist_alert_price_positive_chk,
  drop constraint if exists watchlist_target_price_positive_chk,
  drop constraint if exists watchlist_stop_price_positive_chk,
  drop constraint if exists watchlist_entry_price_positive_chk;

alter table public.watchlist
  add constraint watchlist_ticker_format_chk
    check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$') not valid,
  add constraint watchlist_alert_price_positive_chk
    check (alert_price is null or alert_price > 0) not valid,
  add constraint watchlist_target_price_positive_chk
    check (target_price is null or target_price > 0) not valid,
  add constraint watchlist_stop_price_positive_chk
    check (stop_price is null or stop_price > 0) not valid,
  add constraint watchlist_entry_price_positive_chk
    check (entry_price is null or entry_price > 0) not valid;

alter table public.watchlist validate constraint watchlist_ticker_format_chk;
alter table public.watchlist validate constraint watchlist_alert_price_positive_chk;
alter table public.watchlist validate constraint watchlist_target_price_positive_chk;
alter table public.watchlist validate constraint watchlist_stop_price_positive_chk;
alter table public.watchlist validate constraint watchlist_entry_price_positive_chk;

create unique index if not exists idx_watchlist_ticker_unique
  on public.watchlist (ticker);
create index if not exists idx_holdings_open_ticker
  on public.holdings (ticker) where closed_at is null;

alter table public.holdings enable row level security;
alter table public.watchlist enable row level security;

drop policy if exists "anon full access holdings" on public.holdings;
drop policy if exists "anon full access watchlist" on public.watchlist;
drop policy if exists "public read holdings" on public.holdings;
drop policy if exists "public read watchlist" on public.watchlist;

create policy "public read holdings"
  on public.holdings for select
  to anon, authenticated
  using (true);

create policy "public read watchlist"
  on public.watchlist for select
  to anon, authenticated
  using (true);

-- service_role bypasses RLS. Explicitly remove table writes from browser roles.
revoke insert, update, delete, truncate on table public.holdings from anon, authenticated;
revoke insert, update, delete, truncate on table public.watchlist from anon, authenticated;
grant select on table public.holdings to anon, authenticated;
grant select on table public.watchlist to anon, authenticated;

-- This helper has no reason to be callable through the public RPC surface.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
