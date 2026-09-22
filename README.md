# Oven Art WhatsApp Bot (retail)

Prototype WhatsApp ordering bot for Oven Art Craft Bakery, retail division only.
Simbisa (wholesale) division will get its own number/bot later.

Products and prices in `src/products.js` are **mock data** — real names and
descriptions were pulled from ovenart.co.zw, but pricing is a placeholder
until the client sends the actual price list.

## Try it without any WhatsApp setup

```
npm install
node src/localTest.js
```

This chats with the order flow directly in your terminal so you can sanity
check the menu -> cart -> checkout flow before wiring up real WhatsApp
credentials.

## Running for real (Meta WhatsApp Cloud API)

1. Create a Meta developer app at https://developers.facebook.com/apps and
   add the "WhatsApp" product.
2. Under WhatsApp > API Setup, grab a temporary access token and the
   "Phone number ID" of the test number Meta gives you.
3. Copy `.env.example` to `.env` and fill in:
   - `WHATSAPP_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_VERIFY_TOKEN` (any string you choose)
   - `BAKERY_NOTIFY_NUMBER` (WhatsApp number that should receive completed
     order summaries, E.164 digits only, e.g. `263771234567`)
4. Start the server: `npm start` (defaults to port 3000).
5. Expose it publicly for the webhook (for local dev, `ngrok http 3000`
   works well).
6. In the Meta app's WhatsApp > Configuration page, set the webhook URL to
   `https://<your-domain>/webhook` and the verify token to whatever you put
   in `WHATSAPP_VERIFY_TOKEN`. Subscribe to the `messages` field.
7. Message the test number from WhatsApp and the bot should reply.

Meta's test number can only message numbers you've added as testers until
the app goes through business verification — that's the point where we
switch to the real Econet-based production number.

## Deploying

Not deployed anywhere yet. Needs a small always-on Node host (Railway,
Render, a cheap VPS, etc.) reachable over HTTPS for the webhook — cost is on
the client per the earlier agreement.
