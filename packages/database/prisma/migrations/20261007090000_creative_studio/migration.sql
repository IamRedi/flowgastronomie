-- CreateTable
CREATE TABLE "CreativeProject" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "document" JSONB NOT NULL,
    "currentRevisionId" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "sourceSummary" JSONB NOT NULL,
    "actor" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "name" TEXT,
    "parentRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreativeRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeAsset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "approvedForPublicUse" BOOLEAN NOT NULL DEFAULT false,
    "approvedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreativeAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeExport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "outputType" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "specification" JSONB NOT NULL,
    "storageKey" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreativeExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeConversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "patch" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreativeConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "resultId" TEXT,
    "usage" JSONB NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreativeProject_tenantId_venueId_updatedAt_idx" ON "CreativeProject"("tenantId", "venueId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeProject_tenantId_venueId_id_key" ON "CreativeProject"("tenantId", "venueId", "id");

-- CreateIndex
CREATE INDEX "CreativeRevision_tenantId_venueId_projectId_idx" ON "CreativeRevision"("tenantId", "venueId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeRevision_projectId_number_key" ON "CreativeRevision"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeRevision_tenantId_venueId_projectId_id_key" ON "CreativeRevision"("tenantId", "venueId", "projectId", "id");

-- CreateIndex
CREATE INDEX "CreativeAsset_tenantId_venueId_createdAt_idx" ON "CreativeAsset"("tenantId", "venueId", "createdAt");

-- CreateIndex
CREATE INDEX "CreativeExport_tenantId_venueId_projectId_createdAt_idx" ON "CreativeExport"("tenantId", "venueId", "projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeExport_tenantId_venueId_projectId_requestKey_key" ON "CreativeExport"("tenantId", "venueId", "projectId", "requestKey");

-- CreateIndex
CREATE INDEX "CreativeConversation_tenantId_venueId_projectId_createdAt_idx" ON "CreativeConversation"("tenantId", "venueId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "CreativeJob_tenantId_venueId_createdAt_idx" ON "CreativeJob"("tenantId", "venueId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeJob_tenantId_venueId_projectId_requestKey_key" ON "CreativeJob"("tenantId", "venueId", "projectId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_tenantId_id_key" ON "Venue"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "CreativeProject" ADD CONSTRAINT "CreativeProject_tenantId_venueId_fkey" FOREIGN KEY ("tenantId", "venueId") REFERENCES "Venue"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeRevision" ADD CONSTRAINT "CreativeRevision_tenantId_venueId_projectId_fkey" FOREIGN KEY ("tenantId", "venueId", "projectId") REFERENCES "CreativeProject"("tenantId", "venueId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeAsset" ADD CONSTRAINT "CreativeAsset_tenantId_venueId_fkey" FOREIGN KEY ("tenantId", "venueId") REFERENCES "Venue"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeExport" ADD CONSTRAINT "CreativeExport_tenantId_venueId_projectId_fkey" FOREIGN KEY ("tenantId", "venueId", "projectId") REFERENCES "CreativeProject"("tenantId", "venueId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeExport" ADD CONSTRAINT "CreativeExport_tenantId_venueId_projectId_revisionId_fkey" FOREIGN KEY ("tenantId", "venueId", "projectId", "revisionId") REFERENCES "CreativeRevision"("tenantId", "venueId", "projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeConversation" ADD CONSTRAINT "CreativeConversation_tenantId_venueId_projectId_fkey" FOREIGN KEY ("tenantId", "venueId", "projectId") REFERENCES "CreativeProject"("tenantId", "venueId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeJob" ADD CONSTRAINT "CreativeJob_tenantId_venueId_projectId_fkey" FOREIGN KEY ("tenantId", "venueId", "projectId") REFERENCES "CreativeProject"("tenantId", "venueId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
