import {
  normalizeCustomerContact,
  type PlatformLocale,
} from "@flowgastronomie/domain";
import type { Prisma } from "@prisma/client";

export async function createCustomerProfileFromContact(
  transaction: Prisma.TransactionClient,
  input: {
    tenantId: string;
    venueId: string;
    displayName: string;
    email: string | null;
    phone: string | null;
    preferredLocale: PlatformLocale;
  },
) {
  const contact = normalizeCustomerContact({
    email: input.email,
    phone: input.phone,
  });
  return transaction.customerProfile.create({
    data: {
      tenantId: input.tenantId,
      venueId: input.venueId,
      displayName: input.displayName.trim(),
      emailNormalized: contact.email,
      phoneNormalized: contact.phone,
      preferredLocale: input.preferredLocale.toUpperCase() as
        "EN" | "DE" | "IT" | "SQ",
    },
  });
}
