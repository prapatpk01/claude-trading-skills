-- Sentinel v10.5 — compact, tiered committee memory.
create table if not exists public.committee_meetings (
  id uuid primary key default gen_random_uuid(),
  meeting_code text not null unique,
  status text not null default 'APPROVED',
  summary jsonb not null default '{}'::jsonb,
  resolution jsonb not null default '[]'::jsonb,
  actual jsonb not null default '[]'::jsonb,
  variance jsonb not null default '{}'::jsonb,
  portfolio_before jsonb not null default '{}'::jsonb,
  portfolio_after jsonb not null default '{}'::jsonb,
  macro jsonb not null default '{}'::jsonb,
  learning jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_committee_meetings_created on public.committee_meetings(created_at desc);
create index if not exists idx_committee_meetings_status on public.committee_meetings(status,created_at desc);
alter table public.committee_meetings enable row level security;
drop policy if exists "anon read committee meetings" on public.committee_meetings;
create policy "anon read committee meetings" on public.committee_meetings for select using (true);
-- Writes are performed with SUPABASE_SERVICE_ROLE_KEY only.
notify pgrst,'reload schema';
