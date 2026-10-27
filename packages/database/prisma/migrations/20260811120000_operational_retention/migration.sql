CREATE TYPE "RetentionRunStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');

ALTER TABLE "Reservation"
ADD COLUMN "personalDataRedactedAt" TIMESTAMP(3);

ALTER TABLE "TableGuest"
ADD COLUMN "tokenRedactedAt" TIMESTAMP(3);

ALTER TABLE "OnlineOrder"
ADD COLUMN "personalDataRedactedAt" TIMESTAMP(3);

CREATE TABLE "RetentionRun" (
    "id" TEXT NOT NULL,
    "status" "RetentionRunStatus" NOT NULL DEFAULT 'STARTED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "summary" JSONB,
    "errorCode" TEXT,

    CONSTRAINT "RetentionRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RetentionRun_status_startedAt_idx" ON "RetentionRun"("status", "startedAt");
