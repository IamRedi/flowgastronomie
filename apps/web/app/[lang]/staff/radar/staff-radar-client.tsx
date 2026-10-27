"use client";

import {
  hasStaffPermission,
  permissionForOrderTransition,
  type OrderStatus,
  type StaffRadarSignal,
  type StaffRole,
} from "@flowgastronomie/domain";
import { useCallback, useEffect, useState } from "react";

import type { Dictionary } from "../../../../lib/dictionaries";
import type { Locale } from "../../../../lib/i18n";

type Staff = {
  membershipId: string;
  displayName: string;
  venueName: string;
  role: StaffRole;
};

type Assignee = {
  membershipId: string;
  displayName: string;
  role: StaffRole;
};

type Shift = {
  id: string;
  status: "OPEN";
  startedAt: string;
  recordedPaymentMinor: number;
  actionCount: number;
};

type NextOrderStatus = Exclude<OrderStatus, "NEW">;

const fallbackRadarText = {
  sq: {
    acceptTicket: "Prano dhe fillo",
    assignedTo: "Caktuar për",
    assignTo: "Cakto punonjësin",
    completeTask: "Përfundo detyrën",
    markTicketReady: "Njofto: pjesa është gati",
    myTask: "Detyra ime",
    readyForWaiter: "Gati — kërkon kamarier",
    reports: "Raportet ditore",
    paymentHistory: "Historiku i pagesave",
    releaseTask: "Liro detyrën",
    serveTicket: "Merre dhe shërbeje",
    takeForService: "Merre për shërbim",
    takeTask: "Prano detyrën",
    tableOrderOwner: "Porosi e marrë nga",
  },
  en: {
    acceptTicket: "Accept and start",
    assignedTo: "Assigned to",
    assignTo: "Assign staff member",
    completeTask: "Complete task",
    markTicketReady: "Notify: this part is ready",
    myTask: "My task",
    readyForWaiter: "Ready — waiter needed",
    reports: "Daily reports",
    paymentHistory: "Payment history",
    releaseTask: "Release task",
    serveTicket: "Take and serve",
    takeForService: "Take for service",
    takeTask: "Accept task",
    tableOrderOwner: "Order taken by",
  },
  de: {
    acceptTicket: "Annehmen und starten",
    assignedTo: "Zugewiesen an",
    assignTo: "Mitarbeiter zuweisen",
    completeTask: "Aufgabe abschließen",
    markTicketReady: "Melden: Teil ist fertig",
    myTask: "Meine Aufgabe",
    readyForWaiter: "Fertig — Service benötigt",
    reports: "Tagesberichte",
    paymentHistory: "Zahlungsverlauf",
    releaseTask: "Aufgabe freigeben",
    serveTicket: "Übernehmen und servieren",
    takeForService: "Zum Servieren übernehmen",
    takeTask: "Aufgabe annehmen",
    tableOrderOwner: "Bestellung aufgenommen von",
  },
  it: {
    acceptTicket: "Accetta e inizia",
    assignedTo: "Assegnato a",
    assignTo: "Assegna collaboratore",
    completeTask: "Completa attività",
    markTicketReady: "Avvisa: questa parte è pronta",
    myTask: "La mia attività",
    readyForWaiter: "Pronto — serve cameriere",
    reports: "Rapporti giornalieri",
    paymentHistory: "Storico pagamenti",
    releaseTask: "Rilascia attività",
    serveTicket: "Prendi e servi",
    takeForService: "Prendi per il servizio",
    takeTask: "Accetta attività",
    tableOrderOwner: "Ordine preso da",
  },
} satisfies Record<Locale, Record<string, string>>;

const roleNames: Record<Locale, Record<StaffRole, string>> = {
  sq: {
    OWNER: "Pronar",
    MANAGER: "Menaxher",
    WAITER: "Kamarier",
    BAR: "Banak",
    KITCHEN: "Kuzhinë",
  },
  en: {
    OWNER: "Owner",
    MANAGER: "Manager",
    WAITER: "Waiter",
    BAR: "Bar",
    KITCHEN: "Kitchen",
  },
  de: {
    OWNER: "Inhaber",
    MANAGER: "Manager",
    WAITER: "Service",
    BAR: "Theke",
    KITCHEN: "Küche",
  },
  it: {
    OWNER: "Titolare",
    MANAGER: "Manager",
    WAITER: "Cameriere",
    BAR: "Bancone",
    KITCHEN: "Cucina",
  },
};

