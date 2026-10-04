// Clears all donated jars (pool keys) from Supabase.
// Usage: node --env-file=.env.local scripts/clear-jars.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRole) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

const supabase = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const before = await supabase.from("pool_keys").select("id", { count: "exact", head: true });
if (before.error) {
  console.error("Failed to read current jars:", before.error.message);
  process.exit(1);
}

const del = await supabase
  .from("pool_keys")
  .delete()
  // no-op-safe predicate to target all real UUID rows without using raw SQL
  .neq("id", "00000000-0000-0000-0000-000000000000");

if (del.error) {
  console.error("Failed to clear jars:", del.error.message);
  process.exit(1);
}

const after = await supabase.from("pool_keys").select("id", { count: "exact", head: true });
if (after.error) {
  console.error("Failed to verify jars:", after.error.message);
  process.exit(1);
}

const beforeCount = before.count ?? 0;
const afterCount = after.count ?? 0;

console.log(
  JSON.stringify(
    {
      before: beforeCount,
      after: afterCount,
      deleted: beforeCount - afterCount,
    },
    null,
    2,
  ),
);
