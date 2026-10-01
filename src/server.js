require("dotenv").config();
const path = require("path");
const express = require("express");
const { handleIncoming, handleCatalogOrder, approveOrder, rejectOrder } = require("./orderFlow");
const { sendText } = require("./whatsapp");
const { recordInbound, isWindowOpen, getWindowExpiresAt, getThread, listConversations } = require("./conversations");
const { getCustomer, listCustomers } = require("./customers");
const { listOrders } = require("./orders");
const { getCategories, getProductsByCategorySlug } = require("./products");

// ─── Startup env check ───────────────────────────────────────────────────────
const requiredEnv = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN"];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);
if (missingEnv.length > 0) {
  console.warn(`[startup] WARNING — missing environment variables: ${missingEnv.join(", ")}`);
  console.warn("[startup] Copy .env.example to .env and fill in the WhatsApp credentials.");
  console.warn("[startup] Outbound messages will NOT be sent until these are set.");
}

const app = express();
app.use(express.json());

const startTime = Date.now();

// ─── GET /webhook — Meta webhook verification ─────────────────────────────────
// Meta calls this once with hub.mode=subscribe when you register the webhook URL.
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log(`[webhook-verify] mode=${mode} token=${token}`);

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("[webhook-verify] ✓ verified — webhook is active");
    return res.status(200).send(challenge);
  }

  console.warn("[webhook-verify] ✗ failed — token mismatch or wrong mode");
  return res.sendStatus(403);
});

// ─── POST /webhook — Incoming messages from Meta ──────────────────────────────
app.post("/webhook", async (req, res) => {
  // Ack immediately — Meta retries if it doesn't get 200 within 20 s.
  res.sendStatus(200);

  try {
    const body = req.body;

    // Meta wraps everything inside entry[].changes[].value
    const changes = body?.entry?.[0]?.changes ?? [];

    for (const change of changes) {
      const value = change?.value;
      if (!value) continue;

      // Skip delivery/read status updates — we don't need them yet.
      if (value.statuses?.length) {
        console.log(`[webhook] ignored status update (${value.statuses[0]?.status})`);
        continue;
      }

      const messages = value.messages ?? [];
      for (const message of messages) {
        const from = message.from; // customer's WhatsApp number, e.g. 26377xxxxxxx

        // A submitted catalog cart — skip straight to checkout with the
        // items the customer picked natively in WhatsApp's catalog UI.
        if (message.type === "order") {
          const items = message.order?.product_items ?? [];
          const total = items.reduce((sum, i) => sum + (i.item_price || 0) * (i.quantity || 0), 0);
          recordInbound(from, `[Catalog order: ${items.length} items, $${total.toFixed(2)}]`);
          console.log(`[webhook] ← ${from}: order (${items.length} items)`);
          await handleCatalogOrder(from, message.order);
          continue;
        }

        // Normalize the different inbound shapes into one input string:
        // typed text stays as-is, a tapped list row or button becomes its id.
        // For the dashboard log we prefer the human-readable title when one
        // exists (a tapped button/row), falling back to the id or raw text.
        let input = null;
        let displayText = null;
        if (message.type === "text") {
          input = message.text.body;
          displayText = input;
        } else if (message.type === "interactive") {
          const reply = message.interactive?.list_reply ?? message.interactive?.button_reply;
          input = reply?.id ?? null;
          displayText = reply?.title ?? input;
        }

        if (input === null) {
          console.log(`[webhook] ignored unsupported message type: ${message.type} from ${from}`);
          await sendText(
            from,
            "Sorry, I didn't catch that. Type *menu* to see the options again."
          );
          continue;
        }

        recordInbound(from, displayText);
        console.log(`[webhook] ← ${from}: ${input}`);
        await handleIncoming(from, input);
      }
    }
  } catch (err) {
    // Log the full Meta API error body if it came from Axios, otherwise log the raw error.
    const detail = err.response?.data ?? err.message ?? err;
    console.error("[webhook] error processing message:", JSON.stringify(detail, null, 2));
  }
});

