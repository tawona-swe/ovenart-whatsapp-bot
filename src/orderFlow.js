const { getProduct, getCategories, getProductsByCategorySlug } = require("./products");
const { getSession, resetSession } = require("./session");
const { getCustomer, isRegistered, saveCustomer } = require("./customers");
const { sendText, sendTemplate, sendList, sendButtons } = require("./whatsapp");
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
  return lines.join("\n") + `\n\n💰 Total: $${cartTotal(cart).toFixed(2)}`;
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Registration ───────────────────────────────────────────────────────────

async function sendRegisterPrompt(phone) {
  await sendButtons(
    phone,
    "👋 Welcome to *Oven Art Bakery*! Looks like this is your first time here — let's get you registered (takes 10 seconds).",
    [{ id: "register_start", title: "📝 Register" }]
  );
}

// ─── Menu / Settings ─────────────────────────────────────────────────────────

async function sendCategoryList(phone) {
  const sections = [
    {
      title: "Menu",
      rows: getCategories().map((c) => ({ id: `cat_${c.slug}`, title: c.label.slice(0, 24) })),
    },
    {
      title: "Account",
      rows: [{ id: "settings_open", title: "⚙️ Settings" }],
    },
  ];
  await sendList(
    phone,
    "Pick a category to browse, or type *cart* / *checkout* any time.",
    "Browse menu",
    sections
  );
}

async function sendSettingsMenu(phone, customer) {
  await sendButtons(
    phone,
    `⚙️ *Your details:*\n\n👤 ${customer.name}\n✉️ ${customer.email}\n📍 ${customer.city}\n\nWhat would you like to update? (or type *menu* to go back)`,
    [
      { id: "settings_edit_name", title: "Name" },
      { id: "settings_edit_email", title: "Email" },
      { id: "settings_edit_city", title: "City" },
    ]
  );
}

async function sendProductList(phone, categorySlug) {
  const products = getProductsByCategorySlug(categorySlug);
  const sections = [
    {
      title: "Products",
      rows: products.map((p) => ({
        id: `prod_${p.id}`,
        title: p.name.slice(0, 24),
        description: `$${p.price.toFixed(2)} — ${p.description}`.slice(0, 72),
      })),
    },
  ];
  await sendList(phone, "Choose a product to add to your cart:", "Choose product", sections);
}

async function sendQtyPrompt(phone, product) {
  await sendButtons(
    phone,
    `*${product.name}* — $${product.price.toFixed(2)} each.\nHow many would you like? (or type a number)`,
    [
      { id: "qty_1", title: "1" },
      { id: "qty_2", title: "2" },
      { id: "qty_3", title: "3" },
    ]
  );
}

async function sendCartActions(phone, cart) {
  await sendButtons(phone, `🛒 *Cart updated:*\n\n${formatCart(cart)}`, [
    { id: "action_more", title: "Add more" },
    { id: "action_cart", title: "View cart" },
    { id: "action_checkout", title: "Checkout" },
  ]);
}

