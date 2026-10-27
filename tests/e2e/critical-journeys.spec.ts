import { expect, test, type Page } from "./browser-test";
import { orderingUxCopy } from "../../apps/web/lib/ordering-ux-copy";
import { publicOrderCopy } from "../../apps/web/lib/public-order-copy";

const locales = ["sq", "en", "de", "it"] as const;
type Locale = (typeof locales)[number];

const copy: Record<
  Locale,
  {
    accept: string;
    add: string;
    address: string;
    city: string;
    delivery: string;
    home: string;
    kitchen: string;
    bar: string;
    refresh: string;
    launch: string;
    name: string;
    onlineOrders: string;
    order: string;
    phone: string;
    placeOrder: string;
    postal: string;
    reports: string;
    requestSent: string;
    signIn: string;
    stationTitle: string;
    tableOrderSent: string;
    tableSendOrder: string;
    track: string;
    waiter: string;
  }
> = {
  sq: {
    home: "Kryefaqja",
    kitchen: "Kuzhina",
    bar: "Banaku",
    refresh: "Rifresko",
    accept: "Prano",
    add: "Shto",
    address: "Adresa",
    city: "Qyteti",
    delivery: "Dërgesë",
    launch: "Hape lokalin me siguri.",
    name: "Emri",
    onlineOrders: "Porositë online",
    order: "Porosit online",
    phone: "Telefoni",
    placeOrder: "Dërgo porosinë",
    postal: "Kodi postar",
    reports: "Operacionet ditore",
    requestSent: "Kërkesa jote u dërgua.",
    signIn: "Hyr",
    stationTitle: "Porosi online",
    tableOrderSent: "Porosia u dërgua me sukses.",
    tableSendOrder: "Dërgo porosinë",
    track: "Ndjek porosinë",
    waiter: "Thirr kamerierin",
  },
  en: {
    home: "Home",
    kitchen: "Kitchen",
    bar: "Bar",
    refresh: "Refresh",
    accept: "Accept",
    add: "Add",
    address: "Address",
    city: "City",
    delivery: "Delivery",
    launch: "Launch with confidence.",
    name: "Name",
    onlineOrders: "Online orders",
    order: "Order online",
    phone: "Phone",
    placeOrder: "Place order",
    postal: "Postcode",
    reports: "Daily operations",
    requestSent: "Your request was sent.",
    signIn: "Sign in",
    stationTitle: "Online orders",
    tableOrderSent: "Order sent successfully.",
    tableSendOrder: "Send order",
    track: "Track your order",
    waiter: "Call waiter",
  },
  de: {
    home: "Startseite",
    kitchen: "Küche",
    bar: "Bar",
    refresh: "Aktualisieren",
    accept: "Annehmen",
    add: "Hinzufügen",
    address: "Adresse",
    city: "Stadt",
    delivery: "Lieferung",
    launch: "Sicher live gehen.",
    name: "Name",
    onlineOrders: "Online-Bestellungen",
    order: "Online bestellen",
    phone: "Telefon",
    placeOrder: "Bestellung senden",
    postal: "Postleitzahl",
    reports: "Tagesbetrieb",
    requestSent: "Ihre Anfrage wurde gesendet.",
    signIn: "Anmelden",
    stationTitle: "Online-Bestellungen",
    tableOrderSent: "Bestellung erfolgreich gesendet.",
    tableSendOrder: "Bestellung senden",
    track: "Bestellung verfolgen",
    waiter: "Service rufen",
  },
  it: {
    home: "Home",
    kitchen: "Cucina",
    bar: "Bar",
    refresh: "Aggiorna",
    accept: "Accetta",
    add: "Aggiungi",
    address: "Indirizzo",
    city: "Città",
    delivery: "Consegna",
    launch: "Vai online con sicurezza.",
    name: "Nome",
    onlineOrders: "Ordini online",
    order: "Ordina online",
    phone: "Telefono",
    placeOrder: "Invia ordine",
    postal: "CAP",
    reports: "Operazioni giornaliere",
    requestSent: "La tua richiesta è stata inviata.",
    signIn: "Accedi",
    stationTitle: "Ordini online",
    tableOrderSent: "Ordine inviato con successo.",
    tableSendOrder: "Invia ordine",
    track: "Segui il tuo ordine",
    waiter: "Chiama il cameriere",
  },
};

