// Synthetic test validity only; commercial plan/trial definitions stay unchanged.
export const LAB_TEST_VALIDITY_DAYS = 30;
export const LAB_TEST_RENEW_AHEAD_DAYS = 7;
export function labTestRenewal(
  optedIn: boolean,
  status: string,
  expiresAt: Date | null,
  now: Date,
  initial = false,
): Date | null {
  if (!optedIn) return null;
  if (status !== "TRIALING" || !expiresAt)
    throw new Error("LAB_TEST_REQUIRES_EXISTING_TRIAL");
  if (
    !initial &&
    expiresAt.getTime() > now.getTime() + LAB_TEST_RENEW_AHEAD_DAYS * 86400000
  )
    return null;
  const next = new Date(now.getTime() + LAB_TEST_VALIDITY_DAYS * 86400000);
  return next > expiresAt ? next : null;
}
