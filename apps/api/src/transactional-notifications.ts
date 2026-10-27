import type {
  OnlineOrderStatus,
  PlatformLocale,
  StaffRole,
} from "@flowgastronomie/domain";

export type TransactionalNotification =
  | {
      kind: "STAFF_PASSWORD_RESET";
      recipient: string;
      locale: PlatformLocale;
      resetToken: string;
    }
  | {
      kind: "WORKFORCE_UPDATE";
      notificationId: string;
      recipient: string;
      locale: PlatformLocale;
      category: import("@flowgastronomie/domain").WorkforceNotificationCategory;
      link: import("@flowgastronomie/domain").WorkforceNoticeLink;
    }
  | {
      kind: "STAFF_INVITATION";
      recipient: string;
      locale: PlatformLocale;
      venueName: string;
      role: StaffRole;
      invitationToken: string;
    }
  | {
      kind: "ONLINE_ORDER_RECEIVED";
      recipient: string;
      locale: PlatformLocale;
      referenceCode: string;
      trackingToken: string;
    }
  | {
      kind: "ONLINE_ORDER_STATUS_CHANGED";
      recipient: string;
      locale: PlatformLocale;
      referenceCode: string;
      status: OnlineOrderStatus;
      note: string | null;
    }
  | {
      kind: "RESERVATION_CONFIRMED";
      recipient: string;
      locale: PlatformLocale;
      venueName: string;
      requestedFor: Date;
      timezone: string;
      partySize: number;
    };

/**
 * Provider-neutral boundary for transactional delivery. Implementations may
 * enqueue or send, but business mutations must complete before this is called.
 */
export type TransactionalNotificationService = {
  send(notification: TransactionalNotification): Promise<void>;
};

export const disabledTransactionalNotificationService: TransactionalNotificationService =
  {
    async send() {},
  };
