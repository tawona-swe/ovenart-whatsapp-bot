const axios = require("axios");
const { recordOutbound } = require("./conversations");

const GRAPH_URL = "https://graph.facebook.com/v20.0";

/**
 * Send a plain-text WhatsApp message.
 *
 * @param {string} to   - Recipient in E.164 digits (no +), e.g. "26377xxxxxxx"
 * @param {string} body - Message text (max 4096 chars per Meta spec)
 */
async function sendText(to, body) {
  const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = process.env;

  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    const missing = [
      !WHATSAPP_TOKEN && "WHATSAPP_TOKEN",
      !WHATSAPP_PHONE_NUMBER_ID && "WHATSAPP_PHONE_NUMBER_ID",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `[whatsapp] Cannot send message — missing env var(s): ${missing}. ` +
        "Copy .env.example to .env and fill in your Meta credentials."
    );
  }

  const url = `${GRAPH_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  try {
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    recordOutbound(to, body);
  } catch (err) {
    // Enrich the error with the full Meta API response body so the caller
    // (server.js) can log exactly what went wrong (e.g. invalid token, number
    // not in testers list, rate limit, etc.).
    const metaError = err.response?.data;
    if (metaError) {
      const code = metaError?.error?.code;
      const msg = metaError?.error?.message;
      throw new Error(
        `[whatsapp] Meta API error sending to ${to} — code ${code}: ${msg}\n` +
          JSON.stringify(metaError, null, 2)
      );
    }
    // Network-level error (no response from Meta at all)
    throw new Error(`[whatsapp] Network error sending to ${to}: ${err.message}`);
  }
}

/**
 * Send an approved WhatsApp Message Template — the only way to message
 * someone who hasn't messaged you within the last 24h (business-initiated).
 *
 * @param {string} to           - Recipient in E.164 digits (no +)
 * @param {string} templateName - Exact name of the approved template
 * @param {string} languageCode - e.g. "en" or "en_US" — must match the template
 * @param {string[]} bodyParams - Values for the template's {{1}}, {{2}}, ... placeholders, in order
 */
async function sendTemplate(to, templateName, languageCode, bodyParams = []) {
  const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = process.env;

  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("[whatsapp] Cannot send template — missing WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID.");
  }

  const url = `${GRAPH_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const components =
    bodyParams.length > 0
      ? [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) }]
      : [];

  try {
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          components,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    recordOutbound(to, `[template: ${templateName}] ${bodyParams.join(" | ")}`);
  } catch (err) {
    const metaError = err.response?.data;
    if (metaError) {
      throw new Error(
        `[whatsapp] Meta API error sending template "${templateName}" to ${to} — code ${metaError?.error?.code}: ${metaError?.error?.message}\n` +
          JSON.stringify(metaError, null, 2)
      );
    }
    throw new Error(`[whatsapp] Network error sending template to ${to}: ${err.message}`);
  }
}

/**
 * Send a WhatsApp Flow trigger message — opens the native in-chat form.
 *
 * @param {string} to       - Recipient in E.164 digits (no +)
 * @param {string} bodyText - Message body shown above the "Start" button
 * @param {string} flowToken - Opaque token echoed back on every data-exchange
 *                              call for this flow session (we use the phone number)
 */
