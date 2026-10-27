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
  const app = buildApp(
    {},
    {
      businessImport: {
        dns: async () => ["93.184.216.34"],
        transport: controlledWebsiteTransport(),
        provider: new ControlledMenuExtractor(),
      },
    },
  );
  const owners = [];
  for (const locale of ["sq", "de", "en", "it"] as const) {
    const registration = await app.inject({
      method: "POST",
      url: "/v1/public/trials",
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
        profileId: "RESTAURANT",
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
