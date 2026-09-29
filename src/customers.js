// Persistent customer profiles, keyed by WhatsApp number — separate from the
// ephemeral per-order session in session.js. Survives across orders so
// returning customers never have to re-enter name/email/city.
// In-memory for this prototype; swap for a real DB before running more than
// one server instance or expecting restarts to preserve registrations.
const customers = new Map();

function getCustomer(phone) {
  return customers.get(phone);
}

function isRegistered(phone) {
  return customers.has(phone);
}

function saveCustomer(phone, { name, email, city }) {
  const existing = customers.get(phone) || { registeredAt: new Date().toISOString() };
  const updated = {
    ...existing,
    ...(name !== undefined && { name }),
    ...(email !== undefined && { email }),
    ...(city !== undefined && { city }),
  };
  customers.set(phone, updated);
  return updated;
}

module.exports = { getCustomer, isRegistered, saveCustomer };
