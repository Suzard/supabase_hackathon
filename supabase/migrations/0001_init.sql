-- Token Charity schema. All access is server-side with the service role key,
-- so RLS is enabled with no policies: anon and authenticated roles get nothing.

create extension if not exists pgcrypto;

create table donors (
  id          uuid primary key default gen_random_uuid(),
  email       text,
  created_at  timestamptz not null default now()
);

create table pool_keys (
  id                 uuid primary key default gen_random_uuid(),
  donor_id           uuid references donors(id) on delete set null,
  provider           text not null check (provider in ('openai', 'anthropic')),
  key_ciphertext     text not null,
  key_fingerprint    text not null unique,     -- sha256 of the key: rejects double donations
  key_hint           text not null,            -- last 4 chars, for the dashboard
  models             text[] not null default '{}', -- from the intake probe; what this key can serve
  status             text not null default 'live'
                     check (status in ('live', 'exhausted', 'invalid')),
  requests_served    integer not null default 0,
  tokens_served      bigint not null default 0,
  cost_absorbed_usd  numeric(14, 6) not null default 0,
  last_error         text,
  last_used_at       timestamptz,
  created_at         timestamptz not null default now()
);
create index pool_keys_provider_status on pool_keys (provider, status);

create table recipients (
  id            uuid primary key default gen_random_uuid(),
  email         text,
  label         text,
  api_key_hash  text not null unique,
  created_at    timestamptz not null default now()
);

create table usage (
  id                  uuid primary key default gen_random_uuid(),
  recipient_id        uuid references recipients(id) on delete set null,
  pool_key_id         uuid references pool_keys(id) on delete set null,
  provider            text not null,
  protocol            text not null,   -- anthropic-messages | openai-responses | openai-chat
  model               text not null,
  stream              boolean not null default false,
  tokens_input        integer not null default 0,  -- excludes cache reads and writes
  tokens_cache_read   integer not null default 0,
  tokens_cache_write  integer not null default 0,
  tokens_output       integer not null default 0,
  list_price_usd      numeric(14, 6) not null default 0,
  price_known         boolean not null default true,
  status_code         integer not null,
  error_body          text,          -- verbatim upstream body on non-2xx, to tune exhaustion matching
  decision            jsonb,         -- which decider ran, the ranking, probabilities, confidence
  attempt             integer not null default 1,
  latency_ms          integer,
  created_at          timestamptz not null default now()
);
create index usage_created_at on usage (created_at desc);

alter table donors     enable row level security;
alter table pool_keys  enable row level security;
alter table recipients enable row level security;
alter table usage      enable row level security;

-- Atomic counter bump after a served request.
create or replace function record_key_usage(
  p_key_id uuid, p_tokens bigint, p_cost numeric
) returns void language sql as $$
  update pool_keys
     set requests_served   = requests_served + 1,
         tokens_served     = tokens_served + p_tokens,
         cost_absorbed_usd = cost_absorbed_usd + p_cost,
         last_used_at      = now()
   where id = p_key_id;
$$;
