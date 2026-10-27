import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  prisma,
  staffAuthRepository,
  counterSaleRepository,
  subscriptionRepository,
} from "@flowgastronomie/database";
import { PLAN_DEFINITIONS } from "@flowgastronomie/domain";
import { snapshotDatabase, fileManifest } from "./continuity-snapshot.js";
import {
  assertRestoreEndpoint,
  assertReviewedRestore,
  restoreDatabase,
} from "./restore-guard.js";
import { LAB_MARKER, assertLabEnvironment } from "./guard.js";
assertRestoreEndpoint();
try {
  const root = process.argv[2]!,
    source = JSON.parse(await readFile(join(root, "source.json"), "utf8"));
  const actual = await prisma.$queryRaw<
    Array<{ system_identifier: string }>
  >`SELECT system_identifier::text FROM pg_control_system()`;
  const before = await prisma.$queryRaw<
    Array<{ marker: string; system_identifier: string }>
  >`SELECT marker,system_identifier FROM operations_lab.instance`;
  if (
    before.length !== 1 ||
    before[0]!.marker !== LAB_MARKER ||
    before[0]!.system_identifier !== source.identity ||
    actual[0]!.system_identifier === source.identity
  )
    throw new Error("RESTORE_SOURCE_IDENTITY_NOT_EXPECTED");
  const scopes = await prisma.$queryRaw<
    Array<{ profile: string; tenant_id: string; venue_id: string }>
  >`SELECT profile,tenant_id,venue_id FROM operations_lab.venue ORDER BY profile`;
  if (JSON.stringify(scopes) !== JSON.stringify(source.scopes))
    throw new Error("RESTORED_SCOPES_CHANGED");
  if (
    JSON.stringify(await snapshotDatabase()) !== JSON.stringify(source.tables)
  )
    throw new Error("RESTORED_DATABASE_FINGERPRINT_MISMATCH");
  if (
    JSON.stringify(await fileManifest(".operations-lab")) !==
    JSON.stringify(source.privateFiles)
  )
    throw new Error("RESTORED_PRIVATE_HASH_MISMATCH");
  if (
    JSON.stringify(await fileManifest("artifacts/operations-lab/receipts")) !==
    JSON.stringify(source.pdfFiles)
  )
    throw new Error("RESTORED_PDF_HASH_MISMATCH");
  const approved = {
    version: 1,
    marker: LAB_MARKER,
    sourceIdentifier: source.identity,
    targetIdentifier: actual[0]!.system_identifier,
    database: restoreDatabase,
    reason:
      "Explicit enrollment of this generated disposable local volume under the authorized restore acceptance",
    reviewedAt: new Date().toISOString(),
  };
  await writeFile(
    process.env.LAB_RESTORE_REVIEW!,
    JSON.stringify(approved, null, 2),
    { mode: 0o600 },
  );
  let rejectedBefore = false;
  try {
    await assertReviewedRestore();
  } catch {
    rejectedBefore = true;
  }
  if (!rejectedBefore)
    throw new Error("COPIED_INSTANCE_IDENTIFIER_WAS_ACCEPTED");
  const enrolled =
    await prisma.$executeRaw`UPDATE operations_lab.instance SET system_identifier=${approved.targetIdentifier} WHERE marker=${LAB_MARKER} AND system_identifier=${source.identity}`;
  if (enrolled !== 1) throw new Error("RESTORE_ENROLLMENT_CONFLICT");
  await assertReviewedRestore();
  const paymentsBefore = await prisma.paymentRecord.count(),
    receiptsBefore = await prisma.receipt.count();
  for (const s of scopes) {
    const privateState = JSON.parse(
        await readFile(`.operations-lab/${s.profile}.json`, "utf8"),
      ),
      actor = privateState.actors.manager;
    const login = await staffAuthRepository.login({
      tenantSlug: actor.staff.tenantSlug,
      venueSlug: actor.staff.venueSlug,
      email: actor.email,
      password: actor.password,
    });
    if (
      login.staff.tenantId !== s.tenant_id ||
      login.staff.venueId !== s.venue_id
    )
      throw new Error("RESTORED_CREDENTIAL_SCOPE_MISMATCH");
    const foreign = scopes.find((x) => x.profile !== s.profile)!;
    const receipt = await prisma.receipt.findFirstOrThrow({
      where: { tenantId: foreign.tenant_id, venueId: foreign.venue_id },
    });
    let denied = false;
    try {
      await counterSaleRepository.receipt(login.staff, receipt.id);
    } catch {
      denied = true;
    }
    if (!denied) throw new Error("RESTORED_RECEIPT_TENANT_LEAK");
  }
  // An isolated authorization fixture, never an operational payment/order timestamp.
  const now = new Date(),
    tenant = await prisma.tenant.create({
      data: {
        name: "TEST ONLY expired normal trial fixture",
        slug: "test-only-expired-normal-" + Date.now(),
        kind: "REAL",
      },
    });
  const subscription = await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      plan: "RESTAURANT_PRO",
      status: "TRIALING",
      trialStartedAt: new Date(now.getTime() - 15 * 86400000),
      trialEndsAt: new Date(now.getTime() - 86400000),
    },
  });
  await prisma.entitlement.create({
    data: {
      tenantId: tenant.id,
      subscriptionId: subscription.id,
      featureKey: "ONLINE_ORDERING",
      enabled: true,
    },
  });
  let expiredDenied = false;
  try {
    await subscriptionRepository.assertFeature(tenant.id, "ONLINE_ORDERING");
  } catch {
    expiredDenied = true;
  }
  if (
    !expiredDenied ||
    !Object.values(PLAN_DEFINITIONS).every((p) => p.trialDays === 14)
  )
    throw new Error("NORMAL_EXPIRED_TRIAL_NOT_DENIED");
  for (const bad of [
    process.env.DATABASE_URL!.replace("127.0.0.1", "neon.invalid"),
    process.env.DATABASE_URL!.replace("_restore?", "?"),
    process.env.DATABASE_URL!.replace("55441", "5432"),
  ]) {
    let denied = false;
    try {
      assertRestoreEndpoint({ ...process.env, DATABASE_URL: bad });
    } catch {
      denied = true;
    }
    if (!denied) throw new Error("RESTORE_REMOTE_TARGET_ACCEPTED");
  }
  let primaryRejected = false;
  try {
    assertLabEnvironment(process.env);
  } catch {
    primaryRejected = true;
  }
  if (
    !primaryRejected ||
    (await prisma.paymentRecord.count()) !== paymentsBefore ||
    (await prisma.receipt.count()) !== receiptsBefore
  )
    throw new Error("RESTORE_FINANCIAL_IDENTITIES_CHANGED");
  await writeFile(
    process.argv[3]!,
    JSON.stringify(
      {
        version: 1,
        status: "passed",
        sourceIdentifier: source.identity,
        targetIdentifier: approved.targetIdentifier,
        ownReviewedIdentity: true,
        copiedIdentityRejected: true,
        canonicalScopesPreserved: true,
        tableFingerprintsVerified: true,
        pdfFiles: Object.keys(source.pdfFiles).filter((f) => f.endsWith(".pdf"))
          .length,
        pdfHashesVerified: true,
        privateHashesVerified: true,
        credentialsAndTenantIsolation: true,
        normalTrialDays: 14,
        expiredNormalTrialDenied: true,
        primaryGuardRejectsRestoreEndpoint: true,
        remoteEndpointsRejected: true,
        paymentsPreserved: paymentsBefore,
        receiptsPreserved: receiptsBefore,
        actualAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
