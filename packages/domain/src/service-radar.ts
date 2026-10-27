export const SERVICE_SIGNAL_TYPES = [
  "NEW_ORDER",
  "WAITER_CALL",
  "BILL_REQUEST",
  "WATER_REQUEST",
] as const;

export type ServiceSignalType = (typeof SERVICE_SIGNAL_TYPES)[number];

export type ServiceSignal = {
  id: string;
  tableLabel: string;
  type: ServiceSignalType;
  createdAt: Date;
  acknowledgedAt?: Date;
};

export type StaffRadarSignal = {
  id: string;
  tableSessionId: string;
  tableLabel: string;
  area: string | null;
  type: ServiceSignalType;
  createdAt: Date | string;
  waitingSeconds: number;
  assignment: {
    membershipId: string;
    displayName: string;
    claimedAt: Date | string;
    assignedByManager: boolean;
    isMine: boolean;
  } | null;
  balance: {
    dueMinor: number;
    paidMinor: number;
    outstandingMinor: number;
    currency: string;
  };
  order: {
    id: string;
    tableSessionId: string;
    status: string;
    version: number;
    itemCount: number;
    totalMinor: number;
    currency: string;
    source: "GUEST_QR" | "STAFF_TABLET";
    serviceOwner: {
      membershipId: string;
      displayName: string;
      isMine: boolean;
    } | null;
    productionTickets: Array<{
      id: string;
      station: "BAR" | "KITCHEN" | "DESSERT";
      status: "NEW" | "PREPARING" | "READY" | "SERVED";
      version: number;
      itemCount: number;
      itemNames: string[];
      subtotalMinor: number;
      assignment: {
        membershipId: string;
        displayName: string;
        isMine: boolean;
      } | null;
    }>;
  } | null;
};

const urgencyWeight: Record<ServiceSignalType, number> = {
  BILL_REQUEST: 4,
  WAITER_CALL: 3,
  NEW_ORDER: 2,
  WATER_REQUEST: 1,
};

export function rankServiceSignals(
  signals: readonly ServiceSignal[],
): ServiceSignal[] {
  return signals
    .filter((signal) => !signal.acknowledgedAt)
    .sort((left, right) => {
      const ageDifference =
        left.createdAt.getTime() - right.createdAt.getTime();

      if (ageDifference !== 0) {
        return ageDifference;
      }

      return urgencyWeight[right.type] - urgencyWeight[left.type];
    });
}