const nextStatus: Partial<Record<OrderStatus, NextOrderStatus>> = {
  READY: "SERVED",
};

type ProductionTicket = NonNullable<
  StaffRadarSignal["order"]
>["productionTickets"][number];

function canWorkTicket(role: StaffRole, ticket: ProductionTicket) {
  return (
    role === "OWNER" ||
    role === "MANAGER" ||
    (role === "BAR" && ticket.station === "BAR") ||
    (role === "KITCHEN" && ["KITCHEN", "DESSERT"].includes(ticket.station))
  );
}

function canHandleSignal(role: StaffRole, signal: StaffRadarSignal) {
  if (!signal.order) {
    return hasStaffPermission(
      role,
      signal.type === "BILL_REQUEST" ? "PAYMENT_RECORD" : "SIGNAL_ACKNOWLEDGE",
    );
  }
  return hasStaffPermission(role, "ORDER_SERVE");
}

function signalIsRelevant(role: StaffRole, signal: StaffRadarSignal) {
  if (role === "OWNER" || role === "MANAGER") return true;
  if (role === "WAITER") {
    return (
      !signal.order ||
      signal.order.serviceOwner?.isMine === true ||
      signal.order.productionTickets.some((ticket) => ticket.status === "READY")
    );
  }
  if (!signal.order) return false;
  return signal.order.productionTickets.some(
    (ticket) =>
      ticket.status !== "SERVED" &&
      ((role === "BAR" && ticket.station === "BAR") ||
        (role === "KITCHEN" &&
          ["KITCHEN", "DESSERT"].includes(ticket.station))),
  );
}

function ticketIsRelevant(
  role: StaffRole,
  ticket: ProductionTicket,
  serviceOwnerIsMine: boolean,
) {
  if (role === "OWNER" || role === "MANAGER") return true;
  if (role === "WAITER") {
    return serviceOwnerIsMine || ticket.status === "READY";
  }
  return canWorkTicket(role, ticket) && ticket.status !== "SERVED";
}

function formatPrice(amount: number, currency: string, locale: Locale) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount / 100);
}

function formatWait(seconds: number) {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
}

