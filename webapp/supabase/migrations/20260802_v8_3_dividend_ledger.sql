begin;

create table if not exists public.dividend_ledger (
  id uuid primary key default gen_random_uuid(),
  holding_id uuid references public.holdings(id) on delete set null,
  ticker text not null,
  ex_date date,
  record_date date,
  pay_date date not null,
  shares_eligible numeric not null,
  gross_per_share numeric not null,
  gross_amount numeric not null,
  withholding_tax numeric not null default 0,
  net_amount numeric not null,
  currency text not null default 'USD',
  source text,
  notes text,
  created_at timestamptz not null default now(),
  constraint dividend_ledger_ticker_chk check (ticker ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  constraint dividend_ledger_shares_chk check (shares_eligible > 0),
  constraint dividend_ledger_per_share_chk check (gross_per_share >= 0),
  constraint dividend_ledger_gross_chk check (gross_amount >= 0),
  constraint dividend_ledger_tax_chk check (withholding_tax >= 0),
  constraint dividend_ledger_net_chk check (net_amount >= 0 and net_amount <= gross_amount),
  constraint dividend_ledger_currency_chk check (currency ~ '^[A-Z]{3}$')
);

create index if not exists idx_dividend_ledger_pay_date on public.dividend_ledger(pay_date desc);
create index if not exists idx_dividend_ledger_ticker on public.dividend_ledger(ticker, pay_date desc);
create unique index if not exists idx_dividend_ledger_unique_payment
  on public.dividend_ledger(ticker, pay_date, shares_eligible, gross_per_share);

alter table public.dividend_ledger enable row level security;
drop policy if exists "public read dividend ledger" on public.dividend_ledger;
create policy "public read dividend ledger"
  on public.dividend_ledger for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on table public.dividend_ledger from anon, authenticated;
grant select on table public.dividend_ledger to anon, authenticated;

notify pgrst, 'reload schema';
commit;
