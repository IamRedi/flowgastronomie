export const OPERATIONAL_RETENTION_DAYS = {
  guestContact: 90,
  guestMessage: 30,
  guestToken: 30,
  staffSession: 30,
} as const;

export type OperationalRetentionCutoffs = {
  guestContact: Date;
  guestMessage: Date;
  guestToken: Date;
  staffSession: Date;
};

function daysBefore(now: Date, days: number) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);
}

export function operationalRetentionCutoffs(
  now: Date,
): OperationalRetentionCutoffs {
  if (Number.isNaN(now.getTime()))
    throw new RangeError("Invalid retention time");
  return {
    guestContact: daysBefore(now, OPERATIONAL_RETENTION_DAYS.guestContact),
    guestMessage: daysBefore(now, OPERATIONAL_RETENTION_DAYS.guestMessage),
    guestToken: daysBefore(now, OPERATIONAL_RETENTION_DAYS.guestToken),
    staffSession: daysBefore(now, OPERATIONAL_RETENTION_DAYS.staffSession),
  };
}
