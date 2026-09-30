const { getProduct, PRODUCTS } = require("./products");
const { getSession, resetSession } = require("./session");
const { getCustomer, isRegistered, saveCustomer } = require("./customers");
const { sendText, sendTemplate, sendButtons, sendCatalog } = require("./whatsapp");
const { appendOrderRow } = require("./ordersSheet");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cartTotal(cart) {
  return cart.reduce((sum, line) => sum + getProduct(line.id).price * line.qty, 0);
}

function cartLines(cart) {
  return cart.map((line) => {
    const p = getProduct(line.id);
    return `${line.qty}x ${p.name} — $${(p.price * line.qty).toFixed(2)}`;
  });
}

function formatCart(cart) {
  if (cart.length === 0) return "Your cart is empty.";
  const lines = cartLines(cart).map((l) => `• ${l}`);
  return lines.join("\n") + `\n\nTotal: $${cartTotal(cart).toFixed(2)}`;
}

function nowCAT() {
  return (
    new Date().toLocaleString("en-ZW", {
      timeZone: "Africa/Harare",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }) + " CAT"
  );
}

// ─── Registration ───────────────────────────────────────────────────────────

async function sendRegisterPrompt(phone) {
  await sendButtons(
    phone,
    "Welcome to *Oven Art Bakery*! Looks like this is your first time here — let's get you registered (takes 10 seconds).",
    [{ id: "register_start", title: "Register" }]
  );
}

// ─── Menu / Settings ─────────────────────────────────────────────────────────

async function sendMenu(phone) {
  await sendCatalog(
    phone,
    "Tap below to browse the menu — add items and quantities, then send your order when ready.",
    String(PRODUCTS[0].id)
  );
  await sendButtons(phone, "Need to update your details?", [{ id: "settings", title: "Settings" }]);
}

async function sendSettingsMenu(phone, customer) {
  await sendButtons(
    phone,
    `*Your details:*\n\nName: ${customer.name}\nCity: ${customer.city}\n\nWhat would you like to update? (or type *menu* to go back)`,
    [
      { id: "settings_edit_name", title: "Name" },
      { id: "settings_edit_city", title: "City" },
    ]
  );
}

async function sendFulfillmentPrompt(phone) {
  await sendButtons(phone, "Is this order for pickup or delivery?", [
    { id: "fulfillment_pickup", title: "Pickup" },
    { id: "fulfillment_delivery", title: "Delivery" },
  ]);
}

/**
 * Notify bakery staff of a new order. A staff notification failing must
 * never lose the order or block the customer's confirmation — the order is
 * always logged to the console and the sheet regardless (see confirm_yes).
 *
 * Business-initiated: staff haven't messaged the bot, so there's no open
 * 24h window. If BAKERY_ORDER_TEMPLATE_NAME is set, uses an approved
 * template (works regardless of window state). Otherwise falls back to a
 * plain text message, which only succeeds if staff messaged the bot
 * within the last 24h.
 */
async function notifyBakery({ orderSummary, name, phone, fulfillment, itemsText, total }) {
  console.log("[order]", orderSummary);

  if (!process.env.BAKERY_NOTIFY_NUMBER) return;

  try {
    if (process.env.BAKERY_ORDER_TEMPLATE_NAME) {
      await sendTemplate(
        process.env.BAKERY_NOTIFY_NUMBER,
        process.env.BAKERY_ORDER_TEMPLATE_NAME,
        process.env.BAKERY_ORDER_TEMPLATE_LANG || "en",
        [name, phone, fulfillment, itemsText, total]
      );
    } else {
      await sendText(process.env.BAKERY_NOTIFY_NUMBER, orderSummary);
    }
  } catch (err) {
    console.error(
      "[order] staff notification failed (order is still logged above) —",
      err.message,
      !process.env.BAKERY_ORDER_TEMPLATE_NAME
        ? "Tip: without BAKERY_ORDER_TEMPLATE_NAME set, staff must message the bot at least once every 24h to keep notifications working."
        : ""
    );
  }
}

