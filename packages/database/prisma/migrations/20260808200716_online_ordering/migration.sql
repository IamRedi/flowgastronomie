-- CreateEnum
CREATE TYPE "OnlineFulfillmentType" AS ENUM ('PICKUP', 'DELIVERY', 'CATERING');

-- CreateEnum
CREATE TYPE "OnlineOrderStatus" AS ENUM ('PENDING_CONFIRMATION', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "OnlineOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "fulfillmentType" "OnlineFulfillmentType" NOT NULL,
    "status" "OnlineOrderStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "totalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT,
    "requestedFor" TIMESTAMP(3) NOT NULL,
    "deliveryAddressLine" TEXT,
    "deliveryPostalCode" TEXT,
    "deliveryCity" TEXT,
    "cateringGuestCount" INTEGER,
    "guestNotes" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decidedByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnlineOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlineOrderItem" (
    "id" TEXT NOT NULL,
    "onlineOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "station" "StationType" NOT NULL,
    "notes" TEXT,
    "variantId" TEXT,
    "variantName" TEXT,

    CONSTRAINT "OnlineOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlineOrderItemModifier" (
    "id" TEXT NOT NULL,
    "onlineOrderItemId" TEXT NOT NULL,
    "modifierOptionId" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "optionName" TEXT NOT NULL,
    "priceDeltaMinor" INTEGER NOT NULL,

    CONSTRAINT "OnlineOrderItemModifier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnlineOrder_referenceCode_key" ON "OnlineOrder"("referenceCode");

-- CreateIndex
CREATE INDEX "OnlineOrder_tenantId_venueId_status_requestedFor_idx" ON "OnlineOrder"("tenantId", "venueId", "status", "requestedFor");

-- CreateIndex
CREATE UNIQUE INDEX "OnlineOrder_tenantId_venueId_idempotencyKey_key" ON "OnlineOrder"("tenantId", "venueId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OnlineOrderItem_onlineOrderId_station_idx" ON "OnlineOrderItem"("onlineOrderId", "station");

-- CreateIndex
CREATE INDEX "OnlineOrderItemModifier_onlineOrderItemId_idx" ON "OnlineOrderItemModifier"("onlineOrderItemId");

-- AddForeignKey
ALTER TABLE "OnlineOrder" ADD CONSTRAINT "OnlineOrder_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineOrderItem" ADD CONSTRAINT "OnlineOrderItem_onlineOrderId_fkey" FOREIGN KEY ("onlineOrderId") REFERENCES "OnlineOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineOrderItem" ADD CONSTRAINT "OnlineOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineOrderItemModifier" ADD CONSTRAINT "OnlineOrderItemModifier_onlineOrderItemId_fkey" FOREIGN KEY ("onlineOrderItemId") REFERENCES "OnlineOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
