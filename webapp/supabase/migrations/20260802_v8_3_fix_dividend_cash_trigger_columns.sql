-- Align the cash-ledger trigger with dividend_ledger's production columns.
create or replace function public.sync_dividend_cash_ledger() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into public.cash_ledger(entry_type,amount,entry_date,ticker,dividend_id,notes)
    values('DIVIDEND',new.net_amount,new.pay_date,new.ticker,new.id,'Net dividend received');
    if new.withholding_tax > 0 then
      insert into public.cash_ledger(entry_type,amount,entry_date,ticker,notes)
      values('TAX',-new.withholding_tax,new.pay_date,new.ticker,'Dividend withholding tax · dividend '||new.id::text);
    end if;
    return new;
  elsif tg_op='DELETE' then
    delete from public.cash_ledger
    where dividend_id=old.id or notes='Dividend withholding tax · dividend '||old.id::text;
    return old;
  end if;
  return null;
end;
$$;