export function StaffRadarClient({
  locale,
  radarLabels,
  staffLabels,
  stationFilter,
}: {
  locale: Locale;
  radarLabels: Dictionary["radar"];
  staffLabels: Dictionary["staff"];
  stationFilter?: "BAR" | "KITCHEN";
}) {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);
  const [signals, setSignals] = useState<StaffRadarSignal[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const fallbackText = fallbackRadarText[locale];
  const text = <K extends keyof typeof fallbackText>(
    key: K,
    value: string | undefined,
  ) => value || fallbackText[key];
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";

  const goToLogin = useCallback(() => {
    window.location.assign(`/${locale}/staff/login`);
  }, [locale]);

  const loadBoard = useCallback(async () => {
    const [identityResponse, radarResponse, shiftResponse] = await Promise.all([
      fetch(`${apiUrl}/v1/staff/me`, { credentials: "include" }),
      fetch(`${apiUrl}/v1/staff/radar`, {
        cache: "no-store",
        credentials: "include",
      }),
      fetch(`${apiUrl}/v1/staff/shift`, {
        cache: "no-store",
        credentials: "include",
      }),
    ]);

    if (
      identityResponse.status === 401 ||
      radarResponse.status === 401 ||
      shiftResponse.status === 401
    ) {
      goToLogin();
      return;
    }

    if (identityResponse.ok) {
      const identity = (await identityResponse.json()) as { staff: Staff };
      setStaff(identity.staff);
    }
    if (radarResponse.ok) {
      const radar = (await radarResponse.json()) as {
        signals: StaffRadarSignal[];
        assignees: Assignee[];
      };
      setSignals(radar.signals);
      setAssignees(radar.assignees);
    }
    if (shiftResponse.ok) {
      const work = (await shiftResponse.json()) as { shift: Shift | null };
      setShift(work.shift);
    }
    setLoading(false);
  }, [apiUrl, goToLogin]);

  useEffect(() => {
    void loadBoard();
    const interval = window.setInterval(() => void loadBoard(), 2_000);
    return () => window.clearInterval(interval);
  }, [loadBoard]);

  async function orderAction(signal: StaffRadarSignal, status: OrderStatus) {
    if (!signal.order) return;
    setBusyId(signal.id);
    setFeedback(null);

    const response = await fetch(
      `${apiUrl}/v1/staff/orders/${encodeURIComponent(signal.order.id)}/status`,
      {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          expectedVersion: signal.order.version,
        }),
      },
    );

    if (response.status === 401) return goToLogin();
    if (!response.ok) setFeedback(staffLabels.updateError);
    await loadBoard();
    setBusyId(null);
  }

  async function claim(signal: StaffRadarSignal) {
    setBusyId(signal.id);
    setFeedback(null);
    try {
      const response = await fetch(
        `${apiUrl}/v1/staff/radar/${encodeURIComponent(signal.id)}/claim`,
        { method: "PATCH", credentials: "include" },
      );
      if (response.status === 401) return goToLogin();
      if (!response.ok) setFeedback(staffLabels.updateError);
      await loadBoard();
    } catch {
      setFeedback(staffLabels.updateError);
    } finally {
      setBusyId(null);
    }
  }

  async function claimAndAdvance(
    signal: StaffRadarSignal,
    status: OrderStatus,
  ) {
    if (!signal.order) return;
    setBusyId(signal.id);
    setFeedback(null);
    try {
      const claimResponse = await fetch(
        `${apiUrl}/v1/staff/radar/${encodeURIComponent(signal.id)}/claim`,
        { method: "PATCH", credentials: "include" },
      );
      if (claimResponse.status === 401) return goToLogin();
      if (!claimResponse.ok) {
        setFeedback(staffLabels.updateError);
        return;
      }
      const orderResponse = await fetch(
        `${apiUrl}/v1/staff/orders/${encodeURIComponent(signal.order.id)}/status`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status,
            expectedVersion: signal.order.version,
          }),
        },
      );
      if (!orderResponse.ok) setFeedback(staffLabels.updateError);
      await loadBoard();
    } catch {
      setFeedback(staffLabels.updateError);
    } finally {
      setBusyId(null);
    }
  }

  async function assign(signal: StaffRadarSignal, membershipId: string) {
    if (!membershipId) return;
    setBusyId(signal.id);
    setFeedback(null);
    const response = await fetch(
      `${apiUrl}/v1/staff/radar/${encodeURIComponent(signal.id)}/assignment`,
      {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ membershipId }),
      },
    );
    if (!response.ok) setFeedback(staffLabels.updateError);
    await loadBoard();
    setBusyId(null);
  }

  async function productionAction(
    ticket: ProductionTicket,
    status: "PREPARING" | "READY" | "SERVED",
  ) {
    setBusyId(ticket.id);
    setFeedback(null);
    try {
      const response = await fetch(
        `${apiUrl}/v1/staff/production-tickets/${encodeURIComponent(ticket.id)}/status`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status, expectedVersion: ticket.version }),
        },
      );
      if (response.status === 401) return goToLogin();
      if (!response.ok) setFeedback(staffLabels.updateError);
      await loadBoard();
    } catch {
      setFeedback(staffLabels.updateError);
    } finally {
      setBusyId(null);
    }
  }

  async function assignProduction(
    ticket: ProductionTicket,
    membershipId: string,
  ) {
    if (!membershipId) return;
    setBusyId(ticket.id);
    const response = await fetch(
      `${apiUrl}/v1/staff/production-tickets/${encodeURIComponent(ticket.id)}/assignment`,
      {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ membershipId }),
      },
    );
    if (!response.ok) setFeedback(staffLabels.updateError);
    await loadBoard();
    setBusyId(null);
  }

  async function release(signal: StaffRadarSignal) {
    setBusyId(signal.id);
    const response = await fetch(
      `${apiUrl}/v1/staff/radar/${encodeURIComponent(signal.id)}/assignment`,
      { method: "DELETE", credentials: "include" },
    );
    if (!response.ok) setFeedback(staffLabels.updateError);
    await loadBoard();
    setBusyId(null);
  }

  async function acknowledge(signal: StaffRadarSignal) {
    setBusyId(signal.id);
    setFeedback(null);
    const response = await fetch(
      `${apiUrl}/v1/staff/radar/${encodeURIComponent(signal.id)}/acknowledge`,
      { method: "PATCH", credentials: "include" },
    );

    if (response.status === 401) return goToLogin();
    if (!response.ok) setFeedback(staffLabels.updateError);
    await loadBoard();
    setBusyId(null);
  }

  async function closeTable(signal: StaffRadarSignal) {
    setBusyId(signal.id);
    setFeedback(null);
    const response = await fetch(
      `${apiUrl}/v1/staff/table-sessions/${encodeURIComponent(signal.tableSessionId)}/close`,
      { method: "PATCH", credentials: "include" },
    );

    if (response.status === 401) return goToLogin();
    if (response.status === 409) {
      const error = (await response.json()) as { code?: string };
      setFeedback(
        error.code === "SESSION_PAYMENT_OUTSTANDING"
          ? staffLabels.paymentOutstanding
          : staffLabels.closeBlocked,
      );
    } else if (!response.ok) setFeedback(staffLabels.updateError);
    await loadBoard();
    setBusyId(null);
  }

  async function changeShift(action: "start" | "end") {
    setBusyId("shift");
    setFeedback(null);
    const response = await fetch(`${apiUrl}/v1/staff/shift/${action}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (response.status === 401) return goToLogin();
    if (!response.ok) setFeedback(staffLabels.updateError);
    await loadBoard();
    setBusyId(null);
  }

  async function recordPayment(
    signal: StaffRadarSignal,
    method: "CASH" | "CARD_AT_TABLE",
  ) {
    if (signal.balance.outstandingMinor <= 0) return;
    setBusyId(signal.id);
    setFeedback(null);
    const response = await fetch(
      `${apiUrl}/v1/staff/table-sessions/${encodeURIComponent(signal.tableSessionId)}/payments`,
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountMinor: signal.balance.outstandingMinor,
          method,
          idempotencyKey: crypto.randomUUID(),
        }),
      },
    );
    if (response.status === 401) return goToLogin();
    setFeedback(
      response.ok ? staffLabels.paymentRecorded : staffLabels.updateError,
    );
    await loadBoard();
    setBusyId(null);
  }

  async function logout() {
    await fetch(`${apiUrl}/v1/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    goToLogin();
  }

  const visibleSignals = staff
    ? signals.filter(
        (signal) =>
          signalIsRelevant(staff.role, signal) &&
          (!stationFilter ||
            signal.order?.productionTickets.some(
              (ticket) => ticket.station === stationFilter,
            )),
      )
    : [];

  return (
    <main className="real-radar-page">
      <header className="real-radar-header shell">
        <a className="brand brand-light" href={`/${locale}`}>
          <span className="brand-mark radar-brand-mark">FG</span>
          <span>FlowGastronomie</span>
        </a>
        <div className="staff-identity">
          {staff && hasStaffPermission(staff.role, "VENUE_SETUP_VIEW") && (
            <a href={`/${locale}/staff/setup`}>{staffLabels.setup}</a>
          )}
          {staff && hasStaffPermission(staff.role, "TEAM_VIEW") && (
            <a href={`/${locale}/staff/team`}>{staffLabels.team}</a>
          )}

          {staff &&
            (hasStaffPermission(staff.role, "PAYMENT_RECORD") ||
              hasStaffPermission(staff.role, "PAYMENT_VOID")) && (
              <a href={"/" + locale + "/staff/payments"}>
                {text("paymentHistory", radarLabels.paymentHistory)}
              </a>
            )}
          {staff && (
            <span>
              {staff.displayName} · {staff.venueName} · {staffLabels.role}:{" "}
              {staff.role}
            </span>
          )}
          {shift ? (
            <button
              disabled={busyId === "shift"}
              onClick={() => changeShift("end")}
              type="button"
            >
              {staffLabels.endShift}
            </button>
          ) : (
            <button
              disabled={busyId === "shift"}
              onClick={() => changeShift("start")}
              type="button"
            >
              {staffLabels.startShift}
            </button>
          )}
          <button onClick={logout} type="button">
            {staffLabels.logout}
          </button>
        </div>
      </header>

      <section className="real-radar-intro shell">
        <p className="eyebrow eyebrow-light">{radarLabels.eyebrow}</p>
        <h1>
          {stationFilter
            ? (radarLabels.stations?.[stationFilter] ?? stationFilter)
            : "Service Radar"}
        </h1>
        <p>{stationFilter ? radarLabels.text : radarLabels.text}</p>
      </section>

      <section className="real-radar shell" aria-busy={loading}>
        {!shift && (
          <div className="shift-required-card">
            <strong>{staffLabels.noShift}</strong>
            <button onClick={() => changeShift("start")} type="button">
              {staffLabels.startShift}
            </button>
          </div>
        )}
        {shift && (
          <div className="shift-active-strip">
            <strong>{staffLabels.shiftActive}</strong>
            <span>
              {shift.actionCount} {staffLabels.actionsCount} ·{" "}
              {formatPrice(shift.recordedPaymentMinor, "EUR", locale)}
            </span>
          </div>
        )}
        <div className="real-radar-summary">
          <div>
            <strong>{visibleSignals.length}</strong>
            <span>{radarLabels.summary[0]?.label}</span>
          </div>
          <div>
            <strong>
              {visibleSignals[0]
                ? formatWait(visibleSignals[0].waitingSeconds)
                : "—"}
            </strong>
            <span>{radarLabels.summary[1]?.label}</span>
          </div>
        </div>

        {feedback && (
          <p className="staff-board-feedback" role="alert">
            {feedback}
          </p>
        )}

        {loading && visibleSignals.length === 0 ? (
          <p className="real-radar-empty">{radarLabels.loading}</p>
        ) : visibleSignals.length === 0 ? (
          <p className="real-radar-empty">{radarLabels.empty}</p>
        ) : (
          <div className="real-signal-list">
            {visibleSignals.map((signal) => {
              const orderStatus = signal.order?.status as
                OrderStatus | undefined;
              const productionTickets = signal.order?.productionTickets ?? [];
              const displayedTickets = staff
                ? productionTickets.filter(
                    (ticket) =>
                      (!stationFilter || ticket.station === stationFilter) &&
                      ticketIsRelevant(
                        staff.role,
                        ticket,
                        signal.order?.serviceOwner?.isMine === true,
                      ),
                  )
                : [];
              const followingStatus = orderStatus
                ? nextStatus[orderStatus]
                : undefined;
              const canAdvance =
                staff &&
                productionTickets.length === 0 &&
                followingStatus &&
                hasStaffPermission(
                  staff.role,
                  permissionForOrderTransition(followingStatus),
                );
              const canClaimRequest =
                staff &&
                !signal.order &&
                hasStaffPermission(
                  staff.role,
                  signal.type === "BILL_REQUEST"
                    ? "PAYMENT_RECORD"
                    : "SIGNAL_ACKNOWLEDGE",
                );
              const needsAttention = signal.order
                ? productionTickets.some(
                    (ticket) =>
                      ["NEW", "READY"].includes(ticket.status) &&
                      !ticket.assignment,
                  )
                : !signal.assignment;
              const isInProgress = Boolean(
                signal.assignment ||
                productionTickets.some(
                  (ticket) =>
                    ticket.assignment || ticket.status === "PREPARING",
                ),
              );
              const stateClass = productionTickets.some(
                (ticket) => ticket.status === "READY",
              )
                ? " signal-ready"
                : needsAttention
                  ? " signal-needs-attention"
                  : isInProgress
                    ? " signal-in-progress"
                    : "";

              return (
                <article
                  className={`real-signal type-${signal.type}${stateClass}`}
                  key={signal.id}
                >
                  <span className="real-table-number">{signal.tableLabel}</span>
                  <div className="real-signal-copy">
                    <small>{signal.area}</small>
                    <h2>
                      {productionTickets.some(
                        (ticket) => ticket.status === "READY",
                      )
                        ? text("readyForWaiter", radarLabels.readyForWaiter)
                        : (radarLabels.types?.[signal.type] ?? signal.type)}
                    </h2>
                    {signal.order && orderStatus && (
                      <p>
                        {staffLabels.statuses[orderStatus]} ·{" "}
                        {signal.order.itemCount} {radarLabels.items} ·{" "}
                        {formatPrice(
                          signal.order.totalMinor,
                          signal.order.currency,
                          locale,
                        )}
                      </p>
                    )}
                    {signal.order?.serviceOwner && (
                      <span className="table-order-owner">
                        {text("tableOrderOwner", radarLabels.tableOrderOwner)}:{" "}
                        {signal.order.serviceOwner.displayName}
                      </span>
                    )}
                    {signal.assignment && (
                      <span
                        className={`task-owner${signal.assignment.isMine ? " mine" : ""}`}
                      >
                        {signal.assignment.isMine
                          ? text("myTask", radarLabels.myTask)
                          : `${text("assignedTo", radarLabels.assignedTo)}: ${signal.assignment.displayName}`}
                      </span>
                    )}
                    {signal.order &&
                      !["SERVED", "CANCELLED"].includes(orderStatus ?? "") && (
                        <div className="production-ticket-list">
                          {displayedTickets.map((ticket) => {
                            const canWork =
                              staff && canWorkTicket(staff.role, ticket);
                            const canControl =
                              canWork &&
                              (!ticket.assignment ||
                                ticket.assignment.isMine ||
                                staff?.role === "OWNER" ||
                                staff?.role === "MANAGER");
                            return (
                              <div
                                className={`production-ticket status-${ticket.status}`}
                                key={ticket.id}
                              >
                                <div>
                                  <strong>
                                    {radarLabels.stations?.[ticket.station] ??
                                      ticket.station}
                                  </strong>
                                  <span>
                                    {radarLabels.ticketStatuses?.[
                                      ticket.status
                                    ] ?? ticket.status}{" "}
                                    · {ticket.itemNames.join(", ")} ·{" "}
                                    {formatPrice(
                                      ticket.subtotalMinor,
                                      signal.order!.currency,
                                      locale,
                                    )}
                                  </span>
                                  {ticket.assignment && (
                                    <small>
                                      {ticket.assignment.isMine
                                        ? text("myTask", radarLabels.myTask)
                                        : `${text("assignedTo", radarLabels.assignedTo)}: ${ticket.assignment.displayName}`}
                                    </small>
                                  )}
                                </div>
                                {ticket.status === "NEW" && canControl && (
                                  <button
                                    className="ticket-action-start"
                                    disabled={busyId === ticket.id || !shift}
                                    onClick={() =>
                                      productionAction(ticket, "PREPARING")
                                    }
                                    type="button"
                                  >
                                    {text(
                                      "acceptTicket",
                                      radarLabels.acceptTicket,
                                    )}
                                  </button>
                                )}
                                {ticket.status === "PREPARING" &&
                                  canControl && (
                                    <button
                                      className="ticket-action-ready"
                                      disabled={busyId === ticket.id || !shift}
                                      onClick={() =>
                                        productionAction(ticket, "READY")
                                      }
                                      type="button"
                                    >
                                      {text(
                                        "markTicketReady",
                                        radarLabels.markTicketReady,
                                      )}
                                    </button>
                                  )}
                                {ticket.status === "READY" &&
                                  staff &&
                                  hasStaffPermission(
                                    staff.role,
                                    "ORDER_SERVE",
                                  ) &&
                                  (!ticket.assignment ||
                                    ticket.assignment.isMine ||
                                    staff.role === "OWNER" ||
                                    staff.role === "MANAGER") && (
                                    <button
                                      className="ticket-action-serve"
                                      disabled={busyId === ticket.id || !shift}
                                      onClick={() =>
                                        productionAction(ticket, "SERVED")
                                      }
                                      type="button"
                                    >
                                      {text(
                                        "serveTicket",
                                        radarLabels.serveTicket,
                                      )}
                                    </button>
                                  )}
                                {staff &&
                                  ticket.status !== "SERVED" &&
                                  hasStaffPermission(
                                    staff.role,
                                    "TABLE_ASSIGN",
                                  ) && (
                                    <select
                                      aria-label={text(
                                        "assignTo",
                                        radarLabels.assignTo,
                                      )}
                                      onChange={(event) => {
                                        void assignProduction(
                                          ticket,
                                          event.target.value,
                                        );
                                        event.target.value = "";
                                      }}
                                      value=""
                                    >
                                      <option value="">—</option>
                                      {assignees
                                        .filter((assignee) =>
                                          ticket.status === "READY"
                                            ? hasStaffPermission(
                                                assignee.role,
                                                "ORDER_SERVE",
                                              )
                                            : canWorkTicket(
                                                assignee.role,
                                                ticket,
                                              ),
                                        )
                                        .map((assignee) => (
                                          <option
                                            key={assignee.membershipId}
                                            value={assignee.membershipId}
                                          >
                                            {assignee.displayName}
                                          </option>
                                        ))}
                                    </select>
                                  )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                  </div>
                  <strong className="real-wait">
                    {formatWait(signal.waitingSeconds)}
                  </strong>
                  <div className="staff-signal-actions">
                    {!signal.assignment && shift && canAdvance && (
                      <button
                        className="action-claim"
                        disabled={busyId === signal.id}
                        onClick={() =>
                          followingStatus &&
                          claimAndAdvance(signal, followingStatus)
                        }
                        type="button"
                      >
                        {text("takeForService", radarLabels.takeForService)}
                      </button>
                    )}
                    {signal.order &&
                    followingStatus &&
                    canAdvance &&
                    signal.assignment?.isMine ? (
                      <button
                        className="action-serve"
                        disabled={busyId === signal.id || !shift}
                        onClick={() => orderAction(signal, followingStatus)}
                        type="button"
                      >
                        {staffLabels.actions?.[followingStatus] ??
                          text("serveTicket", radarLabels.serveTicket)}
                      </button>
                    ) : (
                      !signal.order &&
                      canClaimRequest &&
                      !signal.assignment && (
                        <button
                          className="action-claim"
                          disabled={busyId === signal.id || !shift}
                          onClick={() => claim(signal)}
                          type="button"
                        >
                          {text("takeTask", radarLabels.takeTask)}
                        </button>
                      )
                    )}
                    {!signal.order &&
                      signal.assignment?.isMine &&
                      (signal.type !== "BILL_REQUEST" ||
                        signal.balance.outstandingMinor === 0) && (
                        <button
                          className="action-complete"
                          disabled={busyId === signal.id || !shift}
                          onClick={() => acknowledge(signal)}
                          type="button"
                        >
                          {text("completeTask", radarLabels.completeTask)}
                        </button>
                      )}
                    {signal.type === "BILL_REQUEST" &&
                      staff &&
                      signal.assignment?.isMine &&
                      hasStaffPermission(staff.role, "SESSION_CLOSE") && (
                        <>
                          {signal.balance.outstandingMinor > 0 &&
                            hasStaffPermission(
                              staff.role,
                              "PAYMENT_RECORD",
                            ) && (
                              <>
                                <button
                                  className="secondary-action"
                                  disabled={busyId === signal.id || !shift}
                                  onClick={() => recordPayment(signal, "CASH")}
                                  type="button"
                                >
                                  {staffLabels.recordCash} ·{" "}
                                  {formatPrice(
                                    signal.balance.outstandingMinor,
                                    signal.balance.currency,
                                    locale,
                                  )}
                                </button>
                                <button
                                  className="secondary-action"
                                  disabled={busyId === signal.id || !shift}
                                  onClick={() =>
                                    recordPayment(signal, "CARD_AT_TABLE")
                                  }
                                  type="button"
                                >
                                  {staffLabels.recordCard}
                                </button>
                              </>
                            )}
                          <button
                            className="secondary-action"
                            disabled={busyId === signal.id || !shift}
                            onClick={() => closeTable(signal)}
                            type="button"
                          >
                            {staffLabels.closeTable}
                          </button>
                        </>
                      )}
                    {signal.assignment &&
                      staff &&
                      (signal.assignment.isMine ||
                        hasStaffPermission(staff.role, "TABLE_ASSIGN")) && (
                        <button
                          className="secondary-action"
                          disabled={busyId === signal.id}
                          onClick={() => release(signal)}
                          type="button"
                        >
                          {text("releaseTask", radarLabels.releaseTask)}
                        </button>
                      )}
                    {staff &&
                      (!signal.order || productionTickets.length === 0) &&
                      hasStaffPermission(staff.role, "TABLE_ASSIGN") && (
                        <label className="manager-assign-control">
                          <span>{text("assignTo", radarLabels.assignTo)}</span>
                          <select
                            disabled={busyId === signal.id}
                            onChange={(event) => {
                              void assign(signal, event.target.value);
                              event.target.value = "";
                            }}
                            value=""
                          >
                            <option value="">—</option>
                            {assignees
                              .filter((assignee) =>
                                canHandleSignal(assignee.role, signal),
                              )
                              .map((assignee) => (
                                <option
                                  key={assignee.membershipId}
                                  value={assignee.membershipId}
                                >
                                  {assignee.displayName} ·{" "}
                                  {roleNames[locale][assignee.role]}
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
