-- Sentinel Investment OS v13
-- Ledger-first portfolio architecture.
-- portfolio_transactions is the source of truth; holdings is a rebuildable projection.

alter table public.portfolio_transactions add column if not exists source text not null default 'TRADE';

create table if not exists public.portfolio_reconciliations (
  id uuid primary key default gen_random_uuid(),
  holding_id uuid not null references public.holdings(id) on delete cascade,
  ticker text not null,
  previous_shares numeric not null,
  corrected_shares numeric not null,
  previous_avg_cost numeric not null,
  corrected_avg_cost numeric not null,
  reason text,
  reconciled_at timestamptz not null default now()
);

create or replace function public.sync_holding_projection(p_holding_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_net numeric;
  v_avg numeric;
  v_last_date date;
begin
  select
    round(coalesce(sum(case when side='BUY' then shares else -shares end),0),7),
    case when coalesce(sum(case when side='BUY' then shares else 0 end),0)>0
      then sum(case when side='BUY' then shares*price else 0 end)/sum(case when side='BUY' then shares else 0 end)
      else 0 end,
    max(trade_date)
  into v_net,v_avg,v_last_date
  from public.portfolio_transactions
  where holding_id=p_holding_id;

  update public.holdings
  set shares=greatest(v_net,0),
      avg_cost=coalesce(v_avg,avg_cost),
      closed_at=case when v_net<=0 then coalesce(v_last_date,current_date) else null end,
      updated_at=now()
  where id=p_holding_id;
end;
$$;

create or replace function public.sync_holding_projection_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.sync_holding_projection(coalesce(new.holding_id,old.holding_id));
  return coalesce(new,old);
end;
$$;

drop trigger if exists portfolio_transactions_sync_holding on public.portfolio_transactions;
create trigger portfolio_transactions_sync_holding
after insert or update or delete on public.portfolio_transactions
for each row execute function public.sync_holding_projection_trigger();

create or replace view public.live_holdings_ledger as
select h.*,
       coalesce(t.buy_shares,0) as ledger_buy_shares,
       coalesce(t.sell_shares,0) as ledger_sell_shares,
       round(coalesce(t.buy_shares,0)-coalesce(t.sell_shares,0),7) as ledger_shares
from public.holdings h
left join (
  select holding_id,
         sum(case when side='BUY' then shares else 0 end) as buy_shares,
         sum(case when side='SELL' then shares else 0 end) as sell_shares
  from public.portfolio_transactions
  group by holding_id
) t on t.holding_id=h.id
where round(coalesce(t.buy_shares,0)-coalesce(t.sell_shares,0),7)>0 and h.closed_at is null;

create or replace view public.closed_positions_ledger as
select h.id,h.ticker,h.opened_at,h.closed_at,h.avg_cost,
       coalesce(t.buy_shares,0) as total_bought,
       coalesce(t.sell_shares,0) as total_sold,
       coalesce(t.realized_pnl,0) as realized_pnl
from public.holdings h
join (
  select holding_id,
         sum(case when side='BUY' then shares else 0 end) as buy_shares,
         sum(case when side='SELL' then shares else 0 end) as sell_shares,
         sum(coalesce(realized_pnl,0)) as realized_pnl
  from public.portfolio_transactions
  group by holding_id
) t on t.holding_id=h.id
where round(coalesce(t.buy_shares,0)-coalesce(t.sell_shares,0),7)<=0 or h.closed_at is not null;

create or replace function public.reconcile_holding_from_broker(
  p_holding_id uuid,
  p_shares numeric,
  p_avg_cost numeric,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_h public.holdings%rowtype;
  v_open public.portfolio_transactions%rowtype;
  v_trade_buys numeric;
  v_sells numeric;
  v_opening_shares numeric;
begin
  if p_shares is null or p_shares < 0 then raise exception 'Shares must be zero or greater'; end if;
  if round(p_shares,7)<>p_shares then raise exception 'Shares support up to 7 decimal places'; end if;
  if p_avg_cost is null or p_avg_cost < 0 then raise exception 'Average cost must be non-negative'; end if;

  select * into v_h from public.holdings where id=p_holding_id for update;
  if not found then raise exception 'Holding not found'; end if;

  select * into v_open from public.portfolio_transactions
  where holding_id=p_holding_id and source='OPENING_BALANCE'
  order by created_at asc limit 1 for update;
  if not found then raise exception 'Opening balance transaction missing'; end if;

  select
    coalesce(sum(case when side='BUY' and source<>'OPENING_BALANCE' then shares else 0 end),0),
    coalesce(sum(case when side='SELL' then shares else 0 end),0)
  into v_trade_buys,v_sells
  from public.portfolio_transactions where holding_id=p_holding_id;

  v_opening_shares:=round(p_shares+v_sells-v_trade_buys,7);
  if v_opening_shares<0 then raise exception 'Corrected shares conflict with recorded trades'; end if;

  insert into public.portfolio_reconciliations(
    holding_id,ticker,previous_shares,corrected_shares,previous_avg_cost,corrected_avg_cost,reason
  ) values(
    v_h.id,v_h.ticker,v_h.shares,p_shares,v_h.avg_cost,p_avg_cost,nullif(trim(p_reason),'')
  );

  update public.portfolio_transactions
  set shares=v_opening_shares,price=p_avg_cost,
      notes=concat('Opening balance reconciled',case when nullif(trim(p_reason),'') is not null then ': '||trim(p_reason) else '' end)
  where id=v_open.id;

  perform public.sync_holding_projection(v_h.id);
  select * into v_h from public.holdings where id=p_holding_id;
  return jsonb_build_object('holding',to_jsonb(v_h),'reconciled',true,'ledgerOpeningShares',v_opening_shares);
end;
$$;
