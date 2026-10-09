const { createClient } = require("@supabase/supabase-js");

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "[supabase] WARNING — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set. " +
      "Orders, customers and conversations will fail to read/write."
  );
}

// service_role bypasses RLS — this client must only ever be used server-side.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

module.exports = { supabase };
