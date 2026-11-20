export type SeedVariant = { sku: string; options: Record<string, string>; quantity: number };
export type SeedProduct = {
  store: "atelier-maya" | "field-and-co" | "harbor-home";
  category: string;
  brand: string;
  name: string;
  price: string;
  compareAt?: string;
  featured?: boolean;
  tags: string[];
  material: string;
  blurb: string;
  weight: number;
  variants: SeedVariant[];
};

const sizes = (prefix: string, color: string, quantities: number[]): SeedVariant[] =>
  ["S", "M", "L"].map((size, index) => ({ sku: `${prefix}-${size}`, options: { Color: color, Size: size }, quantity: quantities[index] ?? 8 }));

export const categories = [
  ["apparel", "Apparel", "Shirts, knits, and outerwear cut to be worn hard.", "https://picsum.photos/seed/northstar-apparel/900/700"],
  ["home", "Home", "Textiles and objects for the rooms you actually use.", "https://picsum.photos/seed/northstar-home/900/700"],
  ["kitchen", "Kitchen", "Pans, boards, and tools that stay on the counter.", "https://picsum.photos/seed/northstar-kitchen/900/700"],
  ["outdoor", "Outdoor", "Kit for walks, picnics, and early trains.", "https://picsum.photos/seed/northstar-outdoor/900/700"],
  ["beauty", "Beauty", "Small-batch oils and soaps with short ingredient lists.", "https://picsum.photos/seed/northstar-beauty/900/700", 15],
  ["wellness", "Wellness", "Candles and linen sprays for the end of the day.", "https://picsum.photos/seed/northstar-wellness/900/700"],
  ["stationery", "Stationery", "Paper and pens worth keeping on the desk.", "https://picsum.photos/seed/northstar-stationery/900/700", 5],
  ["lighting", "Lighting", "Lamps with a warm, low glare.", "https://picsum.photos/seed/northstar-lighting/900/700"],
  ["bath", "Bath", "Towels and soaps for a plain, good bathroom.", "https://picsum.photos/seed/northstar-bath/900/700"],
] as const;

export const brands = [
  ["northmill", "Northmill", "Knitwear and shirting from a Porto workroom."],
  ["hearth-oak", "Hearth & Oak", "Wood, iron, and linen for the table."],
  ["field-issue", "Field Issue", "Outdoor kit with no extra straps."],
  ["lumen-studio", "Lumen Studio", "Ceramic and brass lighting."],
  ["paper-north", "Paper North", "Notebooks bound to lie flat."],
  ["sable", "Sable Botanics", "Face oils and soaps in small batches."],
  ["keel-wool", "Keel & Wool", "Throws, cushions, and blankets."],
  ["harbor-line", "Harbor Line", "Home goods edited in Portland."],
];

