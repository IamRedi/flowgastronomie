export const LEGAL_HOLD_TARGETS = [
  "ONLINE_ORDER",
  "RESERVATION",
  "CUSTOMER_PROFILE",
] as const;

export type LegalHoldTarget = (typeof LEGAL_HOLD_TARGETS)[number];

export class InvalidLegalHoldError extends Error {
  constructor() {
    super(
      "A legal hold needs a reason, future review date, and future expiry date",
    );
    this.name = "InvalidLegalHoldError";
  }
}

export function assertLegalHoldSchedule(input: {
  reason: string;
  reviewAt: Date;
  expiresAt: Date;
  now: Date;
}) {
  if (
    !input.reason.trim() ||
    Number.isNaN(input.reviewAt.getTime()) ||
    Number.isNaN(input.expiresAt.getTime()) ||
    input.reviewAt <= input.now ||
    input.expiresAt <= input.reviewAt
  ) {
    throw new InvalidLegalHoldError();
  }
}
