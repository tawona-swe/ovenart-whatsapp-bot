// Generates catalog/products.csv — a Meta Commerce Manager-compatible product
// feed for bulk-uploading the menu as a WhatsApp Catalog.
// Run: node scripts/generate-catalog-feed.js
const fs = require("fs");
const path = require("path");
const { PRODUCTS, getImageUrl } = require("../src/products");

const HEADERS = ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand"];

function csvEscape(value) {
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

const rows = PRODUCTS.map((p) =>
  [
    p.id, // retailer_id — matches our internal product id
    p.name,
    p.description,
    "in stock",
    "new",
    `${p.price.toFixed(2)} USD`,
    "https://www.ovenart.co.zw/",
    getImageUrl(p),
    "Oven Art Bakery",
  ]
    .map(csvEscape)
    .join(",")
);

const csv = [HEADERS.join(","), ...rows].join("\n") + "\n";

const outDir = path.join(__dirname, "..", "catalog");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "products.csv"), csv);
console.log(`Wrote catalog/products.csv with ${PRODUCTS.length} products.`);
