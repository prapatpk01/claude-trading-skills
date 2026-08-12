create or replace function public.sentinel_cash_summary()
returns table (
  investment_cash numeric,
  dividend_gross_cash numeric,
  dividend_tax numeric,
  dividend_net numeric,
  dividend_withdrawn numeric,
  dividend_available numeric,
  realized_investment_profit numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with totals as (
    select
      coalesce(sum(case
        when entry_type = 'DIVIDEND' then 0
        when entry_type = 'TAX' then 0
        when entry_type = 'WITHDRAWAL' and coalesce(notes, '') like '%[DIVIDEND_WITHDRAWAL]%' then 0
        else amount
      end), 0)::numeric as investment_cash,
      coalesce(sum(case when entry_type = 'DIVIDEND' then greatest(amount, 0) else 0 end), 0)::numeric as dividend_gross_cash,
      coalesce(sum(case when entry_type = 'TAX' then abs(least(amount, 0)) else 0 end), 0)::numeric as dividend_tax,
      coalesce(sum(case when entry_type = 'WITHDRAWAL' and coalesce(notes, '') like '%[DIVIDEND_WITHDRAWAL]%' then abs(least(amount, 0)) else 0 end), 0)::numeric as dividend_withdrawn
    from public.cash_ledger
  )
  select
    investment_cash,
    dividend_gross_cash,
    dividend_tax,
    greatest(0::numeric, dividend_gross_cash - dividend_tax) as dividend_net,
    dividend_withdrawn,
    greatest(0::numeric, greatest(0::numeric, dividend_gross_cash - dividend_tax) - dividend_withdrawn) as dividend_available,
    dividend_withdrawn as realized_investment_profit
  from totals;
$$;

grant execute on function public.sentinel_cash_summary() to anon, authenticated, service_role;
