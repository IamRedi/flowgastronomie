import { createHash } from "node:crypto";

export function orderRecoveryCookieName(publicSlug: string) {
  return `flowgastronomie_order_recovery_${createHash("sha256").update(publicSlug).digest("hex").slice(0, 16)}`;
}
