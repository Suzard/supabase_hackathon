-- Cover the foreign keys flagged by Supabase's performance advisor.
create index pool_keys_donor_id on pool_keys (donor_id);
create index usage_pool_key_id on usage (pool_key_id);
create index usage_recipient_id on usage (recipient_id);
