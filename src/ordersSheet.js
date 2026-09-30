const axios = require("axios");
const querystring = require("querystring");

// Submits each confirmed order to a Google Form whose "Responses" tab is
// linked to a live Sheet — Google handles the sheet-appending for us, so no
// service account / API credentials are needed. See docs/google-sheets-setup.md.

function isConfigured() {
  return Boolean(
    process.env.GOOGLE_FORM_URL &&
      process.env.GOOGLE_FORM_ENTRY_NAME &&
      process.env.GOOGLE_FORM_ENTRY_ADDRESS &&
      process.env.GOOGLE_FORM_ENTRY_CITY &&
      process.env.GOOGLE_FORM_ENTRY_PHONE &&
      process.env.GOOGLE_FORM_ENTRY_FULFILLMENT &&
      process.env.GOOGLE_FORM_ENTRY_ITEMS &&
      process.env.GOOGLE_FORM_ENTRY_TOTAL
  );
}

/**
 * Append one confirmed order as a row in the shared Orders Google Sheet (via
 * its linked Google Form) for the packing/dispatch team. No-ops quietly if
 * not configured, so this never blocks an order from completing in the chat.
 *
 * @param {{ timestamp: string, name: string, address: string, city: string,
 *           phone: string, fulfillment: string, itemsText: string, total: string }} order
 */
async function appendOrderRow(order) {
  if (!isConfigured()) {
    console.log("[ordersSheet] not configured — skipping (set GOOGLE_FORM_* env vars to enable)");
    return;
  }

  const payload = querystring.stringify({
    [process.env.GOOGLE_FORM_ENTRY_NAME]: order.name,
    [process.env.GOOGLE_FORM_ENTRY_ADDRESS]: order.address,
    [process.env.GOOGLE_FORM_ENTRY_CITY]: order.city,
    [process.env.GOOGLE_FORM_ENTRY_PHONE]: order.phone,
    [process.env.GOOGLE_FORM_ENTRY_FULFILLMENT]: order.fulfillment,
    [process.env.GOOGLE_FORM_ENTRY_ITEMS]: order.itemsText,
    [process.env.GOOGLE_FORM_ENTRY_TOTAL]: order.total,
  });

  try {
    await axios.post(process.env.GOOGLE_FORM_URL, payload, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch (err) {
    // Google Forms' formResponse endpoint redirects on success, which axios
    // follows — a real failure here means the form/entry IDs are wrong.
    console.error("[ordersSheet] failed to submit order to Google Form:", err.message);
  }
}

module.exports = { appendOrderRow };
