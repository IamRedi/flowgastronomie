import { readFile, writeFile, mkdir } from "node:fs/promises";
import { prisma } from "@flowgastronomie/database";
import { provision } from "./provision.js";
import { assertLabInstance } from "./guard.js";
import { renewLabTests } from "./test-entitlements.js";
await assertLabInstance();
const mode = process.argv[2];
try {
  await mkdir(".runtime", { recursive: true });
  if (mode === "hours-setup" || mode === "hours-restore") {
    for (const profile of ["DE", "AL"] as const) {
      const file = `.runtime/${profile}-original-hours.json`;
      let originalHours: unknown;
      if (mode === "hours-restore") {
        try {
          originalHours = JSON.parse(await readFile(file, "utf8"));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw e;
        }
      }
      const ctx = await provision(profile),
        owner = ctx.clients.owner!;
      const editor = await owner.request<Record<string, unknown>>(
        "GET",
        "/v1/workspace/website",
      );
      if (mode === "hours-setup")
        await writeFile(file, JSON.stringify(editor.openingHours), {
          mode: 0o600,
        });
      const openingHours =
        mode === "hours-restore"
          ? originalHours
          : (editor.openingHours as Array<{ day: string }>).map((h) => ({
              day: h.day,
              closed: false,
              opensAt: "00:00",
              closesAt: "23:59",
            }));
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
          "premiumStyleId",
          "expectedUpdatedAt",
        ].map((k) => [k, editor[k]]),
      );
      await owner.request("PUT", "/v1/workspace/website", {
        ...input,
        openingHours,
      });
      await owner.request("POST", "/v1/workspace/website/publish");
    }
  } else if (mode === "entitlement-proof") {
    const before = await prisma.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) FROM operations_lab.entitlement_event`;
    await renewLabTests();
    const after = await prisma.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) FROM operations_lab.entitlement_event`;
    if (before[0]!.count !== after[0]!.count)
      throw new Error("RENEWAL_DUPLICATED_INSIDE_VALID_WINDOW");
    let outside = false;
    try {
      await renewLabTests(undefined, "NEON" as never);
    } catch {
      outside = true;
    }
    let immutable = false;
    try {
      await prisma.$executeRaw`UPDATE operations_lab.entitlement_event SET reason='invalid rewrite'`;
    } catch {
      immutable = true;
    }
    if (!outside || !immutable) throw new Error("ENTITLEMENT_BOUNDARY_FAILED");
    await writeFile(
      ".runtime/entitlement-proof.json",
      JSON.stringify(
        {
          status: "passed",
          events: Number(after[0]!.count),
          repeatRenewalNoOp: true,
          outsideScopeDenied: true,
          evidenceImmutable: true,
          commercialActivation: false,
          actualAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } else if (mode === "financial-snapshot") {
    const payments = await prisma.paymentRecord.findMany({
      orderBy: { id: "asc" },
      select: { id: true, amountMinor: true, method: true, status: true },
    });
    const receipts = await prisma.receipt.findMany({
      orderBy: { id: "asc" },
      select: { id: true, number: true, paymentId: true, snapshot: true },
    });
    const orders = await prisma.order.findMany({
        orderBy: { id: "asc" },
        select: { id: true },
      }),
      online = await prisma.onlineOrder.findMany({
        orderBy: { id: "asc" },
        select: { id: true },
      });
    await writeFile(
      process.argv[3]!,
      JSON.stringify({ payments, receipts, orders, online }),
    );
  } else throw new Error("UNKNOWN_CONTINUITY_PROBE");
  console.log("Continuity " + mode + " passed");
} finally {
  await prisma.$disconnect();
}
