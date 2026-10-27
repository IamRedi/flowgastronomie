#!/usr/bin/env node
// Fills the local db:seed venue "Restaurant Olive" with a realistic service
// evening for screenshots and live demos: product photos, more tables, an open
// shift and register, counter sales, table orders in every kitchen state,
// guest calls and recorded payments. Everything goes through the public API,
// so prices, permissions and state machines are the real ones.
//
// Usage (API and web running locally, fresh `npm run db:seed` first):
//   npm run demo:showcase
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const api = new URL(process.env.API_URL ?? "http://localhost:4000");
if (!["localhost", "127.0.0.1", "[::1]"].includes(api.hostname))
  throw new Error("demo:showcase only runs against a local API");
const origin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "apps/web/public");
let cookie = "";

async function call(method, path, body, headers = {}) {
  const raw = Buffer.isBuffer(body);
  const response = await fetch(new URL(path, api), {
    method,
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined
        ? {}
        : { "content-type": raw ? "image/webp" : "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  const session = setCookie.find((c) =>
    c.startsWith("flowgastronomie_staff_session="),
  );
  if (session) cookie = session.split(";")[0];
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok)
    throw new Error(`${method} ${path} -> ${response.status} ${text}`);
  return data;
}
const once = () => ({ "idempotency-key": randomUUID() });
const names = (de, en, it, sq) =>
  [
    ["de", de],
    ["en", en],
    ["it", it],
    ["sq", sq],
  ].map(([locale, name]) => ({ locale, name }));

await call("POST", "/v1/auth/login", {
  email: "owner@flowgastronomie.local",
  password: "Demo1234!",
});

// 1. Extra dishes that match the photos shipped in this repository.
const extra = [
  [
    "demo-category-pizza",
    1490,
    "KITCHEN",
    "prosciutto",
    names(
      "Prosciutto e rucola",
      "Prosciutto & rocket",
      "Prosciutto e rucola",
      "Prosciutto me rukola",
    ),
  ],
  [
    "demo-category-pizza",
    1390,
    "KITCHEN",
    "vegetariana",
    names("Vegetariana", "Vegetariana", "Vegetariana", "Vegjetariane"),
  ],
  [
    "demo-category-starters",
    890,
    "KITCHEN",
    "salad",
    names(
      "Insalata mista",
      "Mixed salad",
      "Insalata mista",
      "Sallatë e përzier",
    ),
  ],
  [
    "demo-category-bar",
    260,
    "BAR",
    "coffee-1",
    names("Espresso", "Espresso", "Espresso", "Espresso"),
  ],
  [
    "demo-category-bar",
    340,
    "BAR",
    "coffee-2",
    names("Cappuccino", "Cappuccino", "Cappuccino", "Kapuçino"),
  ],
  [
    "demo-category-bar",
    650,
    "BAR",
    "wine-2",
    names(
      "Hauswein rot 0,2 l",
      "House red 0.2 l",
      "Vino rosso 0,2 l",
      "Verë e kuqe 0,2 l",
    ),
  ],
];
const menu = await call("GET", "/v1/staff/pos/menu?locale=de");
const existing = new Map(
  menu.categories.flatMap((c) => c.products.map((p) => [p.name, p.id])),
);
const kitchenIds = [];
const barIds = [];
const photos = {
  "demo-product-margherita": "pilot/demo-food/margherita.webp",
  "demo-product-diavola": "pilot/demo-food/salami.webp",
  "demo-product-tartufo-pizza": "pilot/demo-food/funghi.webp",
  "demo-product-tiramisu": "pilot/demo-food/dessert.webp",
};
const images = {
  prosciutto: "pilot/demo-food/prosciutto.webp",
  vegetariana: "pilot/demo-food/vegetariana.webp",
  salad: "pilot/demo-food/salad.webp",
  "coffee-1": "showcases/products/coffee-1.webp",
  "coffee-2": "showcases/products/coffee-2.webp",
  "wine-2": "showcases/products/wine-2.webp",
};
for (const [
  index,
  [categoryId, priceMinor, station, image, translations],
] of extra.entries()) {
  let id = existing.get(translations[0].name);
  if (!id) {
    const created = await call("POST", "/v1/staff/menu/products", {
      categoryId,
      priceMinor,
      sortOrder: 20 + index,
      available: true,
      published: true,
      station,
      translations,
    });
    id = created.product?.id ?? created.id;
  }
  photos[id] = images[image];
  (station === "BAR" ? barIds : kitchenIds).push(id);
}
// Same explicit demo tax categories as the seed (not statutory VAT advice).
for (const [code, rateBasisPoints, productIds] of [
  ["DEMO_TEST_10", 1000, kitchenIds],
  ["DEMO_TEST_20", 2000, barIds],
])
  await call("PUT", "/v1/staff/pos/tax", { code, rateBasisPoints, productIds });
for (const [productId, file] of Object.entries(photos))
  await call(
    "PUT",
    `/v1/workspace/products/${encodeURIComponent(productId)}/media?approved=true`,
    await readFile(join(publicDir, file)),
  );
console.log(`Photos: ${Object.keys(photos).length} products`);

// 2. A small dining room next to the seeded terrace table 07.
const setup = await call("GET", "/v1/staff/setup");
let hall = setup.areas.find((a) => a.name === "Saal");
if (!hall)
  hall = await call("POST", "/v1/staff/setup/areas", {
    name: "Saal",
    serviceModeOverride: null,
  });
const qr = { "07": "demo-table-07" };
const tableIds = Object.fromEntries(setup.tables.map((t) => [t.label, t.id]));
for (const label of ["01", "02", "03", "04", "05", "06"]) {
  if (tableIds[label]) continue;
  const created = await call("POST", "/v1/staff/setup/tables", {
    label,
    areaId: hall.id,
    serviceModeOverride: null,
  });
  tableIds[label] = created.table.id;
  qr[label] = created.qrToken;
}

// 3. Open shift and register.
const { shift } = await call("GET", "/v1/staff/shift");
if (!shift) await call("POST", "/v1/staff/shift/start", {});
const register = await call("GET", "/v1/staff/register");
if (!register.session)
  await call("POST", "/v1/staff/register/open", {
    openingCashMinor: 15000,
    openingNote: "Wechselgeld",
  });

// 4. Orders through the evening.
const item = (productId, quantity = 1, extra = {}) => ({
  productId,
  quantity,
  ...extra,
});
async function order(orderType, items, tableLabel) {
  const created = await call(
    "POST",
    "/v1/staff/orders",
    {
      orderType,
      ...(tableLabel ? { tableId: tableIds[tableLabel] } : {}),
      locale: "de",
      items,
    },
    once(),
  );
  return created.order ?? created;
}
// Moves every station ticket of the order forward, like the kitchen and bar
// boards do: NEW -> PREPARING -> READY -> SERVED.
const flow = ["NEW", "PREPARING", "READY", "SERVED"];
async function advance(placed, target) {
  for (const station of ["KITCHEN", "BAR"]) {
    const tickets = (
      await call("GET", `/v1/staff/production/${station}`)
    ).filter((ticket) => ticket.orderId === placed.id);
    for (let ticket of tickets)
      while (flow.indexOf(ticket.status) < flow.indexOf(target)) {
        const next = flow[flow.indexOf(ticket.status) + 1];
        const updated = await call(
          "PATCH",
          `/v1/staff/production-tickets/${encodeURIComponent(ticket.id)}/status`,
          { status: next, expectedVersion: ticket.version },
        );
        ticket = { ...ticket, ...(updated.ticket ?? updated), status: next };
        if (!Number.isInteger(ticket.version)) ticket.version += 1;
      }
  }
  return placed;
}
async function pay(placed, method) {
  const total = placed.totalMinor;
  await call(
    "POST",
    `/v1/staff/pos/orders/${encodeURIComponent(placed.id)}/payment`,
    method === "CASH"
      ? { method, receivedMinor: Math.ceil(total / 500) * 500 }
      : { method: "CARD_AT_COUNTER", terminalConfirmed: true },
    once(),
  );
}
const ids = Object.fromEntries(
  (await call("GET", "/v1/staff/pos/menu?locale=de")).categories.flatMap((c) =>
    c.products.map((p) => [p.name, p.id]),
  ),
);
const p = (name) => {
  if (!ids[name]) throw new Error(`Missing product ${name}`);
  return ids[name];
};

const served = [
  [
    "TAKEAWAY",
    [item(p("Margherita 2.0"), 2), item(p("Diavola"))],
    null,
    "CASH",
  ],
  [
    "TAKEAWAY",
    [item(p("Prosciutto e rucola")), item(p("Espresso"), 2)],
    null,
    "CARD",
  ],
  [
    "DINE_IN",
    [
      item(p("Insalata mista")),
      item(p("Vegetariana")),
      item(p("Hauswein rot 0,2 l"), 2),
    ],
    "02",
    "CARD",
  ],
  [
    "DINE_IN",
    [
      item(p("Burrata der Saison")),
      item(p("Rigatoni al ragù"), 2),
      item(p("Klassisches Tiramisù"), 2),
      item(p("Cappuccino"), 2),
    ],
    "04",
    "CASH",
  ],
  [
    "TAKEAWAY",
    [item(p("Tartufo bianco")), item(p("Vanille-Panna-cotta"))],
    null,
    "CARD",
  ],
];
for (const [type, items, table, method] of served) {
  const placed = await order(type, items, table);
  const done = await advance(placed, "SERVED");
  await pay(done, method);
}
await advance(
  await order(
    "DINE_IN",
    [
      item(p("Gegrillter Wolfsbarsch")),
      item(p("Rindercarpaccio")),
      item(p("Mediterraner Spritz"), 2),
    ],
    "01",
  ),
  "PREPARING",
);
await advance(
  await order(
    "DINE_IN",
    [
      item(p("Diavola")),
      item(p("Margherita 2.0")),
      item(p("Alkoholfreier Garden"), 2),
    ],
    "03",
  ),
  "READY",
);
await advance(
  await order(
    "DINE_IN",
    [
      item(p("Knusprige Calamari")),
      item(p("Trüffel-Arancini")),
      item(p("Mediterraner Spritz"), 2),
    ],
    "05",
  ),
  "NEW",
);
console.log("Orders: 5 served and paid, 3 in service");

// 5. Guests at the table: a QR order and service calls for the radar.
async function guest(label) {
  const session = await call(
    "POST",
    `/v1/public/tables/${encodeURIComponent(qr[label])}/sessions`,
    {},
  );
  return session;
}
const terrace = await guest("07");
await call(
  "POST",
  `/v1/public/sessions/${encodeURIComponent(terrace.sessionId ?? terrace.session?.id)}/requests`,
  { type: "WATER_REQUEST" },
  { ...once(), "x-guest-token": terrace.guestToken },
);
if (qr["06"]) {
  const six = await guest("06");
  await call(
    "POST",
    `/v1/public/sessions/${encodeURIComponent(six.sessionId ?? six.session?.id)}/requests`,
    { type: "WAITER_CALL" },
    { ...once(), "x-guest-token": six.guestToken },
  );
}
console.log("Guest calls: tables 06 and 07");

// 6. Website hero photo, then publish the draft.
await call(
  "PUT",
  "/v1/workspace/website/assets/HERO",
  await readFile(join(publicDir, "showcases/restaurant.webp")),
);
await call("POST", "/v1/workspace/website/publish", {});
console.log("Website: hero photo published");
