-- Stripe invoices for what recipients owe (5% of list price), issued when unbilled
-- charges cross a threshold. A usage row belongs to at most one invoice.

create table invoices (
  id                  uuid primary key default gen_random_uuid(),
  recipient_id        uuid not null references recipients(id) on delete cascade,
  amount_usd          numeric(18, 10) not null default 0,  -- exact sum of the claimed usage rows
  amount_cents        integer not null default 0,          -- what Stripe bills
  request_count       integer not null default 0,
  status              text not null default 'pending'
                      check (status in ('pending', 'open', 'paid', 'void', 'uncollectible', 'failed')),
  stripe_invoice_id   text unique,
  hosted_invoice_url  text,
  error               text,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);
create index invoices_recipient_id on invoices (recipient_id);
alter table invoices enable row level security;

alter table usage add column invoice_id uuid references invoices(id) on delete set null;
create index usage_invoice_id on usage (invoice_id);
create index usage_unbilled on usage (recipient_id) where invoice_id is null;

-- Claims a recipient's unbilled usage into a new pending invoice once it reaches p_min_usd.
-- The cheap sum check runs first so ordinary requests never write. The claim itself tags
-- rows and sums exactly the rows it tagged, so a request arriving mid-claim is either on
-- this invoice or left unbilled for the next one, never both.
create or replace function claim_unbilled(p_recipient uuid, p_min_usd numeric)
returns table (invoice_id uuid, amount_usd numeric, amount_cents integer, request_count integer)
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
  v_total numeric;
  v_count integer;
begin
  if (select coalesce(sum(u.charged_usd), 0) from public.usage u
       where u.recipient_id = p_recipient and u.invoice_id is null) < p_min_usd then
    return;
  end if;

  -- One claim at a time per recipient.
  perform pg_advisory_xact_lock(hashtext('claim_unbilled:' || p_recipient::text));

  insert into public.invoices (recipient_id) values (p_recipient) returning id into v_id;
  with claimed as (
    update public.usage u set invoice_id = v_id
     where u.recipient_id = p_recipient and u.invoice_id is null
    returning u.charged_usd
  )
  select coalesce(sum(charged_usd), 0), count(*) into v_total, v_count from claimed;

  if v_total < p_min_usd then
    -- Another claim got there first.
    update public.usage set invoice_id = null where public.usage.invoice_id = v_id;
    delete from public.invoices where id = v_id;
    return;
  end if;

  update public.invoices
     set amount_usd = v_total, amount_cents = round(v_total * 100)::integer, request_count = v_count
   where id = v_id;
  return query select v_id, v_total, round(v_total * 100)::integer, v_count;
end;
$$;

-- Returns an invoice's usage to the unbilled pool when Stripe issuance fails; the
-- invoice row stays as a record of the failure.
create or replace function release_invoice(p_invoice uuid, p_error text)
returns void language sql set search_path = '' as $$
  update public.usage set invoice_id = null where invoice_id = p_invoice;
  update public.invoices set status = 'failed', error = p_error where id = p_invoice;
$$;

revoke execute on function claim_unbilled(uuid, numeric) from public, anon, authenticated;
revoke execute on function release_invoice(uuid, text) from public, anon, authenticated;
grant execute on function claim_unbilled(uuid, numeric) to service_role;
grant execute on function release_invoice(uuid, text) to service_role;
