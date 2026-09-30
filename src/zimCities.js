// Known Zimbabwean cities/towns, used to detect whether a customer's address
// actually mentions their city (so we can extract it for later use — e.g.
// zone/branch assignment — without needing a paid geocoding API).
const ZIM_CITIES = [
  "Harare",
  "Bulawayo",
  "Chitungwiza",
  "Mutare",
  "Gweru",
  "Kwekwe",
  "Kadoma",
  "Masvingo",
  "Chinhoyi",
  "Marondera",
  "Norton",
  "Ruwa",
  "Chegutu",
  "Zvishavane",
  "Bindura",
  "Beitbridge",
  "Redcliff",
  "Victoria Falls",
  "Hwange",
  "Rusape",
  "Chiredzi",
  "Kariba",
  "Karoi",
  "Shurugwi",
  "Gwanda",
  "Chipinge",
  "Chivhu",
  "Plumtree",
  "Gokwe",
  "Mvurwi",
  "Nyanga",
  "Filabusi",
  "Mberengwa",
  "Murewa",
  "Bikita",
  "Zaka",
  "Chirundu",
  "Epworth",
];

/**
 * Find a known Zimbabwean city/town mentioned anywhere in the given text.
 * @param {string} text
 * @returns {string|null} the canonical city name, or null if none found
 */
function detectCity(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const city of ZIM_CITIES) {
    const re = new RegExp(`\\b${city.toLowerCase()}\\b`);
    if (re.test(lower)) return city;
  }
  return null;
}

module.exports = { ZIM_CITIES, detectCity };
