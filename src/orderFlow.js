const { getProduct, getCategories, getProductsByCategorySlug } = require("./products");
const { getSession, resetSession } = require("./session");
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

async function sendCategoryList(phone) {
  const sections = [
    {
      title: "Menu",
      rows: getCategories().map((c) => ({ id: `cat_${c.slug}`, title: c.label.slice(0, 24) })),
    },
  ];
  await sendList(
    phone,
    "👋 Welcome to *Oven Art Bakery*! Pick a category to browse, or type *cart* / *checkout* any time.",
    "Browse menu",
    sections
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

async function sendConfirmPrompt(phone, session) {
  const summary =
    "📋 *Please confirm your order:*\n\n" +
    `${formatCart(session.cart)}\n\n` +
    `👤 Name: ${session.customer.name}\n` +
    `✉️ Email: ${session.customer.email}\n` +
    `📍 ${session.customer.location}`;
  await sendButtons(phone, summary, [
    { id: "confirm_yes", title: "✅ Confirm" },
    { id: "confirm_no", title: "❌ Cancel" },
  ]);
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
    session.state = "BROWSING_CATEGORY";
    await sendCategoryList(phone);
    return null;
  }

  // "cart" / "checkout" work as typed shortcuts from anywhere in browsing.
  if (lower === "cart") {
    await sendCartActions(phone, session.cart);
    session.state = "CART_ACTIONS";
    return null;
  }
  if (lower === "checkout" && session.cart.length > 0) {
    session.state = "CHECKOUT_NAME";
    await sendText(phone, "Great! What name should we put on the order?");
    return null;
  }

  switch (session.state) {
    case "START": {
      session.state = "BROWSING_CATEGORY";
      await sendCategoryList(phone);
      return null;
    }

    case "BROWSING_CATEGORY": {
      if (lower.startsWith("cat_")) {
        const slug = lower.slice(4);
        session.state = "BROWSING_PRODUCT";
        await sendProductList(phone, slug);
        return null;
      }
      await sendCategoryList(phone);
      return null;
    }

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
        session.state = "CHECKOUT_NAME";
        await sendText(phone, "Great! What name should we put on the order?");
        return null;
      }
      await sendCartActions(phone, session.cart);
      return null;
    }

    case "CHECKOUT_NAME": {
      if (!text) {
        await sendText(phone, "Please enter your name so we can put it on the order.");
        return null;
      }
      session.customer.name = text;
      session.state = "CHECKOUT_EMAIL";
      await sendText(phone, "Thanks! What's your email address?");
      return null;
    }

    case "CHECKOUT_EMAIL": {
      if (!text || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
        await sendText(phone, "Please enter a valid email address (e.g. name@example.com).");
        return null;
      }
      session.customer.email = text;
      session.state = "CHECKOUT_FULFILLMENT";
      await sendFulfillmentPrompt(phone);
      return null;
    }

    case "CHECKOUT_FULFILLMENT": {
      if (lower === "fulfillment_pickup") {
        session.customer.location = "Pickup";
        session.state = "CHECKOUT_CONFIRM";
        await sendConfirmPrompt(phone, session);
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
      session.customer.location = `Delivery — ${text}`;
      session.state = "CHECKOUT_CONFIRM";
      await sendConfirmPrompt(phone, session);
      return null;
    }

    case "CHECKOUT_CONFIRM": {
      if (lower === "confirm_yes") {
        const timestamp = nowCAT();
        const orderSummary =
          `🆕 *New Order — ${timestamp}*\n\n` +
          `👤 ${session.customer.name}  (${phone})\n` +
          `✉️ ${session.customer.email}\n` +
          `📍 ${session.customer.location}\n\n` +
          formatCart(session.cart);

        await notifyBakery({
          orderSummary,
          name: session.customer.name,
          phone,
          fulfillment: session.customer.location,
          itemsText: cartLines(session.cart).join(", "),
          total: cartTotal(session.cart).toFixed(2),
        });

        await appendOrderRow({
          timestamp,
          name: session.customer.name,
          email: session.customer.email,
          phone,
          fulfillment: session.customer.location,
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
      await sendConfirmPrompt(phone, session);
      return null;
    }

    default: {
      session = resetSession(phone);
      session.state = "BROWSING_CATEGORY";
      await sendCategoryList(phone);
      return null;
    }
  }
}

module.exports = { handleIncoming };