async function sendConfirmPrompt(phone, session, customer) {
  const summary =
    "*Please confirm your order:*\n\n" +
    `${formatCart(session.cart)}\n\n` +
    `Name: ${customer.name}\n` +
    `${session.fulfillment}`;
  await sendButtons(phone, summary, [
    { id: "confirm_yes", title: "Confirm" },
    { id: "confirm_no", title: "Cancel" },
  ]);
}

/** Send whichever entry screen fits: register (new) or the catalog menu (returning). */
async function sendEntryScreen(phone, session) {
  if (!isRegistered(phone)) {
    session.state = "REGISTER_START";
    await sendRegisterPrompt(phone);
    return;
  }
  session.state = "MENU_SENT";
  await sendMenu(phone);
}

/**
 * Handle a submitted WhatsApp catalog cart (webhook message.type === "order").
 * Builds the session cart from the order's product_items and jumps straight
 * to checkout — no per-item round trips through the bot.
 *
 * @param {string} phone
 * @param {{ product_items: Array<{ product_retailer_id: string, quantity: number }> }} order
 */
async function handleCatalogOrder(phone, order) {
  const cart = (order.product_items || [])
    .map((item) => ({ id: Number(item.product_retailer_id), qty: item.quantity }))
    .filter((line) => Number.isInteger(line.qty) && line.qty > 0 && getProduct(line.id));

  if (cart.length === 0) {
    await sendText(phone, "That order didn't come through with any recognised items — please try again.");
    return;
  }

  const session = getSession(phone);
  session.cart = cart;

  if (!isRegistered(phone)) {
    // Keep the cart waiting through registration, then resume checkout.
    session.pendingCartAfterRegister = true;
    session.state = "REGISTER_START";
    await sendRegisterPrompt(phone);
    return;
  }

  session.state = "CHECKOUT_FULFILLMENT";
  await sendFulfillmentPrompt(phone);
}

// ─── Global commands (recognised in every state) ──────────────────────────────
const GLOBAL_COMMANDS = new Set(["menu", "hi", "hello", "start", "restart", "cancel", "reset"]);

// ─── Main handler ─────────────────────────────────────────────────────────────

/**
 * Process one incoming message (text, or a list/button reply id) from a
 * customer. Sends the appropriate interactive message(s) directly — there is
 * no separate text reply for the caller to send.
 *
 * @param {string} phone
 * @param {string} input - raw text, or the id of a tapped list/button row
 * @returns {Promise<null>}
 */
