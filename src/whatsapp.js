const axios = require("axios");

const GRAPH_URL = "https://graph.facebook.com/v20.0";

async function sendText(to, body) {
  const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = process.env;
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.warn("[whatsapp] missing credentials, skipping send. Would have sent:", { to, body });
    return;
  }
  await axios.post(
    `${GRAPH_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
}

module.exports = { sendText };
