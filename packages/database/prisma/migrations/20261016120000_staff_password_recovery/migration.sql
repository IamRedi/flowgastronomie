CREATE TABLE "StaffPasswordReset" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "passwordHashAtIssue" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  CONSTRAINT "StaffPasswordReset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StaffPasswordReset_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StaffPasswordReset_tokenHash_key" ON "StaffPasswordReset"("tokenHash");
CREATE INDEX "StaffPasswordReset_tenantId_userId_createdAt_idx" ON "StaffPasswordReset"("tenantId", "userId", "createdAt");
CREATE INDEX "StaffPasswordReset_expiresAt_idx" ON "StaffPasswordReset"("expiresAt");
