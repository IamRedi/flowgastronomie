import {
  legacyWebsiteDocument,
  PLATFORM_LOCALES,
} from "@flowgastronomie/domain";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "@flowgastronomie/database";
import { buildApp } from "../../apps/api/src/app.js";
import { controlledWebsiteTransport, textMenuPdf } from "./fixtures.js";
import {
  ControlledMenuExtractor,
  controlledMenuPng,
  controlledMenuPdf,
} from "../setup/fixtures.js";
async function main() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (
    !["localhost", "127.0.0.1"].includes(database.hostname) ||
    !/^import_v2_browser_\d+$/.test(
      database.searchParams.get("schema") ?? "",
    ) ||
    process.env.IMPORT_V2_BROWSER_GATE !== "true"
  )
    throw new Error("Isolated local fixture schema required");
  await mkdir("artifacts/import-v2", { recursive: true });
  if ((await prisma.tenant.count()) !== 0)
    throw new Error("Registration acceptance requires an empty schema");
  const recoveryEmails: { recipient: string; resetToken: string }[] = [];
  const app = buildApp(
    {
      transactionalNotificationService: {
        async send(notification) {
          if (notification.kind === "STAFF_PASSWORD_RESET")
            recoveryEmails.push(notification);
        },
      },
    },
    {
      trustProxy: "127.0.0.1/32",
      websiteAiProvider: {
        provider: "controlled",
        model: "browser-acceptance",
        propose: async (context) => ({
          title: "Reviewed heading",
          description: "Reviewed section copy",
          inputTokens: 10,
          outputTokens: 20,
          ...(context.operation === "SITE"
            ? {
                plan: {
                  styleId: "cafe-1",
                  typography: "SERIF" as const,
                  sections: legacyWebsiteDocument(
                    PLATFORM_LOCALES.map((locale) => ({
                      locale,
                      heroTitle: "A place for coffee",
                      heroSubtitle: "A synthetic cafe",
                      storyTitle: "Our cafe",
                      storyBody: "Coffee and conversation",
                      seoTitle: "Cafe",
                      seoDescription: "Synthetic cafe",
                    })),
                  ).sections.map(({ type, layout, content }) => ({
                    type,
                    layout,
                    content,
                  })),
                  seo: PLATFORM_LOCALES.map((locale) => ({
                    locale,
                    title: "Synthetic cafe",
                    description: "Coffee and conversation",
                  })),
                },
              }
            : {}),
        }),
      },
      businessImport: {
        dns: async () => ["93.184.216.34"],
        transport: controlledWebsiteTransport(),
        // Real text/PDF extraction in this browser gate; simulated visual extraction is tested separately.
      },
    },
  );
  // The guard above requires a disposable loopback-only fixture schema.
  // Controlled email retrieval never exists in the production API.
  app.get("/fixture/recovery-email", () => recoveryEmails.at(-1) ?? null);
  app.get("/fixture/client-address", (request) => ({ ip: request.ip }));
  const owners = [];
  for (const locale of ["sq", "de", "en", "it"] as const) {
    const registration = await app.inject({
      method: "POST",
      url: "/v1/public/trials",
      remoteAddress: "127.0.0.3",
      payload: {
        requestKey: randomUUID(),
        organizationName: `Import fixture ${locale}`,
        venueName: `Garden fixture ${locale}`,
        ownerDisplayName: "Import acceptance owner",
        email: `${locale}@import-v2.example`,
        password: "import-v2-acceptance-password",
        locale,
        countryCode: "DE",
        timezone: "Europe/Berlin",
        currency: "EUR",
        plan: "RESTAURANT_PRO",
        profileId:
          locale === "en"
            ? "CAFE"
            : locale === "sq"
              ? "PIZZERIA"
              : "RESTAURANT",
        applyCategories: false,
      },
    });
    if (registration.statusCode !== 201)
      throw new Error(`Public registration failed: ${registration.statusCode}`);
    const { staff } = registration.json();
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: staff.tenantId },
    });
    const venue = await prisma.venue.findUniqueOrThrow({
      where: { id: staff.venueId },
      include: { website: true },
    });
    if (
      tenant.kind !== "REAL" ||
      venue.website?.status !== "DRAFT" ||
      (await prisma.product.count({ where: { tenantId: tenant.id } })) !== 0
    )
      throw new Error(
        "New registration must be an independent empty draft business",
      );
    owners.push({
      locale,
      tenantSlug: tenant.slug,
      venueSlug: venue.slug,
      email: `${locale}@import-v2.example`,
      password: "import-v2-acceptance-password",
    });
    // Stateful journeys must own their accounts: recovery rotates a password,
    // public ordering publishes a site, and product AI creates menu entries.
    // Distinct synthetic client addresses leave the real HTTP signup budget
    // untouched. Production registration/login rate limits remain enabled.
    const fixtureGroups = [
      { prefix: "website", address: "127.0.0.2" },
      { prefix: "public", address: "127.0.0.4" },
      ...(locale === "sq" ? [{ prefix: "photo", address: "127.0.0.5" }] : []),
      ...(locale === "en"
        ? [{ prefix: "recovery", address: "127.0.0.6" }]
        : []),
    ];
    for (const group of fixtureGroups) {
      const fixtureRegistration = await app.inject({
        method: "POST",
        url: "/v1/public/trials",
        remoteAddress: group.address,
        payload: {
          requestKey: randomUUID(),
          organizationName: `${group.prefix} fixture ${locale}`,
          venueName: `Garden fixture ${locale}`,
          ownerDisplayName: "Website test owner",
          email: `${group.prefix}-${locale}@import-v2.example`,
          password: "import-v2-acceptance-password",
          locale,
          countryCode: "DE",
          timezone: "Europe/Berlin",
          currency: "EUR",
          plan: "RESTAURANT_PRO",
          profileId:
            locale === "en"
              ? "CAFE"
              : locale === "sq"
                ? "PIZZERIA"
                : "RESTAURANT",
          applyCategories: false,
        },
      });
      if (fixtureRegistration.statusCode !== 201)
        throw Error(`${group.prefix} fixture registration failed`);
    }
  }
  await writeFile("artifacts/import-v2/owners.json", JSON.stringify(owners));
  await writeFile("artifacts/import-v2/menu.png", await controlledMenuPng());
  await writeFile("artifacts/import-v2/menu.pdf", await controlledMenuPdf());
  await writeFile("artifacts/import-v2/text-menu.pdf", await textMenuPdf());
  await app.listen({ host: "127.0.0.1", port: 4302 });
  const stop = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}
main().catch(() => {
  console.error("Import acceptance fixture server failed");
  process.exitCode = 1;
});
