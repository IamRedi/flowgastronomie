import type { LabCatalogItem } from "@flowgastronomie/domain";
import { names, saveLocal, type provision, type PosMenu } from "./provision.js";
type Spec = {
  key: string;
  group: string;
  category: LabCatalogItem["category"];
  price: number;
  names: [string, string, string, string];
  options?: boolean;
};
const de: Spec[] = [
  {
    key: "margherita",
    group: "Pizza",
    category: "MEAL",
    price: 890,
    names: ["Margherita", "Margherita", "Margherita", "Margherita"],
    options: true,
  },
  {
    key: "salami",
    group: "Pizza",
    category: "MEAL",
    price: 1090,
    names: ["Salami pizza", "Salamipizza", "Pizza salame", "Pica me sallam"],
    options: true,
  },
  {
    key: "vegetable",
    group: "Pizza",
    category: "MEAL",
    price: 1190,
    names: [
      "Vegetable pizza",
      "Gemüsepizza",
      "Pizza vegetariana",
      "Pica me perime",
    ],
    options: true,
  },
  {
    key: "tonno",
    group: "Pizza",
    category: "MEAL",
    price: 1190,
    names: ["Tuna pizza", "Thunfischpizza", "Pizza tonno", "Pica me ton"],
    options: true,
  },
  {
    key: "funghi",
    group: "Pizza",
    category: "MEAL",
    price: 990,
    names: ["Mushroom pizza", "Pilzpizza", "Pizza funghi", "Pica me kërpudha"],
    options: true,
  },
  {
    key: "quattro",
    group: "Pizza",
    category: "MEAL",
    price: 1290,
    names: [
      "Four cheese pizza",
      "Vier-Käse-Pizza",
      "Pizza quattro formaggi",
      "Pica me katër djathëra",
    ],
    options: true,
  },
  ...[
    [
      "garlic",
      "Garlic bread",
      "Knoblauchbrot",
      "Pane all'aglio",
      "Bukë me hudhër",
      450,
    ],
    [
      "salad",
      "Green salad",
      "Grüner Salat",
      "Insalata verde",
      "Sallatë jeshile",
      550,
    ],
    ["fries", "Fries", "Pommes", "Patatine", "Patate të skuqura", 390],
    ["olives", "Olives", "Oliven", "Olive", "Ullinj", 350],
  ].map(([key, en, de, it, sq, price]) => ({
    key: String(key),
    group: "Sides",
    category: "SIDE" as const,
    price: Number(price),
    names: [String(en), String(de), String(it), String(sq)] as Spec["names"],
  })),
  ...[
    [
      "water",
      "Mineral water",
      "Mineralwasser",
      "Acqua minerale",
      "Ujë mineral",
      250,
    ],
    ["cola", "Cola", "Cola", "Cola", "Kola", 300],
    [
      "orange",
      "Orange juice",
      "Orangensaft",
      "Succo d'arancia",
      "Lëng portokalli",
      350,
    ],
    ["iced", "Iced tea", "Eistee", "Tè freddo", "Çaj i ftohtë", 320],
  ].map(([key, en, de, it, sq, price]) => ({
    key: String(key),
    group: "Drinks",
    category: "DRINK" as const,
    price: Number(price),
    names: [String(en), String(de), String(it), String(sq)] as Spec["names"],
  })),
  ...[
    ["tiramisu", "Tiramisu", "Tiramisu", "Tiramisù", "Tiramisu", 550],
    ["panna", "Panna cotta", "Panna cotta", "Panna cotta", "Pana kota", 490],
    ["gelato", "Ice cream", "Eis", "Gelato", "Akullore", 450],
    [
      "cake",
      "Chocolate cake",
      "Schokoladenkuchen",
      "Torta al cioccolato",
      "Tortë çokollate",
      590,
    ],
  ].map(([key, en, de, it, sq, price]) => ({
    key: String(key),
    group: "Desserts",
    category: "DESSERT" as const,
    price: Number(price),
    names: [String(en), String(de), String(it), String(sq)] as Spec["names"],
  })),
];
const al: Spec[] = [
  ...[
    ["kosi", "Tavë kosi", "Tavë kosi", "Tavë kosi", "Tavë kosi", 800],
    ["fergese", "Fërgesë", "Fërgesë", "Fërgesë", "Fërgesë", 600],
    [
      "byrek",
      "Spinach byrek",
      "Spinat-Byrek",
      "Byrek agli spinaci",
      "Byrek me spinaq",
      350,
    ],
    [
      "beans",
      "Bean stew",
      "Bohneneintopf",
      "Stufato di fagioli",
      "Fasule",
      550,
    ],
    [
      "rice",
      "Chicken with rice",
      "Hähnchen mit Reis",
      "Pollo con riso",
      "Pulë me oriz",
      750,
    ],
    [
      "fish",
      "Baked fish",
      "Ofenfisch",
      "Pesce al forno",
      "Peshk në furrë",
      1200,
    ],
    [
      "pasta",
      "Vegetable pasta",
      "Gemüsepasta",
      "Pasta alle verdure",
      "Makarona me perime",
      650,
    ],
    [
      "soup",
      "Seasonal soup",
      "Saisonale Suppe",
      "Zuppa di stagione",
      "Supë e stinës",
      400,
    ],
  ].map(([key, en, de, it, sq, price]) => ({
    key: String(key),
    group: "Main dishes",
    category: "MEAL" as const,
    price: Number(price) * 100,
    names: [String(en), String(de), String(it), String(sq)] as Spec["names"],
  })),
  ...[
    ["qofte", "Qofte", "Qofte", "Qofte", "Qofte", 650],
    [
      "chicken",
      "Grilled chicken",
      "Gegrilltes Hähnchen",
      "Pollo alla griglia",
      "Pulë në zgarë",
      800,
    ],
    [
      "beef",
      "Grilled beef",
      "Rindfleisch vom Grill",
      "Manzo alla griglia",
      "Mish viçi në zgarë",
      1100,
    ],
    [
      "lamb",
      "Grilled lamb",
      "Lamm vom Grill",
      "Agnello alla griglia",
      "Mish qengji në zgarë",
      1250,
    ],
    [
      "veg",
      "Grilled vegetables",
      "Grillgemüse",
      "Verdure grigliate",
      "Perime në zgarë",
      500,
    ],
  ].map(([key, en, de, it, sq, price]) => ({
    key: String(key),
    group: "Grill",
    category: "MEAL" as const,
    price: Number(price) * 100,
    names: [String(en), String(de), String(it), String(sq)] as Spec["names"],
  })),
  ...[
    [
      "salad",
      "Village salad",
      "Bauernsalat",
      "Insalata rustica",
      "Sallatë fshati",
      350,
    ],
    [
      "potato",
      "Roasted potatoes",
      "Ofenkartoffeln",
      "Patate al forno",
      "Patate në furrë",
      300,
    ],
    ["pilaf", "Rice pilaf", "Pilaw", "Riso pilaf", "Pilaf", 250],
    [
      "bread",
      "Fresh bread",
      "Frisches Brot",
      "Pane fresco",
      "Bukë e freskët",
      100,
    ],
  ].map(([key, en, de, it, sq, price]) => ({
    key: String(key),
    group: "Sides",
    category: "SIDE" as const,
    price: Number(price) * 100,
    names: [String(en), String(de), String(it), String(sq)] as Spec["names"],
  })),
  ...[
    [
      "water",
      "Mineral water",
      "Mineralwasser",
      "Acqua minerale",
      "Ujë mineral",
      100,
    ],
    [
      "lemon",
      "Lemon juice",
      "Zitronensaft",
      "Succo di limone",
      "Lëng limoni",
      200,
    ],
    ["coffee", "Coffee", "Kaffee", "Caffè", "Kafe", 150],
    ["tea", "Mountain tea", "Bergtee", "Tè di montagna", "Çaj mali", 150],
  ].map(([key, en, de, it, sq, price]) => ({
    key: String(key),
    group: "Drinks",
    category: "DRINK" as const,
    price: Number(price) * 100,
    names: [String(en), String(de), String(it), String(sq)] as Spec["names"],
  })),
  ...[
    ["trilece", "Trileçe", "Trileçe", "Trileçe", "Trileçe", 350],
    ["baklava", "Baklava", "Baklava", "Baklava", "Bakllava", 300],
    [
      "fruit",
      "Fresh fruit",
      "Frisches Obst",
      "Frutta fresca",
      "Fruta të freskëta",
      250,
    ],
  ].map(([key, en, de, it, sq, price]) => ({
    key: String(key),
    group: "Desserts",
    category: "DESSERT" as const,
    price: Number(price) * 100,
    names: [String(en), String(de), String(it), String(sq)] as Spec["names"],
  })),
];
export async function expandLabVenue(
  context: Awaited<ReturnType<typeof provision>>,
) {
  const { state, clients, publicSlug } = context,
    owner = clients.owner!,
    profile = state.actors.owner!.staff!.email.includes(".de@") ? "DE" : "AL";
  if (state.catalogVersion === 2 && state.catalog && state.tables)
    return state.catalog;
  const specs = profile === "DE" ? de : al;
  let menu = await owner.request<{
    categories: Array<{
      id: string;
      translations: Array<{ locale: string; name: string }>;
      products: Array<{
        id: string;
        translations: Array<{ locale: string; name: string }>;
      }>;
    }>;
  }>("GET", "/v1/staff/menu");
  const ids = new Map<string, string>();
  for (const group of [...new Set(specs.map((s) => s.group))]) {
    const label = "TEST ONLY " + profile + " " + group;
    let category = menu.categories.find((c) =>
      c.translations.some((t) => t.name === label),
    );
    if (!category)
      category = await owner.request("POST", "/v1/staff/menu/categories", {
        sortOrder: 10 + ids.size,
        published: true,
        translations: names(label),
      });
    ids.set(group, category!.id);
  }
  const map = new Map<string, string>();
  for (const [index, spec] of specs.entries()) {
    const name = "TEST ONLY " + spec.names[0];
    const existing = menu.categories
      .flatMap((c) => c.products)
      .find((p) =>
        p.translations.some((t) => t.locale === "en" && t.name === name),
      );
    const input = {
      categoryId: ids.get(spec.group)!,
      priceMinor: spec.price,
      sortOrder: index,
      available: true,
      published: true,
      station: spec.category === "DRINK" ? "BAR" : "KITCHEN",
      translations: ["en", "de", "it", "sq"].map((locale, i) => ({
        locale,
        name: "TEST ONLY " + spec.names[i]!,
        description:
          "TEST ONLY synthetic menu data; no allergen or legal claims.",
      })),
    };
    const product =
      existing ??
      (await owner.request<{ id: string }>(
        "POST",
        "/v1/staff/menu/products",
        input,
      ));
    map.set(spec.key, product.id);
    if (spec.options || spec.key === "kosi")
      await owner.request(
        "PUT",
        `/v1/staff/menu/products/${product.id}/configuration`,
        {
          variants: [
            {
              priceDeltaMinor: 0,
              sortOrder: 0,
              available: true,
              isDefault: true,
              translations: names("TEST ONLY Standard"),
            },
            {
              priceDeltaMinor: profile === "DE" ? 250 : 30000,
              sortOrder: 1,
              available: true,
              isDefault: false,
              translations: names("TEST ONLY Large"),
            },
          ],
          modifierGroups: [
            {
              minSelect: 0,
              maxSelect: 2,
              sortOrder: 0,
              translations: names("TEST ONLY Extras"),
              options: [
                {
                  priceDeltaMinor: profile === "DE" ? 120 : 5000,
                  sortOrder: 0,
                  available: true,
                  translations: names("TEST ONLY Extra cheese"),
                },
                {
                  priceDeltaMinor: profile === "DE" ? 150 : 5000,
                  sortOrder: 1,
                  available: true,
                  translations: names("TEST ONLY Extra mushrooms"),
                },
              ],
            },
          ],
        },
      );
  }
  await owner.request("PUT", "/v1/staff/pos/tax", {
    code: "TEST_ONLY_" + profile,
    rateBasisPoints: profile === "DE" ? 1900 : 2000,
    takeawayRateBasisPoints: profile === "DE" ? 700 : 2000,
    dineInRateBasisPoints: profile === "DE" ? 1900 : 2000,
    productIds: [...map.values()],
  });
  const pos = await owner.request<PosMenu>(
    "GET",
    "/v1/staff/pos/menu?locale=en",
  );
  const products = pos.categories.flatMap((c) => c.products);
  state.catalog = specs.map((spec) => {
    const p = products.find((p) => p.id === map.get(spec.key))!;
    return {
      key: profile.toLowerCase() + "-" + spec.key,
      productId: p.id,
      name: p.name,
      priceMinor: spec.price,
      category: spec.category,
      station: spec.category === "DRINK" ? "BAR" : "KITCHEN",
      ...(spec.options || spec.key === "kosi"
        ? {
            variantId: p.variants.find(
              (v) => v.priceDeltaMinor === (profile === "DE" ? 250 : 30000),
            )!.id,
            variantDelta: profile === "DE" ? 250 : 30000,
            modifierId: p.modifierGroups[0]!.options[0]!.id,
            modifierDelta: profile === "DE" ? 120 : 5000,
          }
        : {}),
    } satisfies LabCatalogItem;
  });
  const setup = await owner.request<{
    tables: Array<{ id: string; label: string }>;
  }>("GET", "/v1/staff/setup");
  state.tables = [
    { id: state.tableId!, qrToken: state.qrToken!, label: "LAB-1" },
  ];
  for (let i = 2; i <= (profile === "DE" ? 6 : 10); i++) {
    const label = "LAB-" + i,
      existing = setup.tables.find((t) => t.label === label);
    if (existing) {
      const qr = await owner.request<{ qrToken: string }>(
        "POST",
        `/v1/staff/setup/tables/${existing.id}/rotate-qr`,
      );
      state.tables.push({ id: existing.id, qrToken: qr.qrToken, label });
    } else {
      const t = await owner.request<{ table: { id: string }; qrToken: string }>(
        "POST",
        "/v1/staff/setup/tables",
        { label, areaId: null, serviceModeOverride: "ORDER_AND_CONFIRM" },
      );
      state.tables.push({ id: t.table.id, qrToken: t.qrToken, label });
    }
  }
  const website = await owner.request<Record<string, unknown>>(
    "GET",
    "/v1/workspace/website",
  );
  // Preserve canonical editor fields and publish an explicit synthetic schedule.
  const editor = website;
  const input = Object.fromEntries(
    [
      "publicSlug",
      "primaryColor",
      "accentColor",
      "logoUrl",
      "heroImageUrl",
      "phone",
      "contactEmail",
      "address",
      "instagramUrl",
      "facebookUrl",
      "translations",
    ].map((key) => [key, editor[key]]),
  );
  await owner.request("PUT", "/v1/workspace/website", {
    ...input,
    publicSlug,
    openingHours: [
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ].map((day) => ({
      day,
      closed: false,
      opensAt: process.env.CI ? "00:00" : "10:00",
      closesAt: process.env.CI ? "23:59" : profile === "DE" ? "23:30" : "22:30",
    })),
  });
  await owner.request("POST", "/v1/workspace/website/publish");
  await owner.request("PUT", "/v1/staff/online-order-settings", {
    pickupEnabled: true,
    deliveryEnabled: false,
    cateringEnabled: false,
    pickupLeadMinutes: 10,
  });
  state.catalogVersion = 2;
  await saveLocal(profile, state);
  return state.catalog;
}
