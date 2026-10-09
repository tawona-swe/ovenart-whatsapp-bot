// Persistent order record store — tracks the pending -> confirmed/rejected
// review workflow for orders from outside Harare (the factory's only
// location). Auto-approved (Harare) orders are recorded here too, already as
// "confirmed", for a consistent dashboard view. Backed by Supabase so order
// history survives restarts.
const { supabase } = require("./supabaseClient");

// createdAt/reviewedAt are kept as epoch-ms numbers (not ISO strings) because
// the dashboard's Daily Sheet feature does numeric arithmetic on them
// (public/dashboard.html's dispatch-window filter: `o.reviewedAt >= windowStart`).
function rowToOrder(row) {
  return {
    id: String(row.id),
    phone: row.phone,
    name: row.name,
    address: row.address,
    city: row.city,
    fulfillment: row.fulfillment,
    items: row.items ?? undefined,
    itemsText: row.items_text,
    total: row.total,
    orderType: row.order_type ?? undefined,
    shops: row.shops ?? undefined,
    requestedFor: row.requested_for,
    orderNotes: row.order_notes,
    currency: row.currency,
    autoApproved: row.auto_approved,
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).getTime() : null,
  };
}

/**
 * @param {{ phone: string, name: string, address: string, city: string,
 *           fulfillment: string, items?: Array<{id:number, qty:number}>,
 *           itemsText: string, total: string, autoApproved: boolean,
 *           orderType?: "singular"|"merchandise",
 *           shops?: Array<{ name: string, items: Array<{id:number,qty:number}>, itemsText: string, total: string }>,
 *           currency?: string, requestedFor?: string, orderNotes?: string|null }} details
 * @returns {Promise<object>} the created order record
 */
async function createOrder(details) {
  const now = new Date().toISOString();
  const row = {
    phone: details.phone,
    name: details.name,
    address: details.address,
    city: details.city,
    fulfillment: details.fulfillment,
    items: details.items ?? null,
    items_text: details.itemsText,
    total: details.total,
    order_type: details.orderType ?? null,
    shops: details.shops ?? null,
    requested_for: details.requestedFor ?? null,
    order_notes: details.orderNotes ?? null,
    currency: details.currency ?? null,
    auto_approved: !!details.autoApproved,
    status: details.autoApproved ? "confirmed" : "pending",
    reviewed_at: details.autoApproved ? now : null,
  };

  const { data, error } = await supabase.from("orders").insert(row).select().single();
  if (error) throw new Error(`[orders] createOrder failed: ${error.message}`);
  return rowToOrder(data);
}

async function getOrder(id) {
  const { data, error } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`[orders] getOrder failed: ${error.message}`);
  return data ? rowToOrder(data) : null;
}

async function setStatus(id, status) {
  const { data, error } = await supabase
    .from("orders")
    .update({ status, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw new Error(`[orders] setStatus failed: ${error.message}`);
  return data ? rowToOrder(data) : null;
}

/** All orders, most recent first. */
async function listOrders() {
  const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(`[orders] listOrders failed: ${error.message}`);
  return data.map(rowToOrder);
}

module.exports = { createOrder, getOrder, setStatus, listOrders };
