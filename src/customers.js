// Persistent customer profiles, keyed by WhatsApp number (the number itself
// is the unique id) — separate from the ephemeral per-order session in
// session.js. Survives across orders so returning customers never have to
// re-enter name/address. Backed by Supabase so registrations survive restarts.
const { supabase } = require("./supabaseClient");

function rowToCustomer(row) {
  if (!row) return undefined;
  return {
    name: row.name,
    address: row.address,
    city: row.city,
    registeredAt: row.registered_at,
  };
}

async function getCustomer(phone) {
  const { data, error } = await supabase.from("customers").select("*").eq("phone", phone).maybeSingle();
  if (error) throw new Error(`[customers] getCustomer failed: ${error.message}`);
  return rowToCustomer(data);
}

async function isRegistered(phone) {
  const { count, error } = await supabase
    .from("customers")
    .select("phone", { count: "exact", head: true })
    .eq("phone", phone);
  if (error) throw new Error(`[customers] isRegistered failed: ${error.message}`);
  return count > 0;
}

async function saveCustomer(phone, { name, address, city }) {
  const existing = await getCustomer(phone);
  const updated = {
    phone,
    name: name !== undefined ? name : existing?.name,
    address: address !== undefined ? address : existing?.address,
    city: city !== undefined ? city : existing?.city,
  };
  const { data, error } = await supabase.from("customers").upsert(updated).select().single();
  if (error) throw new Error(`[customers] saveCustomer failed: ${error.message}`);
  return rowToCustomer(data);
}

/** All registered customers/outlets, most recently registered first. */
async function listCustomers() {
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .order("registered_at", { ascending: false });
  if (error) throw new Error(`[customers] listCustomers failed: ${error.message}`);
  return data.map((row) => ({ phone: row.phone, ...rowToCustomer(row) }));
}

module.exports = { getCustomer, isRegistered, saveCustomer, listCustomers };
