// Persistent customer profiles, keyed by WhatsApp number (the number itself
// is the unique id) — separate from the ephemeral per-order session in
// session.js. Survives across orders so returning customers never have to
// re-enter name/city.
// In-memory for this prototype; swap for a real DB before running more than
// one server instance or expecting restarts to preserve registrations.
const customers = new Map();

function getCustomer(phone) {
  return customers.get(phone);
}

function isRegistered(phone) {
  return customers.has(phone);
}

function saveCustomer(phone, { name, city }) {
  const existing = customers.get(phone) || { registeredAt: new Date().toISOString() };
  const updated = {
    ...existing,
    ...(name !== undefined && { name }),
    ...(city !== undefined && { city }),
  };
  customers.set(phone, updated);
  return updated;
}

module.exports = { getCustomer, isRegistered, saveCustomer };
