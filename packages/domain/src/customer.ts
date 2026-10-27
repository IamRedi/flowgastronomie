import type { PlatformLocale } from "./locale";

export type CustomerContactInput = {
  email: string | null;
  phone: string | null;
};

export type NormalizedCustomerContact = {
  email: string | null;
  phone: string | null;
};

export class InvalidCustomerContactError extends Error {
  constructor() {
    super("A customer profile needs an email address or phone number");
    this.name = "InvalidCustomerContactError";
  }
}

function optional(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

/**
 * Produces stable comparison values without guessing a country's telephone
 * numbering rules. Exact normalized matches may be shown for staff review,
 * but must never cause an implicit customer merge.
 */
export function normalizeCustomerContact(
  input: CustomerContactInput,
): NormalizedCustomerContact {
  const email = optional(input.email)?.toLocaleLowerCase("en-US") ?? null;
  const phone = optional(input.phone)?.replaceAll(/[\s().-]/g, "") ?? null;
  if (!email && !phone) throw new InvalidCustomerContactError();
  return { email, phone };
}

export function customerContactMatchKeys(
  contact: NormalizedCustomerContact,
): readonly string[] {
  return [
    ...(contact.email ? [`EMAIL:${contact.email}`] : []),
    ...(contact.phone ? [`PHONE:${contact.phone}`] : []),
  ];
}

export function matchingCustomerContactFields(
  left: NormalizedCustomerContact,
  right: NormalizedCustomerContact,
): readonly ("email" | "phone")[] {
  return [
    ...(left.email && left.email === right.email ? (["email"] as const) : []),
    ...(left.phone && left.phone === right.phone ? (["phone"] as const) : []),
  ];
}

export type CustomerProfileDraft = {
  displayName: string;
  contact: NormalizedCustomerContact;
  preferredLocale: PlatformLocale;
};
