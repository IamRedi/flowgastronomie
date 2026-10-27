export const SERVICE_MODES = [
  "MENU_ONLY",
  "CALL_AND_REQUEST",
  "ORDER_AND_CONFIRM",
  "SELF_ORDER",
  "ORDER_AND_PAY",
  "BAR",
  "TAKEAWAY",
] as const;

export type ServiceMode = (typeof SERVICE_MODES)[number];

export type ServiceModeOverride = {
  mode: ServiceMode;
  active: boolean;
};

export type ServiceModeConfiguration = {
  venueDefault: ServiceMode;
  areaOverride?: ServiceModeOverride;
  tableOverride?: ServiceModeOverride;
};

export function resolveServiceMode(
  configuration: ServiceModeConfiguration,
): ServiceMode {
  if (configuration.tableOverride?.active) {
    return configuration.tableOverride.mode;
  }

  if (configuration.areaOverride?.active) {
    return configuration.areaOverride.mode;
  }

  return configuration.venueDefault;
}

export const SERVICE_MODE_CAPABILITIES: Record<
  ServiceMode,
  {
    canOrder: boolean;
    canRequestService: boolean;
    requiresConfirmation: boolean;
  }
> = {
  MENU_ONLY: {
    canOrder: false,
    canRequestService: false,
    requiresConfirmation: false,
  },
  CALL_AND_REQUEST: {
    canOrder: false,
    canRequestService: true,
    requiresConfirmation: false,
  },
  ORDER_AND_CONFIRM: {
    canOrder: true,
    canRequestService: true,
    requiresConfirmation: true,
  },
  SELF_ORDER: {
    canOrder: true,
    canRequestService: true,
    requiresConfirmation: false,
  },
  ORDER_AND_PAY: {
    canOrder: true,
    canRequestService: true,
    requiresConfirmation: false,
  },
  BAR: {
    canOrder: true,
    canRequestService: true,
    requiresConfirmation: false,
  },
  TAKEAWAY: {
    canOrder: true,
    canRequestService: false,
    requiresConfirmation: false,
  },
};
