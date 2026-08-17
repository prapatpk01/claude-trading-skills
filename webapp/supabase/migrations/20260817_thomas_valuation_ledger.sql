create table if not exists public.thomas_valuation_ledger (
  ticker text primary key,
  status text not null check (status in ('COMPLETE','INCOMPLETE')),
  model_route text not null,
  source text not null,
  current_price numeric not null,
  fair_value numeric,
  bear_value numeric,
  bull_value numeric,
  valuation_gap_pct numeric,
  verdict text,
  confidence text not null check (confidence in ('HIGH','MEDIUM','LOW')),
  anchors jsonb not null default '[]'::jsonb,
  note text not null default '',
  warnings jsonb not null default '[]'::jsonb,
  as_of timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists thomas_valuation_ledger_expiry_idx
  on public.thomas_valuation_ledger(expires_at);

alter table public.thomas_valuation_ledger enable row level security;

drop policy if exists "read Thomas valuation ledger" on public.thomas_valuation_ledger;
create policy "read Thomas valuation ledger"
  on public.thomas_valuation_ledger for select using (true);

revoke insert, update, delete, truncate on table public.thomas_valuation_ledger from anon, authenticated;
grant select on table public.thomas_valuation_ledger to anon, authenticated;
