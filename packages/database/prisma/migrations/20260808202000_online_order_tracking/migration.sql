-- CreateEnum
CREATE TYPE "OnlineOrderMessageAuthor" AS ENUM ('GUEST', 'STAFF');

-- AlterEnum
ALTER TYPE "OnlineOrderStatus" ADD VALUE 'PREPARING';
ALTER TYPE "OnlineOrderStatus" ADD VALUE 'READY';
ALTER TYPE "OnlineOrderStatus" ADD VALUE 'OUT_FOR_DELIVERY';
ALTER TYPE "OnlineOrderStatus" ADD VALUE 'COMPLETED';

-- AlterTable
ALTER TABLE "OnlineOrder" ADD COLUMN "trackingTokenHash" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "OnlineOrderStatusEvent" (
    "id" TEXT NOT NULL,
    "onlineOrderId" TEXT NOT NULL,
    "status" "OnlineOrderStatus" NOT NULL,
    "note" TEXT,
    "actorUserId" TEXT,
    "actorMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnlineOrderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlineOrderMessage" (
    "id" TEXT NOT NULL,
    "onlineOrderId" TEXT NOT NULL,
    "author" "OnlineOrderMessageAuthor" NOT NULL,
    "body" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnlineOrderMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnlineOrderStatusEvent_onlineOrderId_createdAt_idx" ON "OnlineOrderStatusEvent"("onlineOrderId", "createdAt");
CREATE INDEX "OnlineOrderMessage_onlineOrderId_createdAt_idx" ON "OnlineOrderMessage"("onlineOrderId", "createdAt");
CREATE UNIQUE INDEX "OnlineOrder_trackingTokenHash_key" ON "OnlineOrder"("trackingTokenHash");

-- AddForeignKey
ALTER TABLE "OnlineOrderStatusEvent" ADD CONSTRAINT "OnlineOrderStatusEvent_onlineOrderId_fkey" FOREIGN KEY ("onlineOrderId") REFERENCES "OnlineOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OnlineOrderMessage" ADD CONSTRAINT "OnlineOrderMessage_onlineOrderId_fkey" FOREIGN KEY ("onlineOrderId") REFERENCES "OnlineOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
