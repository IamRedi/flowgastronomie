import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { prisma, type StaffIdentity } from "@flowgastronomie/database";
import {
  businessDateForInstant,
  WEEKDAYS,
  type LabCatalogItem,
} from "@flowgastronomie/domain";
import { LabClient } from "./client.js";
import {
  assertLabInstance,
  labVenues,
  ownerEmail,
  signupKey,
} from "./guard.js";
export const roles = {
  manager: "MANAGER",
  waiter: "WAITER",
  waiter2: "WAITER",
  cashier: "WAITER",
  kitchen: "KITCHEN",
  kitchen2: "KITCHEN",
  bar: "BAR",
  bar2: "BAR",
} as const;
export type Profile = "DE" | "AL";
export type Credential = {
  password: string;
  email: string;
  staff?: StaffIdentity;
};
export type LocalState = {
  catalogVersion?: number;
  catalog?: LabCatalogItem[];
  tables?: Array<{ id: string; qrToken: string; label: string }>;
  configuredVersion?: number;
  actors: Record<string, Credential>;
  qrToken?: string;
  tableId?: string;
  guestBusinessDate?: string;
  guestSession?: { sessionId: string; guestToken: string };
};
export const localFile = (profile: string) => `.operations-lab/${profile}.json`;
export async function saveLocal(profile: Profile, state: LocalState) {
  await writeFile(localFile(profile), JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
}
export async function localState(profile: Profile): Promise<LocalState> {
  await mkdir(".operations-lab", { recursive: true, mode: 0o700 });
  try {
    return JSON.parse(await readFile(localFile(profile), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const actors: Record<string, Credential> = {};
  for (const actor of ["owner", ...Object.keys(roles)])
    actors[actor] = {
      password: randomBytes(24).toString("base64url") + "Lab9!",
      email:
        actor === "owner"
          ? ownerEmail(profile)
          : `${actor}.${profile.toLowerCase()}@operations-lab.invalid`,
    };
  const state = { actors };
  await saveLocal(profile, state);
  return state;
}
export const names = (name: string) =>
  ["en", "de", "it", "sq"].map((locale) => ({ locale, name }));
export async function provision(profile: Profile) {
  await assertLabInstance();
  const state = await localState(profile),
    owner = new LabClient(profile);
  const found = (await labVenues()).find((v) => v.profile === profile);
  if (!found) {
    const result = await owner.request<{ staff: StaffIdentity }>(
      "POST",
      "/v1/public/trials",
      {
        organizationName: `Operations Lab ${profile} TEST ONLY`,
        venueName: `Operations Lab ${profile} TEST ONLY`,
        ownerDisplayName: `TEST ONLY ${profile} Owner`,
        email: state.actors.owner!.email,
        password: state.actors.owner!.password,
        countryCode: profile,
        timezone: profile === "DE" ? "Europe/Berlin" : "Europe/Tirane",
        currency: profile === "DE" ? "EUR" : "ALL",
        locale: profile === "DE" ? "de" : "sq",
        plan: "RESTAURANT_PRO",
        requestKey: signupKey(profile),
        profileId: profile === "DE" ? "PIZZERIA" : "RESTAURANT",
        applyCategories: true,
      },
    );
    state.actors.owner!.staff = result.staff;
    await saveLocal(profile, state);
  } else {
    const scope = await prisma.venue.findFirstOrThrow({
      where: { id: found.venue_id, tenantId: found.tenant_id },
      include: { tenant: true },
    });
    const result = await owner.request<{ staff: StaffIdentity }>(
      "POST",
      "/v1/auth/login",
      {
        tenantSlug: scope.tenant.slug,
        venueSlug: scope.slug,
        email: state.actors.owner!.email,
        password: state.actors.owner!.password,
      },
    );
    state.actors.owner!.staff = result.staff;
  }
  const clients: Record<string, LabClient> = { owner };
  for (const [actor, role] of Object.entries(roles)) {
    const credential = state.actors[actor]!;
    const team = await owner.request<{ members: Array<{ email: string }> }>(
      "GET",
      "/v1/staff/team",
    );
    if (!team.members.some((m) => m.email === credential.email)) {
      const invitation = await owner.request<{ invitationToken: string }>(
        "POST",
        "/v1/staff/team/invitations",
        { email: credential.email, role, preferredLocale: "en" },
      );
      await new LabClient(profile).request(
        "POST",
        `/v1/auth/invitations/${invitation.invitationToken}/accept`,
        {
          displayName: `TEST ONLY ${profile} ${actor}`,
          password: credential.password,
        },
      );
    }
    const c = new LabClient(profile),
      scope = state.actors.owner!.staff!;
    const login = await c.request<{ staff: StaffIdentity }>(
      "POST",
      "/v1/auth/login",
      {
        tenantSlug: scope.tenantSlug,
        venueSlug: scope.venueSlug,
        email: credential.email,
        password: credential.password,
      },
    );
    credential.staff = login.staff;
    clients[actor] = c;
  }
  await saveLocal(profile, state);
  const publicSlug = `operations-lab-${profile.toLowerCase()}`;
  const date = businessDateForInstant(
    new Date(),
    profile === "DE" ? "Europe/Berlin" : "Europe/Tirane",
  );
  const prices = profile === "DE" ? [1100, 300] : [80000, 15000];
  if (state.configuredVersion === 1)
    return { state, clients, publicSlug, date, prices };
  // Existing public/canonical workflows only; no operational row seeding.
  await owner.request("PUT", "/v1/workspace/billing/profile", {
    organizationName: `Operations Lab ${profile} TEST ONLY`,
    legalName: `TEST ONLY ${profile} Synthetic Business`,
    billingEmail: ownerEmail(profile),
    addressLine1: "TEST ONLY Fixture Street 0",
    postalCode: "00000",
    city: "TEST ONLY Fixture City",
    countryCode: profile,
    vatId: "TEST_ONLY_NOT_FISCAL",
  });
  await owner.request("PUT", "/v1/staff/setup/venue", {
    defaultServiceMode: "ORDER_AND_CONFIRM",
  });
  const setup = await owner.request<{
    tables: Array<{ id: string; label: string }>;
  }>("GET", "/v1/staff/setup");
  const table = setup.tables.find((t) => t.label === "LAB-1");
  if (!table) {
    const created = await owner.request<{
      table: { id: string };
      qrToken: string;
    }>("POST", "/v1/staff/setup/tables", {
      label: "LAB-1",
      areaId: null,
      serviceModeOverride: "ORDER_AND_CONFIRM",
    });
    state.tableId = created.table.id;
    state.qrToken = created.qrToken;
  } else {
    state.tableId = table.id;
    if (!state.qrToken)
      state.qrToken = (
        await owner.request<{ qrToken: string }>(
          "POST",
          `/v1/staff/setup/tables/${table.id}/rotate-qr`,
        )
      ).qrToken;
  }
  await saveLocal(profile, state);
  const menu = await owner.request<{
    categories: Array<{
      id: string;
      products: Array<{ id: string; translations: Array<{ name: string }> }>;
    }>;
  }>("GET", "/v1/staff/menu");
  let category = menu.categories.find((c) =>
    c.products.some((p) =>
      p.translations.some((t) => t.name.startsWith("TEST ONLY")),
    ),
  );
  if (!category) {
    category = menu.categories[0];
    if (!category)
      category = await owner.request("POST", "/v1/staff/menu/categories", {
        sortOrder: 0,
        published: true,
        translations: names("TEST ONLY Lab Menu"),
      });
  }
  await owner.request("PUT", `/v1/staff/menu/categories/${category!.id}`, {
    sortOrder: 0,
    published: true,
    translations: names("TEST ONLY Lab Menu"),
  });
  for (const [index, label] of [
    "TEST ONLY Pizza Margherita",
    "TEST ONLY Limonade",
  ].entries()) {
    if (
      !category!.products?.some((p) =>
        p.translations.some((t) => t.name === label),
      )
    ) {
      await owner.request("POST", "/v1/staff/menu/products", {
        categoryId: category!.id,
        priceMinor: prices[index],
        sortOrder: index,
        available: true,
        published: true,
        station: index === 0 ? "KITCHEN" : "BAR",
        translations: names(label),
      });
    }
  }
  const pos = await owner.request<PosMenu>(
    "GET",
    "/v1/staff/pos/menu?locale=en",
  );
  const products = pos.categories
    .flatMap((c) => c.products)
    .filter((p) => p.name.startsWith("TEST ONLY"));
  await owner.request("PUT", "/v1/staff/pos/tax", {
    code: `TEST_ONLY_${profile}`,
    rateBasisPoints: profile === "DE" ? 1900 : 2000,
    takeawayRateBasisPoints: profile === "DE" ? 700 : 2000,
    dineInRateBasisPoints: profile === "DE" ? 1900 : 2000,
    productIds: products.map((p) => p.id),
  });
  const food = products.find((p) => p.station === "KITCHEN")!;
  if (!food.variants.length)
    await owner.request(
      "PUT",
      `/v1/staff/menu/products/${food.id}/configuration`,
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
            priceDeltaMinor: profile === "DE" ? 200 : 10000,
            sortOrder: 1,
            available: true,
            isDefault: false,
            translations: names("TEST ONLY Large"),
          },
        ],
        modifierGroups: [
          {
            minSelect: 0,
            maxSelect: 1,
            sortOrder: 0,
            translations: names("TEST ONLY Extra"),
            options: [
              {
                priceDeltaMinor: profile === "DE" ? 100 : 5000,
                sortOrder: 0,
                available: true,
                translations: names("TEST ONLY Cheese"),
              },
            ],
          },
        ],
      },
    );
  await owner.request("PUT", "/v1/workspace/website", {
    publicSlug,
    primaryColor: "#173829",
    accentColor: "#d29335",
    logoUrl: null,
    heroImageUrl: null,
    phone: null,
    contactEmail: ownerEmail(profile),
    address: "TEST ONLY Fictional venue",
    instagramUrl: null,
    facebookUrl: null,
    openingHours: WEEKDAYS.map((day) => ({
      day,
      closed: false,
      opensAt: "00:00",
      closesAt: "23:59",
    })),
    translations: ["en", "de", "it", "sq"].map((locale) => ({
      locale,
      heroTitle: "TEST ONLY Operations Lab",
      heroSubtitle: "Synthetic local restaurant",
      storyTitle: "TEST ONLY",
      storyBody:
        "No real customers. All contacts and sample tax rules are synthetic.",
      seoTitle: "TEST ONLY Operations Lab",
      seoDescription: "Local synthetic test only.",
    })),
  });
  await owner.request("POST", "/v1/workspace/website/publish");
  await owner.request("PUT", "/v1/staff/online-order-settings", {
    pickupEnabled: true,
    deliveryEnabled: false,
    cateringEnabled: false,
    pickupLeadMinutes: 1,
  });
  for (const actor of Object.keys(roles)) {
    const member = state.actors[actor]!.staff!.membershipId;
    const detail = await owner.request<{
      version: number;
      contracts: Array<unknown>;
    }>("GET", `/v1/staff/workforce/profiles/${member}`);
    await owner.request("PUT", `/v1/staff/workforce/profiles/${member}`, {
      expectedVersion: detail.version,
      employmentStatus: "ACTIVE",
      employeeRef: `LAB-${profile}-${actor}`,
      jobTitle: "TEST ONLY " + actor,
      stations: [
        actor.startsWith("kitchen")
          ? "Kitchen"
          : actor.startsWith("bar")
            ? "Bar"
            : "Service",
      ],
    });
    // Contracts are versioned; read existing revision list before creating once.
    const current = await owner.request<{
      version: number;
      contracts: unknown[];
    }>("GET", `/v1/staff/workforce/profiles/${member}`);
    if (!current.contracts.length)
      await owner.request(
        "POST",
        `/v1/staff/workforce/profiles/${member}/contracts`,
        {
          expectedVersion: current.version,
          effectiveFrom: date,
          employmentType: "OTHER",
          weeklyTargetMinutes: 0,
          monthlyTargetMinutes: null,
          countryCode: profile,
          terms: "TEST ONLY synthetic lab contract; no payroll or legal claim.",
        },
      );
  }
  state.configuredVersion = 1;
  await saveLocal(profile, state);
  return { state, clients, publicSlug, date, prices };
}
export type PosProduct = {
  id: string;
  name: string;
  station: string;
  priceMinor: number;
  variants: Array<{ id: string; priceDeltaMinor: number }>;
  modifierGroups: Array<{
    options: Array<{ id: string; priceDeltaMinor: number }>;
  }>;
};
export type PosMenu = { categories: Array<{ products: PosProduct[] }> };
