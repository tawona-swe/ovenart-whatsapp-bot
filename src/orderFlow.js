const { getProduct, PRODUCTS } = require("./products");
const { getSession, resetSession } = require("./session");
const { getCustomer, isRegistered, saveCustomer } = require("./customers");
const { detectCity } = require("./zimCities");
const { sendText, sendTemplate, sendButtons, sendCatalog } = require("./whatsapp");
const { appendOrderRow } = require("./ordersSheet");
const { createOrder, getOrder, setStatus } = require("./orders");

// Orders are only auto-approved when the outlet is based in Harare — the
// factory's only location. Anything else needs manual review (Verification
// tab on the dashboard) before staff get notified / it hits the sheet.
const AUTO_APPROVE_CITY = "Harare";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MIN_ITEMS_FOR_DELIVERY = 10;

function cartTotal(cart) {
  return cart.reduce((sum, line) => sum + getProduct(line.id).price * line.qty, 0);
}

function cartItemCount(cart) {
  return cart.reduce((sum, line) => sum + line.qty, 0);
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

async function sendOrderTypeChoice(phone) {
  await sendButtons(phone, "What type of order is this?", [
    { id: "order_singular", title: "Singular" },
    { id: "order_merchandise", title: "Merchandise" },
  ]);
}

async function sendShopNamePrompt(phone, isFirst) {
  await sendText(
    phone,
    isFirst
      ? "Merchandise order — which shop/branch is this first for? (e.g. \"Spar Avondale\")"
      : "Which shop/branch is the next order for?"
  );
}

async function sendMerchCatalog(phone, shopName) {
  await sendCatalog(
    phone,
    `Building the order for *${shopName}*. Tap below to add items and quantities, then send when ready.`,
    String(PRODUCTS[0].id)
  );
}

async function sendAddShopPrompt(phone, shops) {
  const summary = shops.map((s) => `*${s.name}*\n${formatCart(s.cart)}`).join("\n\n");
  await sendButtons(phone, `${summary}\n\nAdd another shop, or done?`, [
    { id: "merch_add_shop", title: "Add shop" },
    { id: "merch_done", title: "Done" },
  ]);
}

// ─── Shared pre-confirm steps (currency + timing + notes) for both order types ────────

async function sendCurrencyChoice(phone) {
  await sendButtons(phone, "Which currency is this order in?", [
    { id: "currency_usd", title: "USD" },
    { id: "currency_zig", title: "ZIG" },
  ]);
}

async function sendTimingChoice(phone) {
  await sendButtons(phone, "When would you like this order?", [
    { id: "timing_now", title: "Now" },
    { id: "timing_schedule", title: "Schedule" },
  ]);
}

async function sendTimingInputPrompt(phone) {
  await sendText(phone, "What day and time would you like this? (e.g. \"3 Oct, 10am\")");
}

async function sendNotesPrompt(phone) {
  await sendButtons(phone, "Any extra notes for this order? Type them now, or tap below if none.", [
    { id: "notes_none", title: "No notes" },
  ]);
}

/** Move into the shared currency+timing+notes steps; `returnState` is resumed after. */
async function startCheckoutExtras(phone, session, returnState) {
  session.timingReturnState = returnState;
  session.state = "CURRENCY_CHOICE";
  await sendCurrencyChoice(phone);
}

/**
 * Fast path: assume USD / now / no notes and go straight to the confirm
 * screen, instead of asking three extra questions on every single order.
 * The confirm screen's "Edit details" button still reaches the full
 * currency/timing/notes flow via startCheckoutExtras for anyone who needs it.
 */
async function applyDefaultsAndConfirm(phone, session, returnState) {
  session.currency = session.currency || "USD";
  session.requestedFor = session.requestedFor || "ASAP";
  session.timingReturnState = returnState;
  await resumeToConfirm(phone, session);
}

async function sendSettingsMenu(phone, customer) {
  await sendButtons(
    phone,
    `*Your details:*\n\nName: ${customer.name}\nAddress: ${customer.address}\n\nWhat would you like to update? (or type *menu* to go back)`,
    [
      { id: "settings_edit_name", title: "Name" },
      { id: "settings_edit_address", title: "Address" },
    ]
  );
}

async function sendFulfillmentPrompt(phone, cart) {
  if (cartItemCount(cart) < MIN_ITEMS_FOR_DELIVERY) {
    await sendButtons(
      phone,
      `Delivery is available for orders of ${MIN_ITEMS_FOR_DELIVERY}+ items. This order qualifies for pickup only.`,
      [{ id: "fulfillment_pickup", title: "Pickup" }]
    );
    return;
  }
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

/**
 * Best-effort heads-up when an order needs manual review (outside Harare) —
 * the dashboard's Verification tab is the real safety net; this is just a
 * bonus nudge for whoever has staff notifications configured. Silent no-op
 * if BAKERY_NOTIFY_NUMBER isn't set, same as notifyBakery.
 */
async function notifyBakeryPending(order) {
  if (!process.env.BAKERY_NOTIFY_NUMBER) return;
  try {
    await sendText(
      process.env.BAKERY_NOTIFY_NUMBER,
      `New order needs review (outside Harare): ${order.name} — ${order.city}. Check the Verification tab.`
    );
  } catch (err) {
    console.error("[order] pending-review alert failed:", err.message);
  }
}

/**
 * Run the actual confirmation side-effects for an order record — staff
 * notification, sheet row, customer confirmation text — shared by both the
 * auto-approve path (Harare) and manual dashboard approval (everyone else).
 */
async function finalizeOrder(order) {
  const timestamp = nowCAT();
  const body = order.shops
    ? order.shops
        .map((s) => `*${s.name}*\n${s.itemsText.split("; ").map((l) => `• ${l}`).join("\n")}\nShop total: $${s.total}`)
        .join("\n\n")
    : order.itemsText;
  const whenNotes =
    `Currency: ${order.currency || "USD"}\nWhen: ${order.requestedFor || "ASAP"}` +
    (order.orderNotes ? `\nNotes: ${order.orderNotes}` : "");
  const orderSummary =
    `*New Order — ${timestamp}*\n\n` +
    `${order.name}  (${order.phone})\n` +
    `${order.address}\n` +
    `${order.fulfillment}\n` +
    `${whenNotes}\n\n` +
    `${body}\n\nTotal: $${order.total}`;

  await notifyBakery({
    orderSummary,
    name: order.name,
    phone: order.phone,
    fulfillment: order.fulfillment,
    itemsText: order.itemsText,
    total: order.total,
  });

  await appendOrderRow({
    timestamp,
    name: order.name,
    address: order.address,
    city: order.city,
    phone: order.phone,
    fulfillment: order.fulfillment,
    itemsText: order.itemsText,
    total: order.total,
  });

  try {
    await sendText(
      order.phone,
      "*Order confirmed!* Thank you.\n\nThe Oven Art team has received your order and will be in touch shortly.\n\nType *menu* any time to start a new order."
    );
  } catch (err) {
    // Only matters if this is a delayed manual approval and the customer's
    // 24h window has since closed — the order itself is still fully valid.
    console.error("[order] couldn't send confirmation to customer (order is still confirmed):", err.message);
  }
}

/** Approve a pending order from the dashboard's Verification tab. */
async function approveOrder(orderId) {
  const order = getOrder(orderId);
  if (!order) throw new Error("Order not found");
  setStatus(orderId, "confirmed");
  await finalizeOrder(order);
  return order;
}

/** Reject a pending order from the dashboard's Verification tab. */
async function rejectOrder(orderId) {
  const order = getOrder(orderId);
  if (!order) throw new Error("Order not found");
  setStatus(orderId, "rejected");
  try {
    await sendText(
      order.phone,
      "Sorry — we're currently only able to fulfil orders for outlets based in Harare, so we're unable to process this one. Thank you for your interest."
    );
  } catch (err) {
    console.error("[order] couldn't send rejection notice to customer:", err.message);
  }
  return order;
}

function timingAndNotesLines(session) {
  let lines = `Currency: ${session.currency || "USD"}\nWhen: ${session.requestedFor || "ASAP"}`;
  if (session.orderNotes) lines += `\nNotes: ${session.orderNotes}`;
  return lines;
}

async function sendConfirmPrompt(phone, session, customer) {
  const summary =
    "*Please confirm your order:*\n\n" +
    `${formatCart(session.cart)}\n\n` +
    `Name: ${customer.name}\n` +
    `${session.fulfillment}\n` +
    timingAndNotesLines(session);
  await sendButtons(phone, summary, [
    { id: "confirm_yes", title: "Confirm" },
    { id: "edit_details", title: "Edit details" },
    { id: "confirm_no", title: "Cancel" },
  ]);
}

async function sendMerchConfirmPrompt(phone, session, customer) {
  const shopsSummary = session.merchShops.map((s) => `*${s.name}*\n${formatCart(s.cart)}`).join("\n\n");
  const overallTotal = session.merchShops
    .reduce((sum, s) => sum + cartTotal(s.cart), 0)
    .toFixed(2);
  const summary =
    "*Please confirm your order:*\n\n" +
    `${shopsSummary}\n\n` +
    `Grand total: $${overallTotal}\n\n` +
    `Name: ${customer.name}\n` +
    "Delivery to stores via Oven Art merchandisers\n" +
    timingAndNotesLines(session);
  await sendButtons(phone, summary, [
    { id: "confirm_yes", title: "Confirm" },
    { id: "edit_details", title: "Edit details" },
    { id: "confirm_no", title: "Cancel" },
  ]);
}

/** Resume whichever confirm screen the shared timing/notes steps were entered from. */
async function resumeToConfirm(phone, session) {
  const customer = getCustomer(phone);
  session.state = session.timingReturnState;
  if (session.timingReturnState === "MERCH_CONFIRM") {
    await sendMerchConfirmPrompt(phone, session, customer);
  } else {
    await sendConfirmPrompt(phone, session, customer);
  }
}

/** Send whichever entry screen fits: register (new) or order-type choice (returning). */
async function sendEntryScreen(phone, session) {
  if (!isRegistered(phone)) {
    session.state = "REGISTER_START";
    await sendRegisterPrompt(phone);
    return;
  }
  session.state = "ORDER_TYPE_CHOICE";
  await sendOrderTypeChoice(phone);
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

  // Mid-merchandise-order: this cart belongs to the shop just named, not a
  // standalone singular order.
  if (session.state === "MERCH_AWAITING_CART" && session.currentShopName) {
    session.merchShops.push({ name: session.currentShopName, cart });
    session.currentShopName = null;
    session.state = "MERCH_ADD_MORE";
    await sendAddShopPrompt(phone, session.merchShops);
    return;
  }

  session.cart = cart;

  if (!isRegistered(phone)) {
    // Keep the cart waiting through registration, then resume checkout.
    session.pendingCartAfterRegister = true;
    session.state = "REGISTER_START";
    await sendRegisterPrompt(phone);
    return;
  }

  session.state = "CHECKOUT_FULFILLMENT";
  await sendFulfillmentPrompt(phone, session.cart);
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
    if (session.merchShops.length > 0) {
      await sendText(phone, session.merchShops.map((s) => `*${s.name}*\n${formatCart(s.cart)}`).join("\n\n"));
    } else {
      await sendText(phone, formatCart(session.cart));
    }
    return null;
  }

  switch (session.state) {
    case "START": {
      await sendEntryScreen(phone, session);
      return null;
    }

    // ── Order type + merchandise (multi-shop) ordering ────────────────────────
    case "ORDER_TYPE_CHOICE": {
      if (lower === "order_singular") {
        session.state = "MENU_SENT";
        await sendMenu(phone);
        return null;
      }
      if (lower === "order_merchandise") {
        session.merchShops = [];
        session.state = "MERCH_SHOP_NAME";
        await sendShopNamePrompt(phone, true);
        return null;
      }
      await sendOrderTypeChoice(phone);
      return null;
    }

    case "MENU_SENT": {
      // Waiting on a catalog submission (handled in handleCatalogOrder) —
      // a stray text message here just gets a reminder.
      await sendText(phone, "Please use the menu above to add items, then send your order.");
      return null;
    }

    case "MERCH_SHOP_NAME": {
      if (!text) {
        await sendText(phone, "Please enter the shop/branch name.");
        return null;
      }
      session.currentShopName = text;
      session.state = "MERCH_AWAITING_CART";
      await sendMerchCatalog(phone, text);
      return null;
    }

    case "MERCH_AWAITING_CART": {
      // Waiting on a catalog submission (handled in handleCatalogOrder) —
      // a stray text message here just gets a reminder.
      await sendText(phone, `Please use the menu above to add items for *${session.currentShopName}*, then send it.`);
      return null;
    }

    case "MERCH_ADD_MORE": {
      if (lower === "merch_add_shop") {
        session.state = "MERCH_SHOP_NAME";
        await sendShopNamePrompt(phone, false);
        return null;
      }
      if (lower === "merch_done") {
        await applyDefaultsAndConfirm(phone, session, "MERCH_CONFIRM");
        return null;
      }
      await sendAddShopPrompt(phone, session.merchShops);
      return null;
    }

    case "MERCH_CONFIRM": {
      const customer = getCustomer(phone);

      if (lower === "confirm_yes") {
        const shops = session.merchShops.map((s) => ({
          name: s.name,
          items: s.cart,
          itemsText: cartLines(s.cart).join("; "),
          total: cartTotal(s.cart).toFixed(2),
        }));
        const overallTotal = shops.reduce((sum, s) => sum + Number(s.total), 0).toFixed(2);
        const autoApproved = customer.city === AUTO_APPROVE_CITY;

        const order = createOrder({
          phone,
          name: customer.name,
          address: customer.address,
          city: customer.city,
          fulfillment: "Delivery to stores via Oven Art merchandisers",
          orderType: "merchandise",
          shops,
          itemsText: shops.map((s) => `${s.name}: ${s.itemsText}`).join(" | "),
          total: overallTotal,
          autoApproved,
          currency: session.currency || "USD",
          requestedFor: session.requestedFor || "ASAP",
          orderNotes: session.orderNotes,
        });

        resetSession(phone);

        if (autoApproved) {
          await finalizeOrder(order);
        } else {
          await notifyBakeryPending(order);
          await sendText(
            phone,
            "Thanks! Your order is being reviewed by our team (we currently fulfil Harare outlets) and we'll confirm shortly."
          );
        }
        return null;
      }
      if (lower === "confirm_no") {
        resetSession(phone);
        await sendText(phone, "No problem — your order has been cancelled.\n\nType *menu* any time to browse again.");
        return null;
      }
      if (lower === "edit_details") {
        await startCheckoutExtras(phone, session, "MERCH_CONFIRM");
        return null;
      }
      await sendMerchConfirmPrompt(phone, session, customer);
      return null;
    }

    // ── Shared: currency + timing + notes (both order types funnel through here) ──
    case "CURRENCY_CHOICE": {
      const currencies = { currency_usd: "USD", currency_zig: "ZIG" };
      if (currencies[lower]) {
        session.currency = currencies[lower];
        session.state = "TIMING_CHOICE";
        await sendTimingChoice(phone);
        return null;
      }
      await sendCurrencyChoice(phone);
      return null;
    }

    case "TIMING_CHOICE": {
      if (lower === "timing_now") {
        session.requestedFor = "ASAP";
        session.state = "NOTES_INPUT";
        await sendNotesPrompt(phone);
        return null;
      }
      if (lower === "timing_schedule") {
        session.state = "TIMING_INPUT";
        await sendTimingInputPrompt(phone);
        return null;
      }
      await sendTimingChoice(phone);
      return null;
    }

    case "TIMING_INPUT": {
      if (!text) {
        await sendTimingInputPrompt(phone);
        return null;
      }
      session.requestedFor = text;
      session.state = "NOTES_INPUT";
      await sendNotesPrompt(phone);
      return null;
    }

    case "NOTES_INPUT": {
      const skipped = lower === "notes_none" || lower === "skip" || !text;
      session.orderNotes = skipped ? null : text;
      await resumeToConfirm(phone, session);
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
      session.state = "REGISTER_ADDRESS";
      await sendText(phone, "Thanks! What's your address? Please include your city (e.g. \"12 Baker Street, Harare\").");
      return null;
    }

    case "REGISTER_ADDRESS": {
      if (!text) {
        await sendText(phone, "Please enter your address.");
        return null;
      }
      const city = detectCity(text);
      if (!city) {
        await sendText(
          phone,
          "We couldn't spot a recognised city in that — please include it, e.g. \"12 Baker Street, Harare\"."
        );
        return null;
      }
      const customer = saveCustomer(phone, { ...session.registerDraft, address: text, city });
      session.registerDraft = null;
      await sendText(phone, `You're registered, ${customer.name}!`);

      if (session.pendingCartAfterRegister && session.cart.length > 0) {
        session.pendingCartAfterRegister = false;
        session.state = "CHECKOUT_FULFILLMENT";
        await sendFulfillmentPrompt(phone, session.cart);
        return null;
      }

      session.state = "ORDER_TYPE_CHOICE";
      await sendOrderTypeChoice(phone);
      return null;
    }

    // ── Settings ─────────────────────────────────────────────────────────────
    case "SETTINGS_MENU": {
      if (lower === "settings_edit_name") {
        session.state = "SETTINGS_EDIT_NAME";
        await sendText(phone, "What should we update your name (or outlet name) to?");
        return null;
      }
      if (lower === "settings_edit_address") {
        session.state = "SETTINGS_EDIT_ADDRESS";
        await sendText(phone, "What should we update your address to? Please include your city.");
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

    case "SETTINGS_EDIT_ADDRESS": {
      if (!text) {
        await sendText(phone, "Please enter your address.");
        return null;
      }
      const city = detectCity(text);
      if (!city) {
        await sendText(
          phone,
          "We couldn't spot a recognised city in that — please include it, e.g. \"12 Baker Street, Harare\"."
        );
        return null;
      }
      saveCustomer(phone, { address: text, city });
      await sendText(phone, "Address updated.");
      session.state = "SETTINGS_MENU";
      await sendSettingsMenu(phone, getCustomer(phone));
      return null;
    }

    // ── Checkout — cart arrives pre-built from the catalog order ──────────────
    case "CHECKOUT_FULFILLMENT": {
      if (lower === "fulfillment_pickup") {
        session.fulfillment = "Pickup";
        await applyDefaultsAndConfirm(phone, session, "CHECKOUT_CONFIRM");
        return null;
      }
      if (lower === "fulfillment_delivery") {
        if (cartItemCount(session.cart) < MIN_ITEMS_FOR_DELIVERY) {
          await sendFulfillmentPrompt(phone, session.cart);
          return null;
        }
        session.state = "CHECKOUT_ADDRESS";
        await sendText(phone, "Please share your delivery address.");
        return null;
      }
      await sendFulfillmentPrompt(phone, session.cart);
      return null;
    }

    case "CHECKOUT_ADDRESS": {
      if (!text) {
        await sendText(phone, "Please share your delivery address.");
        return null;
      }
      session.fulfillment = `Delivery — ${text}`;
      await applyDefaultsAndConfirm(phone, session, "CHECKOUT_CONFIRM");
      return null;
    }

    case "CHECKOUT_CONFIRM": {
      const customer = getCustomer(phone);

      if (lower === "confirm_yes") {
        const autoApproved = customer.city === AUTO_APPROVE_CITY;
        const order = createOrder({
          phone,
          name: customer.name,
          address: customer.address,
          city: customer.city,
          fulfillment: session.fulfillment,
          items: session.cart,
          itemsText: cartLines(session.cart).join("; "),
          total: cartTotal(session.cart).toFixed(2),
          autoApproved,
          currency: session.currency || "USD",
          requestedFor: session.requestedFor || "ASAP",
          orderNotes: session.orderNotes,
        });

        resetSession(phone);

        if (autoApproved) {
          await finalizeOrder(order);
        } else {
          await notifyBakeryPending(order);
          await sendText(
            phone,
            "Thanks! Your order is being reviewed by our team (we currently fulfil Harare outlets) and we'll confirm shortly."
          );
        }
        return null;
      }
      if (lower === "confirm_no") {
        resetSession(phone);
        await sendText(phone, "No problem — your order has been cancelled.\n\nType *menu* any time to browse again.");
        return null;
      }
      if (lower === "edit_details") {
        await startCheckoutExtras(phone, session, "CHECKOUT_CONFIRM");
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

module.exports = { handleIncoming, handleCatalogOrder, approveOrder, rejectOrder };