export const products: SeedProduct[] = [
  { store: "atelier-maya", category: "apparel", brand: "northmill", name: "Merino Crew", price: "128.00", featured: true, tags: ["wool", "knit"], material: "merino wool", blurb: "A fine-gauge crew that layers under a coat without bunching.", weight: 280, variants: [...sizes("MC-NV", "Navy", [8, 14, 9]), ...sizes("MC-OT", "Oat", [4, 6, 3])] },
  { store: "atelier-maya", category: "apparel", brand: "northmill", name: "Linen Overshirt", price: "148.00", compareAt: "168.00", featured: true, tags: ["linen", "shirt"], material: "washed linen", blurb: "An overshirt with a real collar and a chest pocket that fits a notebook.", weight: 340, variants: sizes("LO-ST", "Stone", [6, 10, 7]) },
  { store: "atelier-maya", category: "apparel", brand: "northmill", name: "Cotton Chore Coat", price: "228.00", featured: true, tags: ["jacket", "cotton"], material: "cotton canvas", blurb: "Unlined canvas with horn buttons and a hem that covers a belt.", weight: 780, variants: sizes("CC-IN", "Indigo", [4, 7, 5]) },
  { store: "atelier-maya", category: "apparel", brand: "northmill", name: "Wide Leg Trouser", price: "138.00", tags: ["trouser"], material: "cotton twill", blurb: "A high-rise trouser with a straight, wide leg and side pockets.", weight: 420, variants: sizes("WT-CL", "Clay", [5, 9, 6]) },
  { store: "atelier-maya", category: "apparel", brand: "northmill", name: "Silk Square Scarf", price: "78.00", compareAt: "96.00", tags: ["scarf", "silk"], material: "silk twill", blurb: "A 70 centimeter square, rolled hem, in a quiet stripe.", weight: 60, variants: [{ sku: "SS-IV", options: { Color: "Ivory" }, quantity: 15 }, { sku: "SS-RS", options: { Color: "Rust" }, quantity: 9 }] },
  { store: "atelier-maya", category: "apparel", brand: "northmill", name: "Canvas Market Tote", price: "64.00", tags: ["bag"], material: "heavy canvas", blurb: "Sits open on the shoulder and stands up when you set it down.", weight: 480, variants: [{ sku: "TOTE-NT", options: { Color: "Natural" }, quantity: 20 }] },
  { store: "atelier-maya", category: "apparel", brand: "northmill", name: "Ribbed Wool Beanie", price: "42.00", tags: ["hat", "wool"], material: "lambswool", blurb: "A deep rib that stays put on a windy platform.", weight: 90, variants: [{ sku: "BEAN-CH", options: { Color: "Charcoal" }, quantity: 2 }, { sku: "BEAN-CM", options: { Color: "Camel" }, quantity: 11 }] },
  { store: "atelier-maya", category: "apparel", brand: "northmill", name: "Oxford Cloth Shirt", price: "118.00", tags: ["shirt"], material: "oxford cloth", blurb: "Button-down, mother-of-pearl buttons, cut with room through the shoulder.", weight: 250, variants: sizes("OX-WH", "White", [7, 12, 8]) },
  { store: "atelier-maya", category: "apparel", brand: "northmill", name: "Fine Knit Polo", price: "98.00", tags: ["knit", "polo"], material: "cotton knit", blurb: "A polo with a soft collar and a hem that does not flare.", weight: 220, variants: sizes("POLO-NV", "Navy", [6, 10, 6]) },
  { store: "atelier-maya", category: "apparel", brand: "northmill", name: "Selvedge Denim Jacket", price: "248.00", compareAt: "280.00", featured: true, tags: ["denim", "jacket"], material: "selvedge denim", blurb: "A trucker jacket in 13 oz denim that starts stiff and eases at the elbows.", weight: 860, variants: sizes("DJ-RW", "Raw", [3, 5, 4]) },
  { store: "atelier-maya", category: "apparel", brand: "northmill", name: "Heavyweight Tee", price: "48.00", tags: ["tee"], material: "heavy cotton", blurb: "Tubular body, bound neck, no logo.", weight: 180, variants: [...sizes("TEE-WH", "White", [10, 16, 12]), ...sizes("TEE-BK", "Black", [8, 14, 9])] },
  { store: "atelier-maya", category: "apparel", brand: "northmill", name: "Pleated Midi Skirt", price: "132.00", tags: ["skirt"], material: "wool blend", blurb: "Knife pleats that fall to the mid-calf and a side zip.", weight: 360, variants: sizes("SK-OL", "Olive", [4, 7, 5]) },
  { store: "atelier-maya", category: "apparel", brand: "northmill", name: "Bridle Leather Belt", price: "88.00", tags: ["belt", "leather"], material: "bridle leather", blurb: "A 30 millimeter belt with a brass roller buckle.", weight: 180, variants: [{ sku: "BLT-32", options: { Size: "32" }, quantity: 6 }, { sku: "BLT-34", options: { Size: "34" }, quantity: 8 }, { sku: "BLT-36", options: { Size: "36" }, quantity: 5 }] },
  { store: "atelier-maya", category: "apparel", brand: "northmill", name: "Wool Overcoat", price: "420.00", compareAt: "480.00", featured: true, tags: ["coat", "wool"], material: "wool melton", blurb: "A single-breasted overcoat with a throat latch and deep pockets.", weight: 1400, variants: sizes("OC-CM", "Camel", [2, 3, 2]) },
  { store: "atelier-maya", category: "apparel", brand: "northmill", name: "Cashmere Neck Scarf", price: "160.00", tags: ["scarf", "cashmere"], material: "cashmere", blurb: "A long, light scarf that folds small into a coat pocket.", weight: 120, variants: [{ sku: "CS-GR", options: { Color: "Grey" }, quantity: 7 }, { sku: "CS-NV", options: { Color: "Navy" }, quantity: 5 }] },
  { store: "atelier-maya", category: "apparel", brand: "northmill", name: "Workshirt", price: "108.00", tags: ["shirt", "workwear"], material: "cotton twill", blurb: "Two chest pockets, a longer back hem, and buttons that stay on.", weight: 300, variants: sizes("WS-SN", "Sand", [5, 8, 6]) },
  { store: "field-and-co", category: "kitchen", brand: "hearth-oak", name: "Ten-Inch Field Skillet", price: "98.00", featured: true, tags: ["cast-iron", "pan"], material: "cast iron", blurb: "Pre-seasoned, pour spout on both sides, and a handle that fits a mitt.", weight: 2100, variants: [{ sku: "SK-10", options: { Size: "10 inch" }, quantity: 14 }] },
  { store: "field-and-co", category: "kitchen", brand: "hearth-oak", name: "Enamel Kettle", price: "74.00", compareAt: "88.00", tags: ["kettle"], material: "enamel steel", blurb: "A two-liter kettle with a whistle you can actually hear.", weight: 900, variants: [{ sku: "KT-CR", options: { Color: "Cream" }, quantity: 10 }, { sku: "KT-GR", options: { Color: "Green" }, quantity: 6 }] },
  { store: "field-and-co", category: "outdoor", brand: "field-issue", name: "Speckled Camp Mug", price: "28.00", tags: ["mug"], material: "enamel", blurb: "Twelve ounces, rolled rim, and a speckled finish that hides tea stains.", weight: 180, variants: [{ sku: "MUG-SP", options: { Color: "Speckled" }, quantity: 30 }] },
  { store: "field-and-co", category: "outdoor", brand: "field-issue", name: "Steel Trail Bottle", price: "42.00", tags: ["bottle"], material: "stainless steel", blurb: "A 600 milliliter bottle that fits a side pocket.", weight: 240, variants: [{ sku: "BTL-SL", options: { Color: "Silver" }, quantity: 18 }] },
  { store: "field-and-co", category: "kitchen", brand: "hearth-oak", name: "Eight-Inch Chef Knife", price: "156.00", featured: true, tags: ["knife"], material: "stainless steel", blurb: "A western handle, a full tang, and an edge that takes a stone.", weight: 220, variants: [{ sku: "KN-8", options: { Size: "8 inch" }, quantity: 9 }] },
  { store: "field-and-co", category: "kitchen", brand: "hearth-oak", name: "Walnut Board", price: "86.00", tags: ["board"], material: "walnut", blurb: "An end-grain board with a juice groove and rubber feet.", weight: 1600, variants: [{ sku: "BD-MD", options: { Size: "Medium" }, quantity: 8 }] },
  { store: "field-and-co", category: "outdoor", brand: "field-issue", name: "Wool Picnic Blanket", price: "68.00", tags: ["blanket"], material: "wool blend", blurb: "Waterproof backing, leather strap, and room for four.", weight: 1100, variants: [{ sku: "PIC-ST", options: { Color: "Stripe" }, quantity: 12 }] },
  { store: "field-and-co", category: "outdoor", brand: "field-issue", name: "Trail Sock Pair", price: "24.00", tags: ["socks"], material: "merino wool", blurb: "Crew length, cushioned sole, sold as a pair.", weight: 80, variants: [{ sku: "SK-M", options: { Size: "M" }, quantity: 0 }, { sku: "SK-L", options: { Size: "L" }, quantity: 16 }] },
  { store: "field-and-co", category: "kitchen", brand: "hearth-oak", name: "Glass Pour-Over", price: "54.00", tags: ["coffee"], material: "borosilicate glass", blurb: "A 600 milliliter carafe with a cork collar.", weight: 400, variants: [{ sku: "PO-1", options: { Size: "600 ml" }, quantity: 11 }] },
  { store: "field-and-co", category: "kitchen", brand: "hearth-oak", name: "Olive Oil Cruet", price: "36.00", tags: ["oil"], material: "glass", blurb: "A slim cruet that pours without a last-second drip.", weight: 260, variants: [{ sku: "CR-CL", options: { Color: "Clear" }, quantity: 14 }] },
  { store: "field-and-co", category: "kitchen", brand: "hearth-oak", name: "Grill Pan", price: "112.00", tags: ["cast-iron"], material: "cast iron", blurb: "Raised ridges and a helper handle for the oven.", weight: 2400, variants: [{ sku: "GP-1", options: { Size: "10 inch" }, quantity: 7 }] },
  { store: "field-and-co", category: "kitchen", brand: "hearth-oak", name: "Linen Apron", price: "58.00", tags: ["apron", "linen"], material: "linen", blurb: "Cross-back straps and a pocket for a towel.", weight: 300, variants: [{ sku: "AP-NT", options: { Color: "Natural" }, quantity: 13 }] },
  { store: "field-and-co", category: "outdoor", brand: "field-issue", name: "Canvas Daypack", price: "168.00", compareAt: "190.00", featured: true, tags: ["bag"], material: "canvas", blurb: "A 16 liter pack with a laptop sleeve and no dangling clips.", weight: 700, variants: [{ sku: "PK-OL", options: { Color: "Olive" }, quantity: 8 }, { sku: "PK-SD", options: { Color: "Sand" }, quantity: 5 }] },
  { store: "field-and-co", category: "outdoor", brand: "field-issue", name: "Folding Camp Stool", price: "64.00", tags: ["stool"], material: "ash and leather", blurb: "A three-leg stool that folds flat against a pack.", weight: 900, variants: [{ sku: "ST-1", options: { Finish: "Ash" }, quantity: 0 }] },
  { store: "field-and-co", category: "kitchen", brand: "hearth-oak", name: "Beech Pepper Mill", price: "46.00", tags: ["mill"], material: "beech", blurb: "A ceramic mechanism and a mill you can refill without tools.", weight: 280, variants: [{ sku: "PM-1", options: { Height: "18 cm" }, quantity: 17 }] },
  { store: "field-and-co", category: "kitchen", brand: "hearth-oak", name: "Mixing Bowl", price: "42.00", tags: ["bowl"], material: "stoneware", blurb: "A wide bowl with a pouring lip, glazed inside only.", weight: 900, variants: [{ sku: "MB-GR", options: { Color: "Grey" }, quantity: 10 }] },
  { store: "harbor-home", category: "lighting", brand: "lumen-studio", name: "Ceramic Table Lamp", price: "186.00", featured: true, tags: ["lamp"], material: "stoneware and linen", blurb: "A drum shade and a base that takes a warm LED bulb.", weight: 2200, variants: [{ sku: "LMP-SD", options: { Color: "Sand" }, quantity: 6 }] },
  { store: "harbor-home", category: "home", brand: "harbor-line", name: "Linen Duvet Cover", price: "198.00", compareAt: "230.00", featured: true, tags: ["bed", "linen"], material: "linen", blurb: "Stone-washed, hidden buttons, queen size.", weight: 1400, variants: [{ sku: "DV-QN-IV", options: { Size: "Queen", Color: "Ivory" }, quantity: 5 }, { sku: "DV-QN-ST", options: { Size: "Queen", Color: "Stripe" }, quantity: 4 }] },
  { store: "harbor-home", category: "home", brand: "harbor-line", name: "Dinner Bowl", price: "32.00", tags: ["bowl"], material: "stoneware", blurb: "A deep bowl for soup or a late plate of noodles.", weight: 480, variants: [{ sku: "DB-IV", options: { Color: "Ivory" }, quantity: 22 }, { sku: "DB-BL", options: { Color: "Blue" }, quantity: 14 }] },
  { store: "harbor-home", category: "home", brand: "keel-wool", name: "Herringbone Throw", price: "142.00", featured: true, tags: ["throw", "wool"], material: "wool", blurb: "A throw large enough for a sofa, with a fringe that is actually even.", weight: 1100, variants: [{ sku: "TH-CH", options: { Color: "Charcoal" }, quantity: 7 }] },
  { store: "harbor-home", category: "wellness", brand: "sable", name: "Cedar Candle", price: "38.00", tags: ["candle"], material: "soy wax", blurb: "Cedar and a little smoke, in a glass you can reuse.", weight: 400, variants: [{ sku: "CD-CD", options: { Scent: "Cedar" }, quantity: 20 }] },
  { store: "harbor-home", category: "home", brand: "harbor-line", name: "Oak Wall Mirror", price: "220.00", tags: ["mirror"], material: "oak", blurb: "A round mirror with a slim oak frame, 60 centimeters across.", weight: 2800, variants: [{ sku: "MR-60", options: { Size: "60 cm" }, quantity: 4 }] },
  { store: "harbor-home", category: "lighting", brand: "lumen-studio", name: "Task Desk Lamp", price: "124.00", tags: ["lamp", "desk"], material: "brass and steel", blurb: "An adjustable arm and a shade that keeps the light on the page.", weight: 1500, variants: [{ sku: "DSK-BR", options: { Finish: "Brass" }, quantity: 8 }] },
  { store: "harbor-home", category: "bath", brand: "harbor-line", name: "Cotton Bath Bundle", price: "78.00", tags: ["towel"], material: "cotton", blurb: "Two bath towels and a hand towel, unbleached.", weight: 1200, variants: [{ sku: "BTH-NT", options: { Color: "Natural" }, quantity: 9 }] },
  { store: "harbor-home", category: "home", brand: "harbor-line", name: "Stoneware Planter", price: "48.00", tags: ["planter"], material: "stoneware", blurb: "A drainage hole and a saucer that matches.", weight: 1400, variants: [{ sku: "PL-MD", options: { Size: "Medium" }, quantity: 11 }] },
  { store: "harbor-home", category: "stationery", brand: "paper-north", name: "Clothbound Notebook", price: "28.00", tags: ["notebook"], material: "cloth and paper", blurb: "A5, lay-flat binding, 160 pages of blank cream paper.", weight: 280, variants: [{ sku: "NB-NV", options: { Color: "Navy" }, quantity: 25 }, { sku: "NB-RS", options: { Color: "Rust" }, quantity: 18 }] },
  { store: "harbor-home", category: "stationery", brand: "paper-north", name: "Fountain Pen", price: "72.00", compareAt: "84.00", tags: ["pen"], material: "brass", blurb: "A medium nib, a converter, and a cap that posts.", weight: 40, variants: [{ sku: "PEN-BK", options: { Color: "Black" }, quantity: 12 }] },
  { store: "harbor-home", category: "beauty", brand: "sable", name: "Botanical Face Oil", price: "46.00", tags: ["oil", "skin"], material: "jojoba and rosehip", blurb: "A few drops after washing. No fragrance beyond the oil itself.", weight: 90, variants: [{ sku: "OIL-30", options: { Size: "30 ml" }, quantity: 16 }] },
  { store: "harbor-home", category: "bath", brand: "sable", name: "Clay Soap Trio", price: "32.00", tags: ["soap"], material: "olive oil soap", blurb: "Three bars: clay, oat, and plain olive.", weight: 330, variants: [{ sku: "SOAP-3", options: { Set: "Trio" }, quantity: 19 }] },
  { store: "harbor-home", category: "home", brand: "harbor-line", name: "Linen Napkin Set", price: "42.00", tags: ["linen", "table"], material: "linen", blurb: "A set of four napkins, hemmed, in a color that hides lunch.", weight: 280, variants: [{ sku: "NP-ST", options: { Color: "Stone" }, quantity: 15 }] },
  { store: "harbor-home", category: "wellness", brand: "sable", name: "Linen Room Spray", price: "36.00", tags: ["spray"], material: "linen water", blurb: "A light spray for sheets. Citrus peel and a little cedar.", weight: 220, variants: [{ sku: "SP-100", options: { Size: "100 ml" }, quantity: 14 }] },
  { store: "harbor-home", category: "home", brand: "keel-wool", name: "Wool Cushion", price: "88.00", tags: ["cushion", "wool"], material: "wool", blurb: "A 50 centimeter cushion with a hidden zip and a feather insert.", weight: 900, variants: [{ sku: "CU-CM", options: { Color: "Camel" }, quantity: 8 }, { sku: "CU-IV", options: { Color: "Ivory" }, quantity: 6 }] },
];
