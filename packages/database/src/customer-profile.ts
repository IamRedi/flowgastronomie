import {
  assertStaffPermission,
  matchingCustomerContactFields,
  normalizeCustomerContact,
  type PlatformLocale,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import { subscriptionRepository } from "./subscription-repository.js";
import type { StaffIdentity } from "./staff-auth-repository.js";

export class CustomerProfileNotFoundError extends Error {}

function scope(staff: StaffIdentity) {
  return { tenantId: staff.tenantId, venueId: staff.venueId };
}

export type CustomerProfileRepository = {
  list(staff: StaffIdentity): Promise<unknown>;
  get(input: {
    staff: StaffIdentity;
    customerProfileId: string;
  }): Promise<unknown>;
  findDuplicateCandidates(input: {
    staff: StaffIdentity;
    customerProfileId: string;
  }): Promise<unknown>;
  update(input: {
    staff: StaffIdentity;
    customerProfileId: string;
    displayName: string;
    email: string | null;
    phone: string | null;
    preferredLocale: PlatformLocale;
    internalNotes: string | null;
  }): Promise<unknown>;
  remove(input: {
    staff: StaffIdentity;
    customerProfileId: string;
  }): Promise<void>;
};

export const customerProfileRepository: CustomerProfileRepository = {
  async list(staff) {
    await subscriptionRepository.assertFeature(
      staff.tenantId,
      "CUSTOMER_TIMELINE",
    );
    assertStaffPermission(staff.role, "CUSTOMER_VIEW");
    return prisma.customerProfile.findMany({
      where: scope(staff),
      select: {
        id: true,
        displayName: true,
        emailNormalized: true,
        phoneNormalized: true,
        preferredLocale: true,
        internalNotes: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { reservations: true, onlineOrders: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
  },

  async get({ staff, customerProfileId }) {
    await subscriptionRepository.assertFeature(
      staff.tenantId,
      "CUSTOMER_TIMELINE",
    );
    assertStaffPermission(staff.role, "CUSTOMER_VIEW");
    const profile = await prisma.customerProfile.findFirst({
      where: { id: customerProfileId, ...scope(staff) },
      include: {
        reservations: {
          select: {
            id: true,
            status: true,
            requestedFor: true,
            partySize: true,
            createdAt: true,
          },
          orderBy: { requestedFor: "desc" },
        },
        onlineOrders: {
          select: {
            id: true,
            referenceCode: true,
            fulfillmentType: true,
            status: true,
            totalMinor: true,
            currency: true,
            requestedFor: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!profile) throw new CustomerProfileNotFoundError();
    return profile;
  },

  async findDuplicateCandidates({ staff, customerProfileId }) {
    await subscriptionRepository.assertFeature(
      staff.tenantId,
      "CUSTOMER_TIMELINE",
    );
    assertStaffPermission(staff.role, "CUSTOMER_VIEW");
    const profile = await prisma.customerProfile.findFirst({
      where: { id: customerProfileId, ...scope(staff) },
      select: {
        id: true,
        emailNormalized: true,
        phoneNormalized: true,
      },
    });
    if (!profile) throw new CustomerProfileNotFoundError();
    const candidates = await prisma.customerProfile.findMany({
      where: {
        ...scope(staff),
        id: { not: profile.id },
        OR: [
          ...(profile.emailNormalized
            ? [{ emailNormalized: profile.emailNormalized }]
            : []),
          ...(profile.phoneNormalized
            ? [{ phoneNormalized: profile.phoneNormalized }]
            : []),
        ],
      },
      select: {
        id: true,
        displayName: true,
        emailNormalized: true,
        phoneNormalized: true,
        preferredLocale: true,
        createdAt: true,
        _count: { select: { reservations: true, onlineOrders: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return candidates.map((candidate) => ({
      ...candidate,
      matchingFields: matchingCustomerContactFields(
        {
          email: profile.emailNormalized,
          phone: profile.phoneNormalized,
        },
        {
          email: candidate.emailNormalized,
          phone: candidate.phoneNormalized,
        },
      ),
    }));
  },

  async update({
    staff,
    customerProfileId,
    displayName,
    email,
    phone,
    preferredLocale,
    internalNotes,
  }) {
    await subscriptionRepository.assertFeature(
      staff.tenantId,
      "CUSTOMER_TIMELINE",
    );
    assertStaffPermission(staff.role, "CUSTOMER_MANAGE");
    const contact = normalizeCustomerContact({ email, phone });
    const existing = await prisma.customerProfile.findFirst({
      where: { id: customerProfileId, ...scope(staff) },
      select: { id: true },
    });
    if (!existing) throw new CustomerProfileNotFoundError();
    return prisma.customerProfile.update({
      where: { id: existing.id },
      data: {
        displayName: displayName.trim(),
        emailNormalized: contact.email,
        phoneNormalized: contact.phone,
        preferredLocale: preferredLocale.toUpperCase() as
          "EN" | "DE" | "IT" | "SQ",
        internalNotes: internalNotes?.trim() || null,
      },
    });
  },

  async remove({ staff, customerProfileId }) {
    await subscriptionRepository.assertFeature(
      staff.tenantId,
      "CUSTOMER_TIMELINE",
    );
    assertStaffPermission(staff.role, "CUSTOMER_MANAGE");
    const existing = await prisma.customerProfile.findFirst({
      where: { id: customerProfileId, ...scope(staff) },
      select: { id: true },
    });
    if (!existing) throw new CustomerProfileNotFoundError();
    await prisma.customerProfile.delete({ where: { id: existing.id } });
  },
};
