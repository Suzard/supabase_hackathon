alter table donors add column if not exists display_name text;
alter table pool_keys add column if not exists expires_at timestamptz;

create index if not exists pool_keys_expires_at_idx on pool_keys (expires_at);
