# Staff order notification — Message Template (optional)

The bot messaging your bakery staff number with a new-order alert is
**business-initiated** (staff haven't messaged the bot first), so a plain
text message only works if staff happened to message the bot within the
last 24 hours. To make it reliable regardless of that, create an approved
WhatsApp Message Template once, then point the bot at it.

Without this, the bot still works fine — it falls back to plain text, and
every order is always logged to the console and the order sheet either way,
so nothing is ever silently lost.

## 1. Create the template

1. Go to your Meta app → **WhatsApp → Message Templates** (or
   [business.facebook.com/wa/manage/message-templates](https://business.facebook.com/wa/manage/message-templates)).
2. **Create template**.
   - Category: **Utility** (this is an order/transaction notification, not marketing).
   - Name: `new_order_notification` (or anything — just match it in `.env`).
   - Language: English.
3. Body text, using `{{1}}`–`{{5}}` as placeholders in this exact order:

   ```
   New order from {{1}} ({{2}}).
   {{3}}
   Items: {{4}}
   Total: ${{5}}
   ```

4. Submit for review. Simple utility templates like this are usually
   approved within minutes to about a day.

## 2. Fill in `.env`

```
BAKERY_ORDER_TEMPLATE_NAME=new_order_notification
BAKERY_ORDER_TEMPLATE_LANG=en
```

The bot fills the placeholders in this order: customer name, customer
phone, fulfillment (pickup or delivery address), item list, total.

Leave `BAKERY_ORDER_TEMPLATE_NAME` blank to skip this and use the plain-text
fallback instead.
