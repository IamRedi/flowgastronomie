import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  StaffPermissionDeniedError,
  WorkforceError,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import type { StaffIdentity } from "./staff-auth-repository.js";
function key() {
  const k = Buffer.from(process.env.WORKFORCE_DOCUMENT_KEY ?? "", "base64");
  if (k.length !== 32)
    throw new WorkforceError(
      "INVALID",
      "Private document storage is not configured.",
    );
  return k;
}
const scope = (s: StaffIdentity) => ({
  tenantId: s.tenantId,
  venueId: s.venueId,
});
async function profile(s: StaffIdentity, id: string) {
  const m = await prisma.membership.findFirst({
    where: { ...scope(s), id },
    include: { staffProfile: true },
  });
  if (!m) throw new WorkforceError("NOT_FOUND", "Profile not found.");
  if (s.role !== "OWNER" && s.userId !== m.userId)
    throw new StaffPermissionDeniedError(s.role, "WORKFORCE_PRIVATE_MANAGE");
  return m;
}
export const workforceDocumentRepository = {
  async add(
    s: StaffIdentity,
    membershipId: string,
    input: {
      expectedVersion: number;
      title: string;
      kind: "CERTIFICATION" | "WORK_DOCUMENT";
      expiresOn: string | null;
      filename: string;
      base64: string;
    },
  ) {
    const m = await profile(s, membershipId);
    const bytes = Buffer.from(input.base64, "base64");
    if (bytes.length < 4 || bytes.length > 4 * 1024 * 1024)
      throw new WorkforceError("INVALID", "Choose a document up to 4 MB.");
    const mimeType =
      bytes.subarray(0, 5).toString() === "%PDF-"
        ? "application/pdf"
        : bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? "image/png"
          : bytes[0] === 255 && bytes[1] === 216
            ? "image/jpeg"
            : null;
    if (!mimeType)
      throw new WorkforceError(
        "INVALID",
        "Only PDF, PNG and JPEG work documents are accepted.",
      );
    const encryptionKey = key();
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`workforce:${s.tenantId}`},0))`;
      const current = await tx.staffProfile.findUnique({
        where: { membershipId: m.id },
      });
      if ((current?.version ?? 0) !== input.expectedVersion)
        throw new WorkforceError("CONFLICT", "Profile changed.");
      const p =
        current ??
        (await tx.staffProfile.create({
          data: { ...scope(s), userId: m.userId, membershipId: m.id },
        }));
      if (
        (await tx.staffWorkDocument.count({
          where: { ...scope(s), profileId: p.id },
        })) >= 30
      )
        throw new WorkforceError(
          "INVALID",
          "This profile already has 30 documents.",
        );
      const nonce = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
      cipher.setAAD(Buffer.from(`${s.tenantId}:${s.venueId}:${p.id}`));
      const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
      const d = await tx.staffWorkDocument.create({
        data: {
          ...scope(s),
          profileId: p.id,
          title: input.title,
          kind: input.kind,
          expiresOn: input.expiresOn,
          filename: input.filename
            .replace(/[^\p{L}\p{N}._ -]/gu, "_")
            .slice(0, 120),
          mimeType,
          ciphertext,
          nonce,
          authTag: cipher.getAuthTag(),
          byteLength: bytes.length,
          createdByUserId: s.userId,
        },
        select: {
          id: true,
          title: true,
          kind: true,
          expiresOn: true,
          filename: true,
          mimeType: true,
          byteLength: true,
        },
      });
      await tx.staffProfile.update({
        where: { id: p.id },
        data: { version: { increment: 1 } },
      });
      await tx.auditEvent.create({
        data: {
          ...scope(s),
          actorUserId: s.userId,
          actorMembershipId: s.membershipId,
          action: "WORKFORCE_DOCUMENT_CREATED",
          entityType: "StaffWorkDocument",
          entityId: d.id,
          metadata: { kind: input.kind, byteLength: bytes.length },
        },
      });
      return d;
    });
  },
  async read(s: StaffIdentity, id: string) {
    const d = await prisma.staffWorkDocument.findFirst({
      where: { ...scope(s), id },
      include: { profile: { include: { membership: true } } },
    });
    if (!d) throw new WorkforceError("NOT_FOUND", "Document not found.");
    if (s.role !== "OWNER" && s.userId !== d.profile.userId)
      throw new StaffPermissionDeniedError(s.role, "WORKFORCE_PRIVATE_MANAGE");
    const decipher = createDecipheriv("aes-256-gcm", key(), d.nonce);
    decipher.setAuthTag(d.authTag);
    decipher.setAAD(Buffer.from(`${s.tenantId}:${s.venueId}:${d.profileId}`));
    const bytes = Buffer.concat([
      decipher.update(d.ciphertext),
      decipher.final(),
    ]);
    await prisma.auditEvent.create({
      data: {
        ...scope(s),
        actorUserId: s.userId,
        actorMembershipId: s.membershipId,
        action: "WORKFORCE_DOCUMENT_READ",
        entityType: "StaffWorkDocument",
        entityId: d.id,
        metadata: { purpose: "employee-document" },
      },
    });
    return { bytes, filename: d.filename };
  },
};
