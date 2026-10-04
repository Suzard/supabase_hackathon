-- Persist crawled hackathon events so the app can serve a stable cache and prune stale entries.

create table if not exists hackathon_events (
  id           uuid primary key default gen_random_uuid(),
  external_id  text not null unique,
  title        text not null,
  city         text not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  url          text not null,
  source       text not null check (source in ('luma', 'seed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists hackathon_events_starts_at_idx on hackathon_events (starts_at asc);
create index if not exists hackathon_events_ends_at_idx on hackathon_events (ends_at asc);

alter table hackathon_events enable row level security;

create or replace function touch_hackathon_events_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_hackathon_events_updated_at on hackathon_events;
create trigger trg_touch_hackathon_events_updated_at
before update on hackathon_events
for each row
execute function public.touch_hackathon_events_updated_at();
