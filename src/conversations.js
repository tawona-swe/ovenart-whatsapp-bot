// Persistent conversation history, keyed by customer WhatsApp number — powers
// the sales dashboard's live inbox. Separate from session.js (bot-flow state,
// kept in-memory — ephemeral and self-resetting, not worth persisting) and
// customers.js (registered profile). Backed by Supabase so chat history
// survives restarts.
//
// Two tables: `conversation_messages` holds the full thread (for getThread),
// `conversation_summaries` is a per-phone cache of the last message + last
// inbound time (for listConversations/isWindowOpen without scanning the
// whole message history).
const { supabase } = require("./supabaseClient");

const WINDOW_MS = 24 * 60 * 60 * 1000;

async function getLastInboundAt(phone) {
  const { data, error } = await supabase
    .from("conversation_summaries")
    .select("last_inbound_at")
    .eq("phone", phone)
    .maybeSingle();
  if (error) throw new Error(`[conversations] summary lookup failed: ${error.message}`);
  return data?.last_inbound_at ? new Date(data.last_inbound_at).getTime() : null;
}

async function recordInbound(phone, text) {
  const now = new Date().toISOString();

  const { error: insertError } = await supabase
    .from("conversation_messages")
    .insert({ phone, direction: "in", text });
  if (insertError) throw new Error(`[conversations] recordInbound insert failed: ${insertError.message}`);

  const { error: upsertError } = await supabase.from("conversation_summaries").upsert({
    phone,
    last_inbound_at: now,
    last_message_text: text,
    last_message_direction: "in",
    last_message_at: now,
  });
  if (upsertError) throw new Error(`[conversations] recordInbound summary failed: ${upsertError.message}`);
}

async function recordOutbound(phone, text) {
  const now = new Date().toISOString();

  const { error: insertError } = await supabase
    .from("conversation_messages")
    .insert({ phone, direction: "out", text });
  if (insertError) throw new Error(`[conversations] recordOutbound insert failed: ${insertError.message}`);

  const { data: existing, error: lookupError } = await supabase
    .from("conversation_summaries")
    .select("last_inbound_at")
    .eq("phone", phone)
    .maybeSingle();
  if (lookupError) throw new Error(`[conversations] recordOutbound lookup failed: ${lookupError.message}`);

  const { error: upsertError } = await supabase.from("conversation_summaries").upsert({
    phone,
    last_inbound_at: existing?.last_inbound_at ?? null,
    last_message_text: text,
    last_message_direction: "out",
    last_message_at: now,
  });
  if (upsertError) throw new Error(`[conversations] recordOutbound summary failed: ${upsertError.message}`);
}

async function isWindowOpen(phone) {
  const lastInboundAt = await getLastInboundAt(phone);
  if (!lastInboundAt) return false;
  return Date.now() - lastInboundAt < WINDOW_MS;
}

/** When the 24h window closes (ms epoch), or null if it's never been opened. */
async function getWindowExpiresAt(phone) {
  const lastInboundAt = await getLastInboundAt(phone);
  return lastInboundAt ? lastInboundAt + WINDOW_MS : null;
}

async function getThread(phone) {
  const { data, error } = await supabase
    .from("conversation_messages")
    .select("direction, text, at")
    .eq("phone", phone)
    .order("at", { ascending: true });
  if (error) throw new Error(`[conversations] getThread failed: ${error.message}`);
  return data.map((m) => ({ direction: m.direction, text: m.text, at: new Date(m.at).getTime() }));
}

/** All conversations, most recently active first. */
async function listConversations() {
  const { data, error } = await supabase
    .from("conversation_summaries")
    .select("*")
    .order("last_message_at", { ascending: false });
  if (error) throw new Error(`[conversations] listConversations failed: ${error.message}`);

  return data.map((row) => {
    const lastInboundAt = row.last_inbound_at ? new Date(row.last_inbound_at).getTime() : null;
    return {
      phone: row.phone,
      lastMessage: row.last_message_text
        ? {
            direction: row.last_message_direction,
            text: row.last_message_text,
            at: new Date(row.last_message_at).getTime(),
          }
        : null,
      windowOpen: !!lastInboundAt && Date.now() - lastInboundAt < WINDOW_MS,
      windowExpiresAt: lastInboundAt ? lastInboundAt + WINDOW_MS : null,
    };
  });
}

module.exports = {
  recordInbound,
  recordOutbound,
  isWindowOpen,
  getWindowExpiresAt,
  getThread,
  listConversations,
};