async function signIn(
  page: Page,
  locale: Locale,
  email: string,
  destination = `/app/${locale}/overview`,
) {
  await page.goto(`/${locale}/staff/login`);
  await page.locator('input[name="password"]').fill("Demo1234!");
  await page.locator('input[name="email"]').fill(email);
  await page.getByRole("button", { name: copy[locale].signIn }).click();
  await expect(page).toHaveURL(new RegExp(`${destination}$`));
  const labels = copy[locale];
  const navigation = page.getByRole("navigation", { name: "Operations" });
  const home = navigation.getByRole("link", { name: labels.home, exact: true });
  await expect(home).toBeVisible();
  await expect(home).toHaveAttribute("href", `/app/${locale}/overview`);

  // Venue text is intentionally hidden in the operational rail. Assert the
  // actual role workspace is ready instead of matching a hidden brand copy.
  if (destination === `/app/${locale}/overview`) {
    await expect(page.locator(".pilot-app-shell")).toHaveClass(/is-expanded/);
    await expect(home).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: labels.home, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTestId("active-orders").locator("strong"),
    ).toHaveText(/^\d+$/);
  } else {
    await expect(page.locator(".pilot-app-shell")).toHaveClass(/is-collapsed/);
    if (destination.endsWith("/radar")) {
      await expect(
        page.getByRole("heading", { name: "Service Radar", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".real-radar")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    } else {
      const station = destination.endsWith("/bar")
        ? labels.bar
        : labels.kitchen;
      const workspace = page.getByRole("region", {
        name: station,
        exact: true,
      });
      await expect(
        navigation.getByRole("link", { name: station, exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await expect(
        workspace.getByRole("heading", { name: station, exact: true }),
      ).toBeVisible();
      await expect(
        workspace.getByRole("button", { name: labels.refresh, exact: true }),
      ).toBeEnabled();
    }
  }
}

function nextOpenLocalDateTime() {
  const candidate = new Date();
  candidate.setUTCDate(candidate.getUTCDate() + 1);
  while (candidate.getUTCDay() === 1) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  candidate.setUTCHours(18, 0, 0, 0);
  return candidate.toISOString().slice(0, 16);
}

test("new Owner can start a trial and access setup workspaces", async ({
  page,
}) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const organizationName = `E2E Hospitality ${suffix}`;
  const venueName = `E2E Venue ${suffix}`;

  await page.goto("/en/signup?plan=SMART_SERVICE");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator('input[name="organizationName"]').fill(organizationName);
  await page.locator('input[name="venueName"]').fill(venueName);
  await page.locator('select[name="countryCode"]').selectOption("AL");
  await page.locator('input[name="ownerDisplayName"]').fill("E2E Owner");
  await page
    .locator('input[name="email"]')
    .fill(`owner-${suffix}@example.test`);
  await page.locator('input[name="password"]').fill("E2ePassword123!");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();

  await expect(page).toHaveURL(/\/app\/en\/onboarding$/);
  await expect(
    page.getByRole("heading", { name: "Your menu, ready in four steps" }),
  ).toBeVisible();
  await page.goto("/app/en/overview?welcome=1");
  await expect(
    page.getByRole("complementary").getByText(venueName, { exact: true }),
  ).toBeVisible();
  await page
    .locator(".desk-header")
    .getByRole("button", { name: "Venue information", exact: true })
    .click();
  const venueInfo = page.getByRole("dialog", { name: "Venue information" });
  await expect(venueInfo.getByText(venueName, { exact: true })).toBeVisible();
  await expect(
    venueInfo.getByText(organizationName, { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/app/en/onboarding");
  await expect(
    page.getByRole("heading", { name: "Your menu, ready in four steps" }),
  ).toBeVisible();

  await page.goto("/app/en/website");
  const picker = page.getByRole("region", { name: "Choose your look" });
  await expect(picker).toBeVisible();
  await expect(picker).toContainText(venueName);
  await expect(picker.getByRole("radio")).toHaveCount(3);
  await expect(
    picker.getByRole("button", { name: /Create my website/ }),
  ).toBeVisible();
  const website = await page.request.get(
    "http://localhost:4100/v1/workspace/website",
  );
  expect(website.ok()).toBe(true);
  expect(await website.json()).toMatchObject({ venueName, status: "DRAFT" });
});

for (const locale of locales) {
  test(`${locale}: guest, staff, production and Owner journeys`, async ({
    page,
  }) => {
    // This complete journey crosses guest, manager, three staff roles and Owner.
    // Windows traces reach the final Go-Live page at the default 30s limit.
    test.setTimeout(60_000);
    const labels = copy[locale];

    await test.step("guest requests service and submits a table order", async () => {
      await page.goto(`/${locale}/menu/demo-table-07`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(
        page.getByRole("heading", { name: "Restaurant Olive" }),
      ).toBeVisible();
      await page.getByRole("button", { name: labels.waiter }).click();
      await expect(page.getByRole("status")).toHaveText(labels.requestSent);
      await page
        .getByRole("button", { name: new RegExp(`^${labels.add}:`) })
        .first()
        .click();
      await page
        .getByRole("button", { name: labels.tableSendOrder, exact: true })
        .click();
      await expect(page.getByRole("status")).toContainText(
        labels.tableOrderSent,
      );
    });

    let referenceCode = "";
    await test.step("guest places an online order and receives tracking", async () => {
      await page.goto(`/${locale}/order/restaurant-olive-demo`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator(".public-experience")).toBeVisible();
      await page.locator(".public-add").first().click();
      await page
        .getByRole("button", { name: publicOrderCopy(locale)[0], exact: true })
        .click();
      await page.locator("select").first().selectOption("DELIVERY");
      await expect(page.locator("select").first()).toHaveValue("DELIVERY");
      await expect(
        page.locator("select").first().getByRole("option", {
          name: labels.delivery,
        }),
      ).toBeAttached();
      await page
        .getByPlaceholder(labels.name)
        .fill(`Smoke ${locale.toUpperCase()}`);
      await page.getByPlaceholder(labels.phone).fill("+49 30 5550100");
      await page.getByPlaceholder(labels.address).fill("Kastanienallee 27");
      await page.getByPlaceholder(labels.postal).fill("10435");
      await page.getByPlaceholder(labels.city).fill("Berlin");
      await page
        .getByRole("button", {
          name: orderingUxCopy[locale].choose,
          exact: true,
        })
        .click();
      await page.locator(".pickup-slots button").first().click();
      await page
        .getByRole("button", { name: publicOrderCopy(locale)[1], exact: true })
        .click();
      await page
        .getByRole("button", { name: publicOrderCopy(locale)[2], exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp(
          `/${locale}/order/track/[^/?]+\\?venue=restaurant-olive-demo$`,
        ),
      );
      await expect(
        page.getByRole("heading", {
          name: orderingUxCopy[locale].track,
          exact: true,
        }),
      ).toBeVisible();
      referenceCode =
        (await page.locator("header strong").textContent())?.trim() ?? "";
      expect(referenceCode).not.toBe("");
    });

    const reservationSuffix = `${Date.now()}-${locale}`;
    const reservationGuest = `Reservation ${locale.toUpperCase()} ${reservationSuffix}`;
    const reservationRequestedFor = nextOpenLocalDateTime();
    await test.step("guest requests a reservation from the venue website", async () => {
      await page.goto(`/${locale}/venue/restaurant-olive-demo/reservations`);
      await page.locator('input[name="name"]').fill(reservationGuest);
      await page
        .locator('input[name="phone"]')
        .fill(`+49 30 ${Date.now().toString().slice(-9)}`);
      await page
        .locator('input[name="email"]')
        .fill(`reservation-${reservationSuffix}@example.test`);
      await page
        .locator('input[name="requestedFor"]')
        .fill(reservationRequestedFor);
      await page.locator('input[name="partySize"]').fill("2");
      const submitted = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes("/v1/public/reservations/restaurant-olive-demo") &&
          response.request().method() === "POST",
      );
      await page.locator("form").getByRole("button", { name: /.+/ }).click();
      expect((await submitted).status()).toBe(201);
      await expect(page.getByRole("status")).not.toBeEmpty();
    });

    await test.step("manager accepts the same order and opens both station boards", async () => {
      await signIn(page, locale, "manager@flowgastronomie.local");
      await page.goto(`/${locale}/staff/reports`);
      await expect(
        page.getByRole("heading", { name: labels.reports }),
      ).toBeVisible();
      await page.goto(`/${locale}/staff/radar`);
      const shiftResponse = await page.request.get(
        "http://localhost:4100/v1/staff/shift",
      );
      expect(shiftResponse.ok()).toBe(true);
      const current = (await shiftResponse.json()) as { shift: unknown | null };
      if (!current.shift) {
        const started = await page.request.post(
          "http://localhost:4100/v1/staff/shift/start",
          { data: {} },
        );
        expect(started.ok()).toBe(true);
      }
      await page.goto(`/app/${locale}/online-orders`);
      await expect(
        page.getByRole("heading", { name: labels.onlineOrders }),
      ).toBeVisible();
      const order = page.locator("article").filter({ hasText: referenceCode });
      await expect(order).toBeVisible();
      const acceptedResponse = page.waitForResponse(
        (response) =>
          response.url().includes(`/online-orders/${referenceCode}/status`) &&
          response.request().method() === "PATCH",
      );
      await order.getByRole("button", { name: labels.accept }).click();
      expect((await acceptedResponse).ok()).toBe(true);
      await expect(
        order.getByRole("button", { name: labels.accept }),
      ).toHaveCount(0);

      for (const station of ["kitchen", "bar"] as const) {
        await page.goto(`/${locale}/staff/${station}`);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(
          page.getByRole("heading", { name: labels.stationTitle }),
        ).toBeVisible();
        const routedOrder = page.getByText(referenceCode).first();
        if (station === "kitchen") {
          await expect(routedOrder).toBeVisible();
        } else {
          await expect(routedOrder).toHaveCount(0);
        }
      }
      const ended = await page.request.post(
        "http://localhost:4100/v1/staff/shift/end",
        { data: {} },
      );
      expect(ended.ok()).toBe(true);
    });

    await test.step("manager confirms the reservation and reviews its customer timeline", async () => {
      await page.goto(`/${locale}/staff/reservations`);
      await page
        .locator('input[type="date"]')
        .fill(reservationRequestedFor.slice(0, 10));
      const reservation = page
        .locator("article")
        .filter({ hasText: reservationGuest });
      await expect(reservation).toBeVisible();
      const confirmation = page.waitForResponse(
        (response) =>
          response.url().includes("/v1/staff/reservations/") &&
          response.request().method() === "PATCH",
      );
      await reservation.getByRole("button").first().click();
      expect((await confirmation).ok()).toBe(true);

      await page.goto(`/${locale}/staff/customers`);
      const customer = page.getByRole("button", { name: reservationGuest });
      await expect(customer).toBeVisible();
      await customer.click();
      await expect(page.getByText("Reservation · CONFIRMED")).toBeVisible();
    });

    await test.step("each staff role reaches only its intended workspace", async () => {
      await page.context().clearCookies();
      await signIn(
        page,
        locale,
        "waiter@flowgastronomie.local",
        `/${locale}/staff/radar`,
      );
      await expect(page).toHaveURL(new RegExp(`/${locale}/staff/radar$`));

      await page.context().clearCookies();
      await signIn(
        page,
        locale,
        "bar@flowgastronomie.local",
        `/${locale}/staff/bar`,
      );
      await expect(page).toHaveURL(new RegExp(`/${locale}/staff/bar$`));
      await expect(
        page.getByRole("heading", { name: labels.stationTitle }),
      ).toBeVisible();

      await page.context().clearCookies();
      await signIn(
        page,
        locale,
        "kitchen@flowgastronomie.local",
        `/${locale}/staff/kitchen`,
      );
      await expect(page).toHaveURL(new RegExp(`/${locale}/staff/kitchen$`));
      await expect(
        page.getByRole("heading", { name: labels.stationTitle }),
      ).toBeVisible();
    });

    await test.step("Owner opens the localized Go-Live center", async () => {
      await page.context().clearCookies();
      await signIn(page, locale, "owner@flowgastronomie.local");
      await page.goto(`/app/${locale}/launch`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(
        page.getByRole("heading", { name: labels.launch }),
      ).toBeVisible();
    });
  });
}
