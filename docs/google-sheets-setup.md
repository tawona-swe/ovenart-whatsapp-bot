# Order spreadsheet setup (Google Form → Sheet)

No Google Cloud account, API keys, or service account needed — this uses a
Google Form's built-in ability to write its responses straight into a Sheet.

## 1. Create the form

1. Go to [forms.google.com](https://forms.google.com) → **+ Blank form**.
2. Name it something like "Oven Art Orders".
3. Add these questions, all as **Short answer** except Items (**Paragraph**):
   - Customer Name
   - Email
   - Phone
   - Fulfillment
   - Items
   - Total

   (You don't need a Timestamp field — Google adds one automatically.)

## 2. Link it to a Sheet

1. In the form editor, click the **Responses** tab.
2. Click the green Sheets icon (top right of that tab).
3. **Create a new spreadsheet** → Create.

That sheet now updates live every time the form gets a submission. Share
that sheet with your packing/dispatch team like any normal Google Sheet.

## 3. Get the submission URL and field IDs

1. Still in the form editor, click the **⋮** menu (top right) → **Get pre-filled link**.
2. Type something recognisable into each field (e.g. "NAMEFIELD" into
   Customer Name, "EMAILFIELD" into Email, etc.) so you can spot them later.
3. Click **Get link**, then **Copy link**.
4. Paste that link somewhere you can read it (e.g. a text editor). It looks
   like:

   ```
   https://docs.google.com/forms/d/e/1FAIpQLSc.../viewform?usp=pp_url&entry.123456789=NAMEFIELD&entry.987654321=EMAILFIELD&...
   ```

5. From that URL:
   - **`GOOGLE_FORM_URL`** — the part before `/viewform`, with `/formResponse`
     appended instead, e.g.
     `https://docs.google.com/forms/d/e/1FAIpQLSc.../formResponse`
   - **`GOOGLE_FORM_ENTRY_NAME`** — the `entry.123456789` next to whatever
     you typed into Customer Name (match it up using the placeholder text
     you typed in step 2)
   - Same for `GOOGLE_FORM_ENTRY_EMAIL`, `_PHONE`, `_FULFILLMENT`, `_ITEMS`,
     `_TOTAL` — one `entry.NNNNNNNNN` value each, matched by the placeholder
     text you used.

## 4. Fill in `.env`

Paste all 7 values into the `GOOGLE_FORM_*` variables in `.env`. Leave them
all blank to skip this feature entirely — orders still work fine without it.