// ─── Sales dashboard — live inbox, protected by HTTP Basic Auth ───────────────
function requireDashboardAuth(req, res, next) {
  const { DASHBOARD_USERNAME, DASHBOARD_PASSWORD } = process.env;
  if (!DASHBOARD_USERNAME || !DASHBOARD_PASSWORD) {
    return res.status(503).send("Dashboard not configured — set DASHBOARD_USERNAME/DASHBOARD_PASSWORD.");
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [user, pass] = Buffer.from(encoded, "base64").toString().split(":");
    if (user === DASHBOARD_USERNAME && pass === DASHBOARD_PASSWORD) return next();
  }

  res.set("WWW-Authenticate", 'Basic realm="Oven Art Dashboard"');
  return res.sendStatus(401);
}

app.get("/dashboard", requireDashboardAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "dashboard.html"));
});
// Scoped to just /images (not the whole public/ dir) so dashboard.html stays
// reachable only through the authed route above, never served statically.
app.use("/images", express.static(path.join(__dirname, "..", "public", "images")));
app.use("/api", requireDashboardAuth);

app.get("/api/customers", (_req, res) => {
  res.json(listCustomers());
});

app.get("/api/products", (_req, res) => {
  res.json(
    getCategories().map((c) => ({
      slug: c.slug,
      label: c.label,
      products: getProductsByCategorySlug(c.slug).map((p) => ({ id: p.id, name: p.name })),
    }))
  );
});

app.get("/api/orders", (_req, res) => {
  res.json(listOrders());
});

app.post("/api/orders/:id/approve", async (req, res) => {
  try {
    const order = await approveOrder(req.params.id);
    res.json(order);
  } catch (err) {
    console.error("[dashboard] approve failed:", err.message);
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/orders/:id/reject", async (req, res) => {
  try {
    const order = await rejectOrder(req.params.id);
    res.json(order);
  } catch (err) {
    console.error("[dashboard] reject failed:", err.message);
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/conversations", (_req, res) => {
  const list = listConversations().map((c) => ({
    ...c,
    name: getCustomer(c.phone)?.name ?? null,
  }));
  res.json(list);
});

app.get("/api/conversations/:phone/messages", (req, res) => {
  res.json({
    messages: getThread(req.params.phone),
    windowOpen: isWindowOpen(req.params.phone),
    windowExpiresAt: getWindowExpiresAt(req.params.phone),
    name: getCustomer(req.params.phone)?.name ?? null,
  });
});

app.post("/api/conversations/:phone/reply", async (req, res) => {
  const { phone } = req.params;
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "text is required" });
  if (!isWindowOpen(phone)) {
    return res.status(409).json({ error: "Outside the 24h window — a template is required to message first." });
  }
  try {
    await sendText(phone, text.trim());
    res.json({ ok: true });
  } catch (err) {
    console.error("[dashboard] failed to send reply:", err.message);
    res.status(502).json({ error: "Failed to send — see server logs." });
  }
});

// ─── GET / — basic liveness check ─────────────────────────────────────────────
app.get("/", (_req, res) => res.send("Oven Art WhatsApp bot is running."));

// ─── GET /health — detailed status (useful while debugging ngrok) ──────────────
app.get("/health", (_req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const h = Math.floor(uptimeSeconds / 3600);
  const m = Math.floor((uptimeSeconds % 3600) / 60);
  const s = uptimeSeconds % 60;
  const uptime = `${h}h ${m}m ${s}s`;

  const envStatus = requiredEnv.reduce((acc, key) => {
    acc[key] = process.env[key] ? "✓ set" : "✗ missing";
    return acc;
  }, {});
  envStatus["BAKERY_NOTIFY_NUMBER"] = process.env.BAKERY_NOTIFY_NUMBER
    ? "✓ set"
    : "— not set (orders will be logged to console)";

  res.json({
    status: "ok",
    uptime,
    env: envStatus,
  });
});

// ─── Server startup with EADDRINUSE fallback ──────────────────────────────────
const configuredPort = Number(process.env.PORT) || 3000;

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`\n🍞  Oven Art bot listening on port ${port}`);
    console.log(`   Health check → http://localhost:${port}/health\n`);
  });

  server.on("error", (err) => {
    if (err.code !== "EADDRINUSE") throw err;
    console.warn(`[startup] port ${port} is busy; trying port ${port + 1}`);
    startServer(port + 1);
  });
}

startServer(configuredPort);
