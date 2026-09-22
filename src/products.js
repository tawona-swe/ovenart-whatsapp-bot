// Mock catalog — real product names/descriptions pulled from ovenart.co.zw,
// prices are placeholders until the client sends the real price list.
const PRODUCTS = [
  {
    id: 1,
    name: "Sourdough",
    description: "Rustic, crusty, yet airy and tangy tasting bread.",
    price: 5.5,
  },
  {
    id: 2,
    name: "Whole Grain & Seeds",
    description: "Crafted with whole grains and seeds for added nutrition.",
    price: 6.0,
  },
  {
    id: 3,
    name: "Olive Ciabatta",
    description: "Kalamata olives and olive tapenade folded through ciabatta dough.",
    price: 6.5,
  },
  {
    id: 4,
    name: "Rosemary & Olive Oil",
    description: "Rustic rosemary and olive oil bread, crispy crust, pillowy centre.",
    price: 6.0,
  },
  {
    id: 5,
    name: "Ciabatta",
    description: "Chewy centre, crisp golden crust.",
    price: 5.0,
  },
  {
    id: 6,
    name: "Country Brown",
    description: "Overnight brown wholemeal sourdough.",
    price: 5.5,
  },
  {
    id: 7,
    name: "Ciabatta Rolls",
    description: "Ciabatta-style rolls, ideal for sandwiches (pack).",
    price: 4.5,
  },
];

function getProduct(id) {
  return PRODUCTS.find((p) => p.id === Number(id));
}

function formatMenu() {
  return PRODUCTS.map((p) => `${p.id}. ${p.name} - $${p.price.toFixed(2)}\n   ${p.description}`).join(
    "\n\n"
  );
}

module.exports = { PRODUCTS, getProduct, formatMenu };
