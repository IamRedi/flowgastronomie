import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "@flowgastronomie/database";
import { provisionBusinessInTransaction } from "../../packages/database/src/business-provisioner.js";
import { buildApp } from "../../apps/api/src/app.js";
import { prepareMediaFixtures } from "./media-fixtures.js";
import {
  ControlledMenuExtractor,
  controlledMenuPng,
  controlledMenuPdf,
} from "./fixtures.js";
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    process.env.SMART_SETUP_BROWSER_GATE !== "true" ||
    !/^setup_browser_\d+$/.test(url.searchParams.get("schema") ?? "")
  )
    throw new Error("This controlled fixture server is local acceptance only.");
  await mkdir("artifacts/setup", { recursive: true });
  const tenants = [];
  for (const [name, kind] of [
    ["Pizzeria Aurora · DEMO", "DEMO"],
    ["Synthetic Pizza Fixture", "REAL"],
  ] as const) {
    {
      const result = await prisma.$transaction(
        (tx) =>
          provisionBusinessInTransaction(
            tx,
            {
              requestKey: randomUUID(),
              organizationName: name,
              venueName: name,
              ownerDisplayName: "Acceptance owner",
              email: `${kind.toLowerCase()}@setup.test`,
              password: "setup-acceptance-password",
              locale: "en",
              timezone: "Europe/Berlin",
              currency: "EUR",
              plan: "RESTAURANT_PRO",
              profileId: "PIZZERIA",
              applyCategories: false,
            },
            kind,
          ),
        { timeout: 15000 },
      );
      tenants.push({
        name,
        kind,
        tenantId: result.tenant.id,
        venueId: result.venue.id,
        tenantSlug: result.tenant.slug,
        venueSlug: result.venue.slug,
        email: result.owner.email,
        password: "setup-acceptance-password",
      });
    }
  }
  await prepareMediaFixtures(false, tenants);
  await writeFile(
    "artifacts/setup/acceptance.json",
    JSON.stringify({ local: false, tenants }),
  );
  await writeFile(
    "artifacts/setup/controlled-menu.png",
    await controlledMenuPng(),
  );
  await writeFile(
    "artifacts/setup/controlled-menu.pdf",
    await controlledMenuPdf(),
  );
  const app = buildApp(
    {},
    { menuExtractionProvider: new ControlledMenuExtractor() },
  );
  await app.listen({ host: "127.0.0.1", port: 4300 });
  const stop = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
