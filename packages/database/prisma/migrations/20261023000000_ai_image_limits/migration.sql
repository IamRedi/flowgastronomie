CREATE TABLE "AiImageProviderLimit" (
  "tenantId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "monthlyLimit" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiImageProviderLimit_pkey" PRIMARY KEY ("tenantId","provider"),
  CONSTRAINT "AiImageProviderLimit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AiImageProviderLimit_monthlyLimit_check" CHECK ("monthlyLimit" >= 0),
  CONSTRAINT "AiImageProviderLimit_provider_check" CHECK ("provider" IN ('meta','openai','ideogram'))
);

CREATE TABLE "AiImageControl" (
  "id" TEXT NOT NULL,
  "emergencyDisabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiImageControl_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CreativeJob_tenantId_category_provider_createdAt_idx" ON "CreativeJob"("tenantId","category","provider","createdAt");
ALTER TABLE "CreativeJob" ADD COLUMN "requestFingerprint" TEXT;
