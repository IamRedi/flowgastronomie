-- CreateEnum
CREATE TYPE "IngredientBaseUnit" AS ENUM ('GRAM', 'MILLILITER', 'PIECE');

-- CreateEnum
CREATE TYPE "IngredientQuantityUnit" AS ENUM ('GRAM', 'KILOGRAM', 'MILLILITER', 'LITER', 'PIECE');

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUnit" "IngredientBaseUnit" NOT NULL,
    "allergens" "AllergenCode"[] NOT NULL DEFAULT ARRAY[]::"AllergenCode"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierItemPrice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "packQuantity" INTEGER NOT NULL,
    "unit" "IngredientQuantityUnit" NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierItemPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_venueId_name_key" ON "Ingredient"("venueId", "name");
CREATE INDEX "Ingredient_tenantId_venueId_active_idx" ON "Ingredient"("tenantId", "venueId", "active");
CREATE UNIQUE INDEX "Supplier_venueId_name_key" ON "Supplier"("venueId", "name");
CREATE INDEX "Supplier_tenantId_venueId_active_idx" ON "Supplier"("tenantId", "venueId", "active");
CREATE INDEX "SupplierItemPrice_tenantId_venueId_ingredientId_effectiveFrom_idx" ON "SupplierItemPrice"("tenantId", "venueId", "ingredientId", "effectiveFrom");
CREATE INDEX "SupplierItemPrice_tenantId_venueId_supplierId_effectiveFrom_idx" ON "SupplierItemPrice"("tenantId", "venueId", "supplierId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "SupplierItemPrice" ADD CONSTRAINT "SupplierItemPrice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierItemPrice" ADD CONSTRAINT "SupplierItemPrice_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
