// NOT CURRENTLY WIRED INTO server.js — see flowCrypto.js for why.
const { getProduct, flowProductOptions } = require("./products");
const { getSession, resetSession } = require("./session");
const { sendText } = require("./whatsapp");

// ─── Cart helpers (Flow screens use plain text — no WhatsApp chat markdown) ────

function cartTotal(cart) {
  return cart.reduce((sum, line) => sum + getProduct(line.id).price * line.qty, 0);
}

function formatCartSummary(cart) {
  if (cart.length === 0) return "Your cart is empty. Pick a product below to get started.";
  const lines = cart.map((line) => {
    const p = getProduct(line.id);
    return `${line.qty}x ${p.name} — $${(p.price * line.qty).toFixed(2)}`;
  });
  return `Your cart:\n${lines.join("\n")}\n\nTotal: $${cartTotal(cart).toFixed(2)}`;
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

function menuScreen(session) {
  return {
    version: "3.0",
    screen: "MENU",
    data: {
      cart_summary: formatCartSummary(session.cart),
      products: flowProductOptions(),
    },
  };
}

function checkoutScreen(session, note) {
  return {
    version: "3.0",
    screen: "CHECKOUT",
    data: {
      cart_summary: (note ? `⚠️ ${note}\n\n` : "") + formatCartSummary(session.cart),
    },
  };
}

/**
 * Handle one decrypted WhatsApp Flow data-exchange request.
 * @param {object} decryptedBody - { version, action, screen, data, flow_token }
 * @returns {Promise<object>} - plaintext response object to encrypt and send back
 */
async function handleFlowAction(decryptedBody) {
  const { action, data } = decryptedBody;
  const phone = decryptedBody.flow_token;

  if (action === "ping") {
    return { data: { status: "active" } };
  }

  const session = getSession(phone);

  if (action === "INIT" || action === "BACK") {
    return menuScreen(session);
  }

  if (action === "data_exchange") {
    switch (data?.action) {
      case "add_to_cart": {
        const product = getProduct(data.product_id);
        const qty = parseInt(data.qty, 10);
        if (!product || !Number.isInteger(qty) || qty <= 0) {
          return menuScreen(session);
        }
        const existing = session.cart.find((l) => l.id === product.id);
        if (existing) {
          existing.qty += qty;
        } else {
          session.cart.push({ id: product.id, qty });
        }
        return menuScreen(session);
      }

      case "go_checkout": {
        if (session.cart.length === 0) {
          return menuScreen(session);
        }
        return checkoutScreen(session);
      }

      case "back_to_menu": {
        return menuScreen(session);
      }

      case "submit_order": {
        const name = (data.customer_name || "").trim();
        const fulfillment = data.fulfillment; // "pickup" | "delivery"
        const address = (data.address || "").trim();

        if (session.cart.length === 0) {
          return menuScreen(session);
        }
        if (!name) {
          return checkoutScreen(session, "Please enter your name.");
        }
        if (fulfillment !== "pickup" && fulfillment !== "delivery") {
          return checkoutScreen(session, "Please choose pickup or delivery.");
        }
        if (fulfillment === "delivery" && !address) {
          return checkoutScreen(session, "Please enter your delivery address.");
        }

        const location = fulfillment === "pickup" ? "Pickup" : `Delivery — ${address}`;
        const timestamp = nowCAT();
        const orderSummary =
          `New Order — ${timestamp}\n\n` +
          `${name}  (${phone})\n` +
          `${location}\n\n` +
          formatCartSummary(session.cart);

        if (process.env.BAKERY_NOTIFY_NUMBER) {
          await sendText(process.env.BAKERY_NOTIFY_NUMBER, orderSummary);
        } else {
          console.log("[order]", orderSummary);
        }

        resetSession(phone);
        return {
          version: "3.0",
          screen: "CONFIRMATION",
          data: {
            message: `Thanks, ${name}! Your order has been sent to Oven Art Bakery and the team will be in touch shortly.`,
          },
        };
      }

      default:
        return menuScreen(session);
    }
  }

  return menuScreen(session);
}

module.exports = { handleFlowAction };
