-- Sentinel Investment v8.3 cash ledger and portfolio audit
-- Applied to production Supabase on 2026-08-02.

create table if not exists public.cash_ledger (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null check (entry_type in ('DEPOSIT','WITHDRAWAL','BUY','SELL','DIVIDEND','TAX','FEE','ADJUSTMENT')),
  amount numeric not null check (amount <> 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  entry_date date not null default current_date,
  ticker text null check (ticker is null or ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  transaction_id uuid null references public.portfolio_transactions(id) on delete cascade,
  dividend_id uuid null references public.dividend_ledger(id) on delete cascade,
  notes text null,
  created_at timestamptz not null default now(),
  constraint cash_ledger_sign_chk check (
    (entry_type in ('DEPOSIT','SELL','DIVIDEND') and amount > 0)
    or (entry_type in ('WITHDRAWAL','BUY','TAX','FEE') and amount < 0)
    or entry_type = 'ADJUSTMENT'
  )
);

create unique index if not exists idx_cash_ledger_transaction_unique
  on public.cash_ledger(transaction_id) where transaction_id is not null;
create unique index if not exists idx_cash_ledger_dividend_unique
  on public.cash_ledger(dividend_id) where dividend_id is not null;
create index if not exists idx_cash_ledger_date on public.cash_ledger(entry_date desc, created_at desc);

alter table public.cash_ledger enable row level security;
drop policy if exists "public read cash ledger" on public.cash_ledger;
create policy "public read cash ledger" on public.cash_ledger for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on table public.cash_ledger from anon, authenticated;
grant select on table public.cash_ledger to anon, authenticated;

-- Production migration also replaces execute_portfolio_trade() so every BUY/SELL
-- creates its matching cash entry in the same database transaction, and adds a
-- dividend trigger that records net dividend cash plus withholding tax.
