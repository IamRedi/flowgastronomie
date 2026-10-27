export const RESERVATION_STATUSES = [
  "REQUESTED",
  "CONFIRMED",
  "SEATED",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
  "NO_SHOW",
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

const transitions: Record<ReservationStatus, readonly ReservationStatus[]> = {
  REQUESTED: ["CONFIRMED", "REJECTED", "CANCELLED"],
  CONFIRMED: ["SEATED", "CANCELLED", "NO_SHOW"],
  SEATED: ["COMPLETED"],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export class InvalidReservationTransitionError extends Error {
  constructor(from: ReservationStatus, to: ReservationStatus) {
    super(`Cannot transition reservation from ${from} to ${to}`);
    this.name = "InvalidReservationTransitionError";
  }
}

export class InvalidReservationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidReservationInputError";
  }
}

export function transitionReservation(
  from: ReservationStatus,
  to: ReservationStatus,
): ReservationStatus {
  if (!transitions[from].includes(to))
    throw new InvalidReservationTransitionError(from, to);
  return to;
}

export function assertReservationRequest(input: {
  requestedFor: Date;
  now: Date;
  partySize: number;
}) {
  if (
    Number.isNaN(input.requestedFor.getTime()) ||
    input.requestedFor <= input.now ||
    !Number.isSafeInteger(input.partySize) ||
    input.partySize < 1 ||
    input.partySize > 50
  ) {
    throw new InvalidReservationInputError(
      "A reservation needs a future time and a party size from 1 to 50",
    );
  }
}
