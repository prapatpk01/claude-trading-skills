-- Investment committee minutes.
--
-- Stage 5 of the meeting: what a human approved, what was applied to the
-- ledger, and what was not. The ledger itself remains the source of truth for
-- positions — this table is the record of the decision that produced them, so
-- a position can be traced back to the meeting that authorised it.
--
-- meeting_id is unique: a meeting applies once. The route refuses a second
-- submission for the same id unless it is explicitly told to supersede.

create table if not exists public.committee_minutes (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   text not null,
  approved_by  text not null,
  as_of        timestamptz not null default now(),

  -- The meeting as it stood when it was approved.
  regime       jsonb,
  quorum       jsonb,
  agenda       jsonb,
  minutes      jsonb,
  resolutions  jsonb,
  dissent      jsonb,

  -- The human's verdict per line, and what came of it.
  decisions    jsonb not null,
  applied      jsonb not null default '[]'::jsonb,
  skipped      jsonb not null default '[]'::jsonb,
  failed       jsonb not null default '[]'::jsonb,

  created_at   timestamptz not null default now()
);

create unique index if not exists committee_minutes_meeting_id_key
  on public.committee_minutes (meeting_id);
create index if not exists committee_minutes_created_at_idx
  on public.committee_minutes (created_at desc);

alter table public.committee_minutes enable row level security;

-- Minutes are readable by the application and written only through the API,
-- which requires an explicit human approval flag and an approver name.
drop policy if exists committee_minutes_read on public.committee_minutes;
create policy committee_minutes_read
  on public.committee_minutes for select
  using (true);

drop policy if exists committee_minutes_insert on public.committee_minutes;
create policy committee_minutes_insert
  on public.committee_minutes for insert
  with check (approved_by is not null and length(trim(approved_by)) > 0);

comment on table public.committee_minutes is
  'Investment committee meeting records. One row per approved meeting; the ledger holds the resulting positions.';
