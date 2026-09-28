# Oven Art WhatsApp Bot (retail)

Prototype WhatsApp ordering bot for Oven Art Craft Bakery — retail division.
The Simbisa (wholesale) division will get its own separate number and bot later.

Products in `src/products.js` use real names/descriptions pulled from
[ovenart.co.zw](https://www.ovenart.co.zw/) — prices are **placeholder values**
until the client sends the actual price list.

---

## Quick test — no WhatsApp credentials needed

```bash
npm install
node src/localTest.js
```

This drops you into a terminal REPL that talks directly to the order flow.
Great for testing the menu → cart → checkout path before touching any Meta
credentials.

---

## Running against the real Meta test number

### 1. Get your credentials

1. Go to [Meta for Developers](https://developers.facebook.com/apps) → your app → **WhatsApp → API Setup**.
2. Copy the **temporary access token** (it expires every 24 h — generate a fresh one each dev session).
3. The **Phone Number ID** for the test number is already in `.env.example`.

> **Test number:** +1 (555) 148-7133  
> **Phone Number ID:** `1346175845241870`  
> **WhatsApp Business Account ID:** `2146214976105293`

### 2. Fill in `.env`

```bash
cp .env.example .env
```

Open `.env` and set:

| Variable | Value |
|---|---|
| `WHATSAPP_TOKEN` | Paste the 24 h access token from Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | Already set — `1346175845241870` |
| `WHATSAPP_VERIFY_TOKEN` | Any secret string — use `ovenart-verify-token` or choose your own |
| `BAKERY_NOTIFY_NUMBER` | Leave blank for now (orders print to console) |

### 3. Start the server

```bash
npm start        # production-style, port 3000
# or
npm run dev      # nodemon auto-restarts on file changes
```

The console will print:

```
🍞  Oven Art bot listening on port 3000
   Health check → http://localhost:3000/health
```

Hit `http://localhost:3000/health` to confirm all env vars are set correctly.

### 4. Expose the server with ngrok

Open a **second terminal** and run:

```bash
ngrok http 3000
```

Ngrok will print a public HTTPS URL like:

```
Forwarding   https://abc123.ngrok-free.app → http://localhost:3000
```

Copy that URL — you'll need it in the next step.

> **Tip:** The ngrok URL changes every time you restart ngrok unless you have a
> paid/reserved domain. When it changes, update the webhook URL in Meta.

### 5. Register the webhook with Meta

1. Go to your Meta app → **WhatsApp → Configuration**.
2. Under **Webhook**, click **Edit**.
3. Set **Callback URL** to: `https://<your-ngrok-url>/webhook`
4. Set **Verify token** to the same value you put in `WHATSAPP_VERIFY_TOKEN`.
5. Click **Verify and Save** — Meta will call `GET /webhook` and the server will
   respond with the challenge. You should see `[webhook-verify] ✓ verified` in
   the console.
6. Under **Webhook fields**, enable the **messages** subscription.

### 6. Add yourself as a tester

Meta's test number can only message WhatsApp numbers that have been explicitly
added as testers.

1. Go to **WhatsApp → API Setup → To**.
2. Click **Manage phone number list** and add your number.
3. WhatsApp will prompt you to opt in — accept it.

### 7. Send a message

Open WhatsApp and message **+1 (555) 148-7133**. You should get the welcome
menu back within a few seconds.

---

## Global commands (work from any point in the conversation)

| Command | What it does |
|---|---|
| `menu` | Shows the full menu and resets the conversation |
| `hi` / `hello` / `start` | Same as menu |
| `restart` / `cancel` / `reset` | Clears cart and restarts from the beginning |

---

## Order flow

```
Any first message
  └─► Welcome menu (BROWSING)
        ├─► 1–7          → "How many?" (AWAITING_QTY)
        │     └─► qty    → item added, back to BROWSING
        ├─► cart         → show cart contents
        └─► checkout     → "What name?" (CHECKOUT_NAME)
              └─► name   → "Pickup or delivery?" (CHECKOUT_LOCATION)
                    └─► location → Order summary + YES/NO (CHECKOUT_CONFIRM)
                          ├─► YES → order sent to bakery, session reset
                          └─► NO  → cancelled, session reset
```

---

## Deploying (when ready to go live)

The bot needs an always-on HTTPS host. Good cheap options:

| Platform | Notes |
|---|---|
| [Railway](https://railway.app) | Free tier, auto-deploy from GitHub, HTTPS included |
| [Render](https://render.com) | Free tier (spins down after 15 min idle on free plan) |
| VPS (e.g. Hetzner €4/mo) | Full control, doesn't spin down |

Steps:
1. Push the repo to GitHub.
2. Deploy to your chosen host and set the same env vars from `.env`.
3. Update the Meta webhook URL to the production domain.
4. Switch `WHATSAPP_PHONE_NUMBER_ID` to the live Econet number once
   Meta business verification is complete.

---

## Project structure

```
src/
  server.js      — Express app, webhook endpoints, /health check
  whatsapp.js    — Meta Cloud API client (sendText)
  orderFlow.js   — Conversation state machine, cart, checkout
  session.js     — In-memory session store (swap for Redis in production)
  products.js    — Product catalogue (update prices when client sends list)
  localTest.js   — Terminal REPL for local testing without credentials
```