async function handleIncoming(phone, input) {
  const text = (input || "").trim();
  const lower = text.toLowerCase();
  let session = getSession(phone);

  if (GLOBAL_COMMANDS.has(lower)) {
    session = resetSession(phone);
    await sendEntryScreen(phone, session);
    return null;
  }

  if (isRegistered(phone) && lower === "settings") {
    session.state = "SETTINGS_MENU";
    await sendSettingsMenu(phone, getCustomer(phone));
    return null;
  }
  if (isRegistered(phone) && lower === "cart") {
    await sendText(phone, formatCart(session.cart));
    return null;
  }

  switch (session.state) {
    case "START": {
      await sendEntryScreen(phone, session);
      return null;
    }

    // ── Registration ─────────────────────────────────────────────────────────
    case "REGISTER_START": {
      if (lower === "register_start") {
        session.state = "REGISTER_NAME";
        await sendText(phone, "What's your name, or the name of your outlet?");
        return null;
      }
      await sendRegisterPrompt(phone);
      return null;
    }

    case "REGISTER_NAME": {
      if (!text) {
        await sendText(phone, "Please enter your name.");
        return null;
      }
      session.registerDraft = { name: text };
      session.state = "REGISTER_CITY";
      await sendText(phone, "Thanks! Which city are you in?");
      return null;
    }

    case "REGISTER_CITY": {
      if (!text) {
        await sendText(phone, "Please enter your city.");
        return null;
      }
      const customer = saveCustomer(phone, { ...session.registerDraft, city: text });
      session.registerDraft = null;
      await sendText(phone, `You're registered, ${customer.name}!`);

      if (session.pendingCartAfterRegister && session.cart.length > 0) {
        session.pendingCartAfterRegister = false;
        session.state = "CHECKOUT_FULFILLMENT";
        await sendFulfillmentPrompt(phone);
        return null;
      }

      session.state = "MENU_SENT";
      await sendMenu(phone);
      return null;
    }

    // ── Settings ─────────────────────────────────────────────────────────────
    case "SETTINGS_MENU": {
      if (lower === "settings_edit_name") {
        session.state = "SETTINGS_EDIT_NAME";
        await sendText(phone, "What should we update your name (or outlet name) to?");
        return null;
      }
      if (lower === "settings_edit_city") {
        session.state = "SETTINGS_EDIT_CITY";
        await sendText(phone, "What should we update your city to?");
        return null;
      }
      await sendSettingsMenu(phone, getCustomer(phone));
      return null;
    }

    case "SETTINGS_EDIT_NAME": {
      if (!text) {
        await sendText(phone, "Please enter your name.");
        return null;
      }
      saveCustomer(phone, { name: text });
      await sendText(phone, "Name updated.");
      session.state = "SETTINGS_MENU";
      await sendSettingsMenu(phone, getCustomer(phone));
      return null;
    }

    case "SETTINGS_EDIT_CITY": {
      if (!text) {
        await sendText(phone, "Please enter your city.");
        return null;
      }
      saveCustomer(phone, { city: text });
      await sendText(phone, "City updated.");
      session.state = "SETTINGS_MENU";
      await sendSettingsMenu(phone, getCustomer(phone));
      return null;
    }

    // ── Checkout — cart arrives pre-built from the catalog order ──────────────
    case "CHECKOUT_FULFILLMENT": {
      if (lower === "fulfillment_pickup") {
        session.fulfillment = "Pickup";
        session.state = "CHECKOUT_CONFIRM";
        await sendConfirmPrompt(phone, session, getCustomer(phone));
        return null;
      }
      if (lower === "fulfillment_delivery") {
        session.state = "CHECKOUT_ADDRESS";
        await sendText(phone, "Please share your delivery address.");
        return null;
      }
      await sendFulfillmentPrompt(phone);
      return null;
    }

    case "CHECKOUT_ADDRESS": {
      if (!text) {
        await sendText(phone, "Please share your delivery address.");
        return null;
      }
      session.fulfillment = `Delivery — ${text}`;
      session.state = "CHECKOUT_CONFIRM";
      await sendConfirmPrompt(phone, session, getCustomer(phone));
      return null;
    }

    case "CHECKOUT_CONFIRM": {
      const customer = getCustomer(phone);

      if (lower === "confirm_yes") {
        const timestamp = nowCAT();
        const orderSummary =
          `*New Order — ${timestamp}*\n\n` +
          `${customer.name}  (${phone})\n` +
          `${customer.city}\n` +
          `${session.fulfillment}\n\n` +
          formatCart(session.cart);

        await notifyBakery({
          orderSummary,
          name: customer.name,
          phone,
          fulfillment: session.fulfillment,
          itemsText: cartLines(session.cart).join(", "),
          total: cartTotal(session.cart).toFixed(2),
        });

        await appendOrderRow({
          timestamp,
          name: customer.name,
          city: customer.city,
          phone,
          fulfillment: session.fulfillment,
          itemsText: cartLines(session.cart).join("; "),
          total: cartTotal(session.cart).toFixed(2),
        });

        resetSession(phone);
        await sendText(
          phone,
          "*Order confirmed!* Thank you.\n\nThe Oven Art team has received your order and will be in touch shortly.\n\nType *menu* any time to start a new order."
        );
        return null;
      }
      if (lower === "confirm_no") {
        resetSession(phone);
        await sendText(phone, "No problem — your order has been cancelled.\n\nType *menu* any time to browse again.");
        return null;
      }
      await sendConfirmPrompt(phone, session, customer);
      return null;
    }

    default: {
      session = resetSession(phone);
      await sendEntryScreen(phone, session);
      return null;
    }
  }
}

module.exports = { handleIncoming, handleCatalogOrder };
