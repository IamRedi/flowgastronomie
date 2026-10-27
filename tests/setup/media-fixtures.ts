import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { prisma } from "@flowgastronomie/database";

/** Controlled uploads, never AI calls or claims of actual fixture food. */
export async function prepareMediaFixtures(
  local: boolean,
  tenants: { tenantId: string; venueId: string }[],
) {
  const logo = await sharp(
    await readFile("tests/foundation/synthetic-logo.jpg"),
  )
    .png()
    .toBuffer();
  const photo = await readFile(
    "apps/web/public/pilot/demo-food/margherita.webp",
  );
  await writeFile("artifacts/setup/media-logo.png", logo);
  await writeFile("artifacts/setup/media-margherita.webp", photo);
  // A controlled alternate upload for replacement/immutable-history acceptance.
  // It is explicitly DEMO, not a new photograph of fixture food.
  await writeFile(
    "artifacts/setup/media-margherita-alternate.png",
    await sharp(photo).resize({ width: 960 }).png().toBuffer(),
  );
  if (local) return;
  for (const tenant of tenants) {
    const scope = { tenantId: tenant.tenantId, venueId: tenant.venueId };
    const category = await prisma.menuCategory.create({
      data: {
        ...scope,
        published: true,
        translations: {
          create: ["EN", "DE", "IT", "SQ"].map((locale) => ({
            ...scope,
            locale: locale as "EN" | "DE" | "IT" | "SQ",
            name: "Pizza",
          })),
        },
      },
    });
    await prisma.product.create({
      data: {
        ...scope,
        categoryId: category.id,
        station: "KITCHEN",
        priceMinor: 950,
        currency: "EUR",
        published: true,
        available: true,
        translations: {
          create: ["EN", "DE", "IT", "SQ"].map((locale) => ({
            ...scope,
            locale: locale as "EN" | "DE" | "IT" | "SQ",
            name: "Margherita",
          })),
        },
      },
    });
  }
}
