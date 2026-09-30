// In-memory conversation history, keyed by customer WhatsApp number — powers
// the sales dashboard's live inbox. Separate from session.js (bot-flow state)
// and customers.js (registered profile).
// In-memory for this prototype; swap for a real DB before running more than
// one server instance or expecting restarts to preserve chat history.
const WINDOW_MS = 24 * 60 * 60 * 1000;

const conversations = new Map(); // phone -> { messages: [...], lastInboundAt: number|null }

function getOrCreate(phone) {
  if (!conversations.has(phone)) {
    conversations.set(phone, { messages: [], lastInboundAt: null });
  }
  return conversations.get(phone);
}

function recordInbound(phone, text) {
  const convo = getOrCreate(phone);
  const now = Date.now();
  convo.lastInboundAt = now;
  convo.messages.push({ direction: "in", text, at: now });
}

function recordOutbound(phone, text) {
  const convo = getOrCreate(phone);
  convo.messages.push({ direction: "out", text, at: Date.now() });
}

function isWindowOpen(phone) {
  const convo = conversations.get(phone);
  if (!convo || !convo.lastInboundAt) return false;
  return Date.now() - convo.lastInboundAt < WINDOW_MS;
}

function getThread(phone) {
  return conversations.get(phone)?.messages ?? [];
}

/** All conversations, most recently active first. */
function listConversations() {
  return [...conversations.entries()]
    .map(([phone, convo]) => ({
      phone,
      lastMessage: convo.messages[convo.messages.length - 1] ?? null,
      windowOpen: isWindowOpen(phone),
    }))
    .sort((a, b) => (b.lastMessage?.at ?? 0) - (a.lastMessage?.at ?? 0));
}

module.exports = { recordInbound, recordOutbound, isWindowOpen, getThread, listConversations };
