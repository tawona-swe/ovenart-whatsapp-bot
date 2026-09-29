// In-memory session store keyed by customer WhatsApp number.
// Fine for a single-process prototype; swap for a real DB (Redis/Postgres)
// before running more than one server instance or expecting restarts to
// preserve in-flight orders.
const sessions = new Map();

function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, { state: "START", cart: [], registerDraft: null, fulfillment: null });
  }
  return sessions.get(phone);
}

function resetSession(phone) {
  const fresh = { state: "START", cart: [], registerDraft: null, fulfillment: null };
  sessions.set(phone, fresh);
  return fresh;
}

module.exports = { getSession, resetSession };