async function sendFulfillmentPrompt(phone) {
  await sendButtons(phone, "Is this order for pickup or delivery?", [
    { id: "fulfillment_pickup", title: "🏬 Pickup" },
    { id: "fulfillment_delivery", title: "🚚 Delivery" },
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
    "📋 *Please confirm your order:*\n\n" +
    `${formatCart(session.cart)}\n\n` +
    `👤 Name: ${customer.name}\n` +
    `✉️ Email: ${customer.email}\n` +
    `📍 ${session.fulfillment}`;
  await sendButtons(phone, summary, [
    { id: "confirm_yes", title: "✅ Confirm" },
    { id: "confirm_no", title: "❌ Cancel" },
  ]);
}

/** Send whichever entry screen fits: register (new) or menu+settings (returning). */
async function sendEntryScreen(phone, session) {
  if (!isRegistered(phone)) {
    session.state = "REGISTER_START";
    await sendRegisterPrompt(phone);
    return;
  }
  session.state = "BROWSING_CATEGORY";
  await sendCategoryList(phone);
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

  // "cart" / "checkout" work as typed shortcuts from anywhere in browsing —
  // only meaningful for a registered customer with an active cart.
  if (isRegistered(phone) && lower === "cart") {
    await sendCartActions(phone, session.cart);
    session.state = "CART_ACTIONS";
    return null;
  }
  if (isRegistered(phone) && lower === "checkout" && session.cart.length > 0) {
    session.state = "CHECKOUT_FULFILLMENT";
    await sendFulfillmentPrompt(phone);
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
        await sendText(phone, "What's your name?");
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
      session.state = "REGISTER_EMAIL";
      await sendText(phone, "Thanks! What's your email address?");
      return null;
    }

    case "REGISTER_EMAIL": {
      if (!text || !EMAIL_RE.test(text)) {
        await sendText(phone, "Please enter a valid email address (e.g. name@example.com).");
        return null;
      }
      session.registerDraft.email = text;
      session.state = "REGISTER_CITY";
      await sendText(phone, "Almost done — which city are you in?");
      return null;
    }

    case "REGISTER_CITY": {
      if (!text) {
        await sendText(phone, "Please enter your city.");
        return null;
      }
      const customer = saveCustomer(phone, { ...session.registerDraft, city: text });
      session.registerDraft = null;
      await sendText(phone, `🎉 You're registered, ${customer.name}! Here's the menu:`);
      session.state = "BROWSING_CATEGORY";
      await sendCategoryList(phone);
      return null;
    }

    // ── Settings ─────────────────────────────────────────────────────────────
    case "BROWSING_CATEGORY": {
      if (lower === "settings_open") {
        session.state = "SETTINGS_MENU";
        await sendSettingsMenu(phone, getCustomer(phone));
        return null;
      }
      if (lower.startsWith("cat_")) {
        const slug = lower.slice(4);
        session.state = "BROWSING_PRODUCT";
        await sendProductList(phone, slug);
        return null;
      }
      await sendCategoryList(phone);
      return null;
    }

    case "SETTINGS_MENU": {
      if (lower === "settings_edit_name") {
        session.state = "SETTINGS_EDIT_NAME";
        await sendText(phone, "What should we update your name to?");
        return null;
      }
      if (lower === "settings_edit_email") {
        session.state = "SETTINGS_EDIT_EMAIL";
        await sendText(phone, "What should we update your email to?");
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
      await sendText(phone, "✅ Name updated.");
      session.state = "SETTINGS_MENU";
      await sendSettingsMenu(phone, getCustomer(phone));
      return null;
    }

    case "SETTINGS_EDIT_EMAIL": {
      if (!text || !EMAIL_RE.test(text)) {
        await sendText(phone, "Please enter a valid email address (e.g. name@example.com).");
        return null;
      }
      saveCustomer(phone, { email: text });
      await sendText(phone, "✅ Email updated.");
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
      await sendText(phone, "✅ City updated.");
      session.state = "SETTINGS_MENU";
      await sendSettingsMenu(phone, getCustomer(phone));
      return null;
    }

    // ── Browsing / cart ──────────────────────────────────────────────────────
    case "BROWSING_PRODUCT": {
      if (lower.startsWith("prod_")) {
        const product = getProduct(lower.slice(5));
        if (product) {
          session.pendingItemId = product.id;
          session.state = "AWAITING_QTY";
          await sendQtyPrompt(phone, product);
          return null;
        }
      }
      await sendCategoryList(phone);
      session.state = "BROWSING_CATEGORY";
      return null;
    }

    case "AWAITING_QTY": {
      const qtyMatch = lower.match(/^qty_(\d+)$/);
      const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : parseInt(text, 10);
      if (!Number.isInteger(qty) || qty <= 0) {
        await sendText(phone, "Please reply with a valid quantity — e.g. 1, 2, 3.");
        return null;
      }
      const product = getProduct(session.pendingItemId);
      const existing = session.cart.find((l) => l.id === product.id);
      if (existing) {
        existing.qty += qty;
      } else {
        session.cart.push({ id: product.id, qty });
      }
      session.pendingItemId = null;
      session.state = "CART_ACTIONS";
      await sendCartActions(phone, session.cart);
      return null;
    }

    case "CART_ACTIONS": {
      if (lower === "action_more") {
        session.state = "BROWSING_CATEGORY";
        await sendCategoryList(phone);
        return null;
      }
      if (lower === "action_cart") {
        await sendCartActions(phone, session.cart);
        return null;
      }
      if (lower === "action_checkout") {
        if (session.cart.length === 0) {
          await sendText(phone, "Your cart is empty 😊 Add something first.");
          session.state = "BROWSING_CATEGORY";
          await sendCategoryList(phone);
          return null;
        }
        session.state = "CHECKOUT_FULFILLMENT";
        await sendFulfillmentPrompt(phone);
        return null;
      }
      await sendCartActions(phone, session.cart);
      return null;
    }

    // ── Checkout — name/email already known from registration ─────────────────
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
          `🆕 *New Order — ${timestamp}*\n\n` +
          `👤 ${customer.name}  (${phone})\n` +
          `✉️ ${customer.email}\n` +
          `🏙️ ${customer.city}\n` +
          `📍 ${session.fulfillment}\n\n` +
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
          email: customer.email,
          phone,
          fulfillment: session.fulfillment,
          itemsText: cartLines(session.cart).join("; "),
          total: cartTotal(session.cart).toFixed(2),
        });

        resetSession(phone);
        await sendText(
          phone,
          "🎉 *Order confirmed!* Thank you!\n\nThe Oven Art team has received your order and will be in touch shortly.\n\nType *menu* any time to start a new order. 🍞"
        );
        return null;
      }
      if (lower === "confirm_no") {
        resetSession(phone);
        await sendText(phone, "No problem — your order has been cancelled. 👍\n\nType *menu* any time to browse again.");
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

module.exports = { handleIncoming };
