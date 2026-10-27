import "server-only";

/** Runtime values verified by the owner; tenant records are never the platform identity. */
export function platformOperator() {
  const name = process.env.PLATFORM_OPERATOR_NAME?.trim();
  const address = process.env.PLATFORM_OPERATOR_ADDRESS?.trim();
  const email = process.env.PLATFORM_OPERATOR_EMAIL?.trim();
  return name && address && email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? { name, address, email }
    : null;
}

export function platformPrivacyNotice(locale: string) {
  // Describe actual production processors, transfers and retention using the
  // approved notice. Never assume that staging configuration applies here.
  return (
    (
      process.env[`PLATFORM_PRIVACY_NOTICE_${locale.toUpperCase()}`] ??
      process.env.PLATFORM_PRIVACY_NOTICE_DE
    )?.trim() || null
  );
}
