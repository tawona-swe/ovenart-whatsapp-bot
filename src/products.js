// OvenArt retail price list — VAT inclusive prices as supplied by client.
// Products are grouped into categories for a cleaner menu display.

const PRODUCTS = [
  // ── Bread (Fresh and Frozen) ──────────────────────────────────────────────
  {
    id: 1,
    category: "🍞 BREAD",
    name: "Sourdough Cheese Bread",
    description: "Classic sourdough with a cheesy twist.",
    price: 2.88,
  },
  {
    id: 2,
    category: "🍞 BREAD",
    name: "Swiss Seed Loaf",
    description: "Seeded loaf packed with wholesome Swiss seeds.",
    price: 2.88,
  },
  {
    id: 3,
    category: "🍞 BREAD",
    name: "Sourdough White",
    description: "Light, airy sourdough with a crisp crust.",
    price: 2.30,
  },
  {
    id: 4,
    category: "🍞 BREAD",
    name: "Sourdough Brown",
    description: "Overnight wholemeal sourdough, rich and hearty.",
    price: 2.30,
  },
  {
    id: 5,
    category: "🍞 BREAD",
    name: "Health Loaf",
    description: "Nutritious loaf with wholesome ingredients.",
    price: 2.88,
  },
  {
    id: 6,
    category: "🍞 BREAD",
    name: "Rosemary & Olive Oil Bread",
    description: "Rustic rosemary and olive oil bread, crispy crust.",
    price: 2.88,
  },
  {
    id: 7,
    category: "🍞 BREAD",
    name: "Plain Ciabatta",
    description: "Chewy centre, crisp golden crust.",
    price: 2.30,
  },

  // ── Frozen Pizza ──────────────────────────────────────────────────────────
  {
    id: 8,
    category: "🍕 FROZEN PIZZA",
    name: "Pizza - Chicken & Mushroom",
    description: "Tender chicken and mushroom on a hand-stretched base.",
    price: 5.03,
  },
  {
    id: 9,
    category: "🍕 FROZEN PIZZA",
    name: "Pizza - Hawaiian",
    description: "Ham and pineapple classic.",
    price: 5.03,
  },
  {
    id: 10,
    category: "🍕 FROZEN PIZZA",
    name: "Pizza - BBQ Steak",
    description: "Smoky BBQ sauce with tender steak.",
    price: 5.03,
  },
  {
    id: 11,
    category: "🍕 FROZEN PIZZA",
    name: "Pizza - Margherita",
    description: "Simple, fresh tomato and mozzarella.",
    price: 5.03,
  },
  {
    id: 12,
    category: "🍕 FROZEN PIZZA",
    name: "Pizza - Vegetarian",
    description: "Fresh garden vegetables on a crispy base.",
    price: 5.03,
  },

  // ── Tortilla Wraps ────────────────────────────────────────────────────────
  {
    id: 13,
    category: "🌯 TORTILLA WRAPS",
    name: "Plain Tortilla Large (6 Pack)",
    description: "Soft large plain tortilla wraps, pack of 6.",
    price: 2.77,
  },
  {
    id: 14,
    category: "🌯 TORTILLA WRAPS",
    name: "Plain Tortilla Small (6 Pack)",
    description: "Soft small plain tortilla wraps, pack of 6.",
    price: 2.08,
  },
  {
    id: 15,
    category: "🌯 TORTILLA WRAPS",
    name: "Whole Wheat Tortilla Large (6 Pack)",
    description: "Wholesome whole wheat large wraps, pack of 6.",
    price: 2.91,
  },
  {
    id: 16,
    category: "🌯 TORTILLA WRAPS",
    name: "Whole Wheat Tortilla Small (6 Pack)",
    description: "Wholesome whole wheat small wraps, pack of 6.",
    price: 2.22,
  },
];

// Placeholder catalog images, one per category, sourced from Wikimedia
// Commons (public domain / CC-licensed) until Oven Art sends real product
// photos. Swap these out per-product in PRODUCTS (add an `image` field) once
// real photos are available — getImageUrl() checks that first.
const CATEGORY_IMAGES = {
  "🍞 BREAD": "https://upload.wikimedia.org/wikipedia/commons/6/67/Loaf_of_sourdough_bread_cooling.jpg",
  "🍕 FROZEN PIZZA": "https://upload.wikimedia.org/wikipedia/commons/2/20/Frozen_Celeste_Pizza_For_One_June_2018.jpg",
  "🌯 TORTILLA WRAPS": "https://upload.wikimedia.org/wikipedia/commons/0/05/Tortilla.JPG",
};

function getImageUrl(product) {
  return product.image || CATEGORY_IMAGES[product.category];
}

function getProduct(id) {
  return PRODUCTS.find((p) => p.id === Number(id));
}

function formatMenu() {
  // Group by category
  const groups = {};
  for (const p of PRODUCTS) {
    if (!groups[p.category]) groups[p.category] = [];
    groups[p.category].push(p);
  }

  return Object.entries(groups)
    .map(([category, items]) => {
      const lines = items.map(
        (p) => `  ${p.id}. ${p.name} — $${p.price.toFixed(2)}\n     ${p.description}`
      );
      return `*${category}*\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

function slugify(category) {
  return category
    .replace(/^[^\sA-Za-z0-9]+\s*/, "") // strip leading emoji
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

/** Ordered list of categories as {slug, label} for the top-level interactive List. */
function getCategories() {
  const seen = new Map();
  for (const p of PRODUCTS) {
    const slug = slugify(p.category);
    if (!seen.has(slug)) seen.set(slug, p.category);
  }
  return [...seen.entries()].map(([slug, label]) => ({ slug, label }));
}

function getProductsByCategorySlug(slug) {
  return PRODUCTS.filter((p) => slugify(p.category) === slug);
}

/** Dropdown data-source for the WhatsApp Flow menu screen. */
function flowProductOptions() {
  return PRODUCTS.map((p) => ({
    id: String(p.id),
    title: `${p.name} — $${p.price.toFixed(2)}`,
    description: `${p.category.replace(/^[^\s]+\s/, "")} · ${p.description}`,
  }));
}

module.exports = {
  PRODUCTS,
  getProduct,
  formatMenu,
  flowProductOptions,
  getCategories,
  getProductsByCategorySlug,
  getImageUrl,
};
