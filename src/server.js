require("dotenv").config();
const express = require("express");
const { handleIncoming } = require("./orderFlow");
const { sendText } = require("./whatsapp");

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

        // Normalize the different inbound shapes into one input string:
        // typed text stays as-is, a tapped list row or button becomes its id.
        let input = null;
        if (message.type === "text") {
          input = message.text.body;
        } else if (message.type === "interactive") {
          input =
            message.interactive?.list_reply?.id ?? message.interactive?.button_reply?.id ?? null;
        }

        if (input === null) {
          console.log(`[webhook] ignored unsupported message type: ${message.type} from ${from}`);
          await sendText(
            from,
            "Sorry, I didn't catch that. Type *menu* to see the options again."
          );
          continue;
        }

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
