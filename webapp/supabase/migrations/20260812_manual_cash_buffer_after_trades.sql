-- Cash Buffer is broker-reconciled manually.
-- Recording a BUY/SELL updates Holdings and the transaction ledger only.
-- It deliberately does not infer broker cash from shares * price because
-- commissions, fees, FX, settlement timing and broker rounding may differ.

create or replace function public.execute_portfolio_trade(
  p_ticker text,
  p_side text,
  p_shares numeric,
  p_price numeric,
  p_trade_date date,
  p_notes text default null::text,
  p_thesis text default null::text,
  p_target_price numeric default null::numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ticker text := upper(trim(p_ticker));
  v_side text := upper(trim(p_side));
  v_holding public.holdings%rowtype;
  v_tx public.portfolio_transactions%rowtype;
  v_new_shares numeric;
  v_new_avg numeric;
  v_realized numeric;
  v_closed boolean := false;
begin
  if v_ticker !~ '^[A-Z][A-Z0-9.-]{0,9}$' then raise exception 'Invalid ticker'; end if;
  if v_side not in ('BUY','SELL') then raise exception 'Side must be BUY or SELL'; end if;
  if p_shares is null or p_shares <= 0 then raise exception 'Shares must be greater than zero'; end if;
  if p_price is null or p_price < 0 then raise exception 'Price must be non-negative'; end if;
  if round(p_shares, 7) <> p_shares then raise exception 'Shares support up to 7 decimal places'; end if;

  select * into v_holding
  from public.holdings
  where ticker = v_ticker and closed_at is null
  for update;

  if v_side = 'BUY' then
    if found then
      v_new_shares := round(v_holding.shares + p_shares, 7);
      v_new_avg := ((v_holding.shares * v_holding.avg_cost) + (p_shares * p_price)) / v_new_shares;
      update public.holdings set
        shares = v_new_shares,
        avg_cost = v_new_avg,
        target_price = coalesce(p_target_price, target_price),
        thesis = coalesce(nullif(trim(p_thesis), ''), thesis),
        notes = coalesce(nullif(trim(p_notes), ''), notes),
        opened_at = coalesce(opened_at, p_trade_date),
        closed_at = null
      where id = v_holding.id
      returning * into v_holding;
    else
      insert into public.holdings(ticker, shares, avg_cost, target_price, thesis, notes, opened_at, closed_at)
      values(v_ticker, round(p_shares,7), p_price, p_target_price, nullif(trim(p_thesis),''), nullif(trim(p_notes),''), p_trade_date, null)
      returning * into v_holding;
    end if;

    insert into public.portfolio_transactions(holding_id, ticker, side, shares, price, trade_date, realized_pnl, notes)
    values(v_holding.id, v_ticker, 'BUY', round(p_shares,7), p_price, p_trade_date, null, nullif(trim(p_notes),''))
    returning * into v_tx;
  else
    if not found then raise exception '% has no open holding to sell', v_ticker; end if;
    if p_shares > v_holding.shares then raise exception 'Cannot sell % shares; only % are held', p_shares, v_holding.shares; end if;

    v_new_shares := round(v_holding.shares - p_shares, 7);
    v_realized := (p_price - v_holding.avg_cost) * p_shares;
    v_closed := v_new_shares = 0;

    if v_closed then
      update public.holdings set
        shares = 0,
        closed_at = p_trade_date,
        notes = coalesce(nullif(trim(p_notes), ''), notes)
      where id = v_holding.id
      returning * into v_holding;
    else
      update public.holdings set
        shares = v_new_shares,
        notes = coalesce(nullif(trim(p_notes), ''), notes)
      where id = v_holding.id
      returning * into v_holding;
    end if;

    insert into public.portfolio_transactions(holding_id, ticker, side, shares, price, trade_date, realized_pnl, notes)
    values(v_holding.id, v_ticker, 'SELL', round(p_shares,7), p_price, p_trade_date, v_realized, nullif(trim(p_notes),''))
    returning * into v_tx;
  end if;

  return jsonb_build_object(
    'holding', to_jsonb(v_holding),
    'transaction', to_jsonb(v_tx),
    'cashEntry', null,
    'cashMode', 'MANUAL_BROKER_BALANCE',
    'cashUnchanged', true,
    'closed', v_closed,
    'remainingShares', case when v_closed then 0 else v_holding.shares end,
    'realizedPnl', v_realized
  );
end;
$function$;
