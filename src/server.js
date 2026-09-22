require("dotenv").config();
const express = require("express");
const { handleIncoming } = require("./orderFlow");
const { sendText } = require("./whatsapp");

const app = express();
app.use(express.json());

// Meta calls this once with a GET to verify the webhook URL.
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Incoming customer messages land here.
app.post("/webhook", async (req, res) => {
  // Ack immediately so Meta doesn't retry/timeout while we process.
  res.sendStatus(200);

  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const message = change?.messages?.[0];
  if (!message || message.type !== "text") return;

  const from = message.from; // customer's WhatsApp number, e.g. 26377xxxxxxx
  const text = message.text.body;

  try {
    const reply = await handleIncoming(from, text);
    if (reply) await sendText(from, reply);
  } catch (err) {
    console.error("[webhook] failed to handle message:", err.response?.data || err);
  }
});

app.get("/", (_req, res) => res.send("Oven Art WhatsApp bot is running."));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Oven Art bot listening on port ${port}`));
