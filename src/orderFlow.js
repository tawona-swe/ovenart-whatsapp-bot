const { getProduct, formatMenu } = require("./products");
const { getSession, resetSession } = require("./session");
const { sendText } = require("./whatsapp");

const WELCOME =
  "Welcome to Oven Art Bakery! 🍞\n\nHere's what we've got today:\n\n" +
  formatMenu() +
  "\n\nReply with a number to add an item to your order.";

function cartTotal(cart) {
  return cart.reduce((sum, line) => sum + getProduct(line.id).price * line.qty, 0);
}

function formatCart(cart) {
  if (cart.length === 0) return "Your cart is empty.";
  const lines = cart.map((line) => {
    const p = getProduct(line.id);
    return `${line.qty} x ${p.name} - $${(p.price * line.qty).toFixed(2)}`;
  });
  return lines.join("\n") + `\n\nTotal: $${cartTotal(cart).toFixed(2)}`;
}

// Returns the reply text to send back to the customer. May also notify the
// bakery directly (via sendText) when an order is confirmed.
async function handleIncoming(phone, rawText) {
  const text = (rawText || "").trim();
  const session = getSession(phone);

  switch (session.state) {
    case "START": {
      session.state = "BROWSING";
      return WELCOME;
    }

    case "BROWSING": {
      const lower = text.toLowerCase();
      if (lower === "menu") {
        return WELCOME;
      }
      if (lower === "cart") {
        return formatCart(session.cart) + "\n\nReply with an item number to add more, or 'checkout'.";
      }
      if (lower === "checkout") {
        if (session.cart.length === 0) {
          return "Your cart is empty. Reply with a product number from the menu first.";
        }
        session.state = "CHECKOUT_NAME";
        return "Great! What name should we put on the order?";
      }
      const product = getProduct(text);
      if (product) {
        session.pendingItemId = product.id;
        session.state = "AWAITING_QTY";
        return `How many ${product.name} would you like?`;
      }
      return "Sorry, I didn't get that. Reply with a product number, 'cart', or 'checkout'.\n\n" + WELCOME;
    }

    case "AWAITING_QTY": {
      const qty = parseInt(text, 10);
      if (!Number.isInteger(qty) || qty <= 0) {
        return "Please reply with a valid quantity (e.g. 2).";
      }
      const product = getProduct(session.pendingItemId);
      const existing = session.cart.find((l) => l.id === product.id);
      if (existing) {
        existing.qty += qty;
      } else {
        session.cart.push({ id: product.id, qty });
      }
      session.pendingItemId = null;
      session.state = "BROWSING";
      return (
        `Added ${qty} x ${product.name} to your cart.\n\n` +
        "Reply with another product number, 'cart' to view your order, or 'checkout' to finish."
      );
    }

    case "CHECKOUT_NAME": {
      if (!text) return "Please enter your name.";
      session.customer.name = text;
      session.state = "CHECKOUT_LOCATION";
      return "Thanks! Is this for pickup or delivery? If delivery, please share the address.";
    }

    case "CHECKOUT_LOCATION": {
      if (!text) return "Please let us know pickup or your delivery address.";
      session.customer.location = text;
      session.state = "CHECKOUT_CONFIRM";
      return (
        `Please confirm your order:\n\n${formatCart(session.cart)}\n\n` +
        `Name: ${session.customer.name}\nPickup/Delivery: ${session.customer.location}\n\n` +
        "Reply YES to confirm or NO to cancel."
      );
    }

    case "CHECKOUT_CONFIRM": {
      const lower = text.toLowerCase();
      if (lower === "yes" || lower === "y") {
        const summary =
          `New order from ${session.customer.name} (${phone})\n\n` +
          `${formatCart(session.cart)}\n\nPickup/Delivery: ${session.customer.location}`;
        if (process.env.BAKERY_NOTIFY_NUMBER) {
          await sendText(process.env.BAKERY_NOTIFY_NUMBER, summary);
        } else {
          console.log("[order]", summary);
        }
        resetSession(phone);
        return "Thank you! Your order has been placed and the bakery has been notified. 🍞";
      }
      if (lower === "no" || lower === "n") {
        resetSession(phone);
        return "No problem, your order has been cancelled. Reply 'menu' any time to start again.";
      }
      return "Please reply YES to confirm or NO to cancel.";
    }

    default: {
      resetSession(phone);
      return WELCOME;
    }
  }
}

module.exports = { handleIncoming };