async function sendFlow(to, bodyText, flowToken) {
  const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_FLOW_ID } = process.env;

  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_FLOW_ID) {
    const missing = [
      !WHATSAPP_TOKEN && "WHATSAPP_TOKEN",
      !WHATSAPP_PHONE_NUMBER_ID && "WHATSAPP_PHONE_NUMBER_ID",
      !WHATSAPP_FLOW_ID && "WHATSAPP_FLOW_ID",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(`[whatsapp] Cannot send flow — missing env var(s): ${missing}.`);
  }

  const url = `${GRAPH_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  try {
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "flow",
          body: { text: bodyText },
          action: {
            name: "flow",
            parameters: {
              flow_message_version: "3",
              flow_token: flowToken,
              flow_id: WHATSAPP_FLOW_ID,
              flow_cta: "Start order",
              mode: process.env.WHATSAPP_FLOW_MODE || "draft",
              flow_action: "navigate",
              flow_action_payload: { screen: "MENU" },
            },
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    recordOutbound(to, `[flow] ${bodyText}`);
  } catch (err) {
    const metaError = err.response?.data;
    if (metaError) {
      const code = metaError?.error?.code;
      const msg = metaError?.error?.message;
      throw new Error(
        `[whatsapp] Meta API error sending flow to ${to} — code ${code}: ${msg}\n` +
          JSON.stringify(metaError, null, 2)
      );
    }
    throw new Error(`[whatsapp] Network error sending flow to ${to}: ${err.message}`);
  }
}

/**
 * Send a WhatsApp interactive List message (tap-to-select menu).
 *
 * @param {string} to
 * @param {string} bodyText
 * @param {string} buttonText - Label on the button that opens the list (max 20 chars)
 * @param {Array<{title: string, rows: Array<{id: string, title: string, description?: string}>}>} sections
 */
async function sendList(to, bodyText, buttonText, sections) {
  const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = process.env;
  const url = `${GRAPH_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  try {
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: bodyText },
          action: { button: buttonText, sections },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    recordOutbound(to, `[list] ${bodyText}`);
  } catch (err) {
    const metaError = err.response?.data;
    if (metaError) {
      throw new Error(
        `[whatsapp] Meta API error sending list to ${to} — code ${metaError?.error?.code}: ${metaError?.error?.message}\n` +
          JSON.stringify(metaError, null, 2)
      );
    }
    throw new Error(`[whatsapp] Network error sending list to ${to}: ${err.message}`);
  }
}

/**
 * Send a WhatsApp interactive Reply Buttons message (max 3 buttons).
 *
 * @param {string} to
 * @param {string} bodyText
 * @param {Array<{id: string, title: string}>} buttons - title max 20 chars
 */
async function sendButtons(to, bodyText, buttons) {
  const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = process.env;
  const url = `${GRAPH_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  try {
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: bodyText },
          action: {
            buttons: buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })),
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    recordOutbound(to, bodyText);
  } catch (err) {
    const metaError = err.response?.data;
    if (metaError) {
      throw new Error(
        `[whatsapp] Meta API error sending buttons to ${to} — code ${metaError?.error?.code}: ${metaError?.error?.message}\n` +
          JSON.stringify(metaError, null, 2)
      );
    }
    throw new Error(`[whatsapp] Network error sending buttons to ${to}: ${err.message}`);
  }
}

/**
 * Send a WhatsApp Catalog Message — opens the connected product catalog with
 * WhatsApp's own native browse/quantity/cart UI. The customer's submitted
 * cart arrives back at the webhook as a message of type "order".
 *
 * @param {string} to
 * @param {string} bodyText
 * @param {string} thumbnailRetailerId - retailer_id of the product shown as the header thumbnail
 */
async function sendCatalog(to, bodyText, thumbnailRetailerId) {
  const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = process.env;
  const url = `${GRAPH_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  try {
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "catalog_message",
          body: { text: bodyText },
          action: {
            name: "catalog_message",
            parameters: { thumbnail_product_retailer_id: thumbnailRetailerId },
          },
          footer: { text: "Oven Art Bakery" },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    recordOutbound(to, `[catalog] ${bodyText}`);
  } catch (err) {
    const metaError = err.response?.data;
    if (metaError) {
      throw new Error(
        `[whatsapp] Meta API error sending catalog to ${to} — code ${metaError?.error?.code}: ${metaError?.error?.message}\n` +
          JSON.stringify(metaError, null, 2)
      );
    }
    throw new Error(`[whatsapp] Network error sending catalog to ${to}: ${err.message}`);
  }
}

module.exports = { sendText, sendTemplate, sendFlow, sendList, sendButtons, sendCatalog };
