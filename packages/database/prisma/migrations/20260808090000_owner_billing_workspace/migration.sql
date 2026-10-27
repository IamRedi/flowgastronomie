CREATE TYPE "BillingInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID');
CREATE TYPE "PlanChangeStatus" AS ENUM ('PENDING', 'APPLIED', 'CANCELLED');

CREATE TABLE "OrganizationBillingProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "billingEmail" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "vatId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationBillingProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingInvoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "BillingInvoiceStatus" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "externalUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubscriptionPlanChangeRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "currentPlan" "SubscriptionPlan" NOT NULL,
    "requestedPlan" "SubscriptionPlan" NOT NULL,
    "status" "PlanChangeStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "requestedByMembershipId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "SubscriptionPlanChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationBillingProfile_tenantId_key" ON "OrganizationBillingProfile"("tenantId");
CREATE UNIQUE INDEX "BillingInvoice_number_key" ON "BillingInvoice"("number");
CREATE INDEX "BillingInvoice_tenantId_issuedAt_idx" ON "BillingInvoice"("tenantId", "issuedAt");
CREATE INDEX "SubscriptionPlanChangeRequest_tenantId_status_requestedAt_idx" ON "SubscriptionPlanChangeRequest"("tenantId", "status", "requestedAt");
CREATE UNIQUE INDEX "SubscriptionPlanChangeRequest_one_pending_per_tenant_idx" ON "SubscriptionPlanChangeRequest"("tenantId") WHERE "status" = 'PENDING';

ALTER TABLE "OrganizationBillingProfile" ADD CONSTRAINT "OrganizationBillingProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionPlanChangeRequest" ADD CONSTRAINT "SubscriptionPlanChangeRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionPlanChangeRequest" ADD CONSTRAINT "SubscriptionPlanChangeRequest_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
