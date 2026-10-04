alter table donors add column if not exists oauth_provider text;
alter table donors add column if not exists oauth_subject text;

create unique index if not exists donors_oauth_identity_unique
  on donors (oauth_provider, oauth_subject)
  where oauth_provider is not null and oauth_subject is not null;
