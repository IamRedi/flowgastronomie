export const LAUNCH_CHECKS = [
  "SUBSCRIPTION_ACTIVE",
  "ORGANIZATION_PROFILE",
  "WEBSITE_PUBLISHED",
  "MENU_PUBLISHED",
  "TABLE_QR_READY",
  "TEAM_READY",
  "SERVICE_REHEARSAL",
  "RETENTION_HEALTH",
] as const;

export type LaunchCheck = (typeof LAUNCH_CHECKS)[number];

export type LaunchReadinessInput = {
  subscriptionActive: boolean;
  organizationProfileComplete: boolean;
  websitePublished: boolean;
  menuPublished: boolean;
  tableManagementEnabled: boolean;
  tableQrReady: boolean;
  staffShiftsEnabled: boolean;
  teamReady: boolean;
  serviceRadarEnabled: boolean;
  serviceRehearsalComplete: boolean;
  operationalRetentionEnabled: boolean;
  retentionHealthy: boolean;
};

export function incompleteLaunchChecks(
  input: LaunchReadinessInput,
): LaunchCheck[] {
  const checks: LaunchCheck[] = [];
  if (!input.subscriptionActive) checks.push("SUBSCRIPTION_ACTIVE");
  if (!input.organizationProfileComplete) checks.push("ORGANIZATION_PROFILE");
  if (!input.websitePublished) checks.push("WEBSITE_PUBLISHED");
  if (!input.menuPublished) checks.push("MENU_PUBLISHED");
  if (input.tableManagementEnabled && !input.tableQrReady) {
    checks.push("TABLE_QR_READY");
  }
  if (input.staffShiftsEnabled && !input.teamReady) checks.push("TEAM_READY");
  if (input.serviceRadarEnabled && !input.serviceRehearsalComplete) {
    checks.push("SERVICE_REHEARSAL");
  }
  if (input.operationalRetentionEnabled && !input.retentionHealthy) {
    checks.push("RETENTION_HEALTH");
  }
  return checks;
}

export function canLaunchVenue(input: LaunchReadinessInput): boolean {
  return incompleteLaunchChecks(input).length === 0;
}
