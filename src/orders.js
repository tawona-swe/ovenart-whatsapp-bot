// In-memory order record store, keyed by a generated order id — tracks the
// pending -> confirmed/rejected review workflow for orders from outside
// Harare (the factory's only location). Auto-approved (Harare) orders are
// recorded here too, already as "confirmed", for a consistent dashboard view.
// In-memory for this prototype; swap for a real DB before running more than
// one server instance or expecting restarts to preserve order history.
const orders = new Map();
let nextId = 1;

/**
 * @param {{ phone: string, name: string, address: string, city: string,
 *           fulfillment: string, itemsText: string, total: string,
 *           autoApproved: boolean }} details
 * @returns {object} the created order record
 */
function createOrder(details) {
  const id = String(nextId++);
  const order = {
    id,
    ...details,
    status: details.autoApproved ? "confirmed" : "pending",
    createdAt: Date.now(),
    reviewedAt: details.autoApproved ? Date.now() : null,
  };
  orders.set(id, order);
  return order;
}

function getOrder(id) {
  return orders.get(id);
}

function setStatus(id, status) {
  const order = orders.get(id);
  if (!order) return null;
  order.status = status;
  order.reviewedAt = Date.now();
  return order;
}

/** All orders, most recent first. */
function listOrders() {
  return [...orders.values()].sort((a, b) => b.createdAt - a.createdAt);
}

module.exports = { createOrder, getOrder, setStatus, listOrders };
