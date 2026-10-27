"use client";

import type { DailyOperationsReport } from "@flowgastronomie/domain";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { Dictionary } from "../../../../lib/dictionaries";
import type { Locale } from "../../../../lib/i18n";
import { ReconciliationPanel } from "../../../../components/payment-reconciliation";
import { reconciliationText } from "../../../../lib/order-reconciliation-copy";

function formatMoney(amount: number, currency: string, locale: Locale) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount / 100);
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? hours + "h " + remainder + "m" : remainder + "m";
}

function formatResponse(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return seconds + "s";
  return Math.floor(seconds / 60) + "m " + (seconds % 60) + "s";
}

function formatPercent(basisPoints: number, locale: Locale) {
  return (
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
      basisPoints / 100,
    ) + "%"
  );
}

export function StaffReportsClient({
  labels,
  locale,
}: {
  labels: Dictionary["reports"];
  locale: Locale;
}) {
  const [report, setReport] = useState<DailyOperationsReport | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const recon = reconciliationText(locale);

  const loadReport = useCallback(
    async (date?: string) => {
      setLoading(true);
      setError(false);
      try {
        const query = date ? "?date=" + encodeURIComponent(date) : "";
        const response = await fetch(
          apiUrl + "/v1/staff/reports/daily" + query,
          { cache: "no-store", credentials: "include" },
        );
        if (response.status === 401) {
          window.location.assign("/" + locale + "/staff/login");
          return;
        }
        if (!response.ok) throw new Error("Report request failed");
        const result = (await response.json()) as DailyOperationsReport;
        setReport(result);
        setSelectedDate(result.date);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [apiUrl, locale],
  );

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  function selectDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedDate) void loadReport(selectedDate);
  }

  return (
    <main className="setup-page reports-page">
      <header className="menu-admin-header shell">
        <nav className="menu-admin-nav" aria-label="Staff workspace">
          <a href={"/" + locale + "/staff/radar"}>{labels.radar}</a>
          <a href={"/" + locale + "/staff/team"}>{labels.team}</a>
          <a href={"/" + locale + "/staff/payments"}>{labels.payments}</a>
        </nav>
      </header>

      <section className="reports-intro shell">
        <div>
          <p className="eyebrow">FlowGastronomie OS</p>
          <h1>{labels.title}</h1>
          <p>{labels.subtitle}</p>
        </div>
        <form className="report-date-control" onSubmit={selectDate}>
          <label htmlFor="report-date">{labels.date}</label>
          <div>
            <input
              id="report-date"
              max="9999-12-31"
              name="date"
              onChange={(event) => setSelectedDate(event.target.value)}
              required
              type="date"
              value={selectedDate}
            />
            <button disabled={loading} type="submit">
              {labels.show}
            </button>
          </div>
        </form>
      </section>

      <div className="reports-content shell" aria-busy={loading}>
        {loading && !report && (
          <p className="report-message">{labels.loading}</p>
        )}
        {error && <p className="report-message error">{labels.error}</p>}
        {report && (
          <>
            <div className="report-scope-strip">
              <strong>
                {report.scope === "VENUE"
                  ? labels.venueScope
                  : labels.selfScope}
              </strong>
              <span>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "long",
                  timeZone: report.timezone,
                }).format(new Date(report.date + "T12:00:00Z"))}{" "}
                · {report.timezone}
              </span>
            </div>

            <section className="report-summary-grid" aria-label={labels.title}>
              <article>
                <span>
                  {report.reconciliation ? recon.ordersToday : labels.orders}
                </span>
                <strong>
                  {report.reconciliation?.ordersCreated.count ??
                    report.orders.submitted}
                </strong>
                <small>
                  {report.orders.served} {labels.served} ·{" "}
                  {report.orders.cancelled} {labels.cancelled}
                </small>
              </article>
              <article>
                <span>
                  {report.reconciliation ? recon.orderValue : labels.orderValue}
                </span>
                <strong>
                  {formatMoney(
                    report.reconciliation?.ordersCreated.orderValueMinor ??
                      report.orders.orderValueMinor,
                    report.currency,
                    locale,
                  )}
                </strong>
                <small>{labels.operationalNote}</small>
              </article>
              <article>
                <span>{recon.recordedToday}</span>
                <strong>
                  {formatMoney(
                    report.payments.recordedMinor,
                    report.currency,
                    locale,
                  )}
                </strong>
                <small>
                  {labels.voided}:{" "}
                  {formatMoney(
                    report.payments.voidedMinor,
                    report.currency,
                    locale,
                  )}
                </small>
              </article>
              <article>
                <span>{labels.averageResponse}</span>
                <strong>
                  {formatResponse(report.service.averageAcknowledgeSeconds)}
                </strong>
                <small>
                  {report.service.unresolved} {labels.unresolved}
                </small>
              </article>
            </section>

            {report.reconciliation && (
              <ReconciliationPanel
                data={report.reconciliation}
                locale={locale}
                currency={report.currency}
              />
            )}

            <section className="report-detail-grid">
              <ReportPanel title={labels.channels}>
                {(["table", "pickup", "delivery", "catering"] as const).map(
                  (channel) => (
                    <ReportValue
                      key={channel}
                      label={`${labels[channel]} · ${report.channels[channel].submitted}`}
                      value={formatMoney(
                        report.channels[channel].orderValueMinor,
                        report.currency,
                        locale,
                      )}
                    />
                  ),
                )}
              </ReportPanel>
              <ReportPanel title={labels.costing}>
                {report.costing.complete ? (
                  <>
                    <ReportValue
                      label={labels.estimatedFoodCost}
                      value={formatPercent(
                        report.costing.estimatedFoodCostBasisPoints ?? 0,
                        locale,
                      )}
                    />
                    <ReportValue
                      label={labels.estimatedContribution}
                      value={formatMoney(
                        report.costing.estimatedContributionMinor ?? 0,
                        report.currency,
                        locale,
                      )}
                    />
                    <ReportValue
                      label={labels.estimatedDirectCost}
                      value={formatMoney(
                        report.costing.estimatedDirectCostMinor ?? 0,
                        report.currency,
                        locale,
                      )}
                    />
                  </>
                ) : (
                  <p className="report-panel-note">
                    {labels.costingIncomplete
                      .replace(
                        "{costed}",
                        String(report.costing.costedItemCount),
                      )
                      .replace("{total}", String(report.costing.itemCount))}
                  </p>
                )}
              </ReportPanel>
              <ReportPanel title={labels.reservations}>
                <ReportValue
                  label={labels.reservationRequested}
                  value={String(report.reservations.requested)}
                />
                <ReportValue
                  label={labels.reservationConfirmed}
                  value={String(report.reservations.confirmed)}
                />
                <ReportValue
                  label={labels.reservationSeated}
                  value={String(report.reservations.seated)}
                />
                <ReportValue
                  label={labels.reservationCompleted}
                  value={String(report.reservations.completed)}
                />
                <ReportValue
                  label={labels.cancelled}
                  value={String(report.reservations.cancelled)}
                />
                <ReportValue
                  label={labels.noShows}
                  value={String(report.reservations.noShows)}
                />
                <ReportValue
                  label={labels.reservationGuests}
                  value={String(report.reservations.partySize)}
                />
              </ReportPanel>
              <ReportPanel title={recon.recordedToday}>
                <ReportValue
                  label={labels.cash}
                  value={formatMoney(
                    report.payments.cashMinor,
                    report.currency,
                    locale,
                  )}
                />
                <ReportValue
                  label={recon.card}
                  value={formatMoney(
                    report.payments.cardMinor,
                    report.currency,
                    locale,
                  )}
                />
                <ReportValue
                  label={labels.other}
                  value={formatMoney(
                    report.payments.otherMinor,
                    report.currency,
                    locale,
                  )}
                />
              </ReportPanel>
              <ReportPanel title={labels.requests}>
                <ReportValue
                  label={labels.requests}
                  value={String(report.service.requests)}
                />
                <ReportValue
                  label={labels.acknowledged}
                  value={String(report.service.acknowledged)}
                />
                <ReportValue
                  label={labels.unresolved}
                  value={String(report.service.unresolved)}
                />
              </ReportPanel>
              <ReportPanel title={labels.shifts}>
                <ReportValue
                  label={labels.shifts}
                  value={String(report.shifts.count)}
                />
                <ReportValue
                  label={labels.openShifts}
                  value={String(report.shifts.open)}
                />
                <ReportValue
                  label={labels.worked}
                  value={formatDuration(report.shifts.workedMinutes)}
                />
              </ReportPanel>
            </section>

            <section className="staff-activity-section">
              <div className="setup-section-heading">
                <h2>{labels.popularProducts}</h2>
              </div>
              {report.popularProducts.length === 0 ? (
                <p className="report-message">{labels.noPopularProducts}</p>
              ) : (
                <div className="report-product-list">
                  {report.popularProducts.map((product) => (
                    <article key={product.productId}>
                      <strong>{product.productName}</strong>
                      <span>
                        {product.quantity} ·{" "}
                        {formatMoney(
                          product.orderValueMinor,
                          report.currency,
                          locale,
                        )}
                      </span>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="staff-activity-section">
              <div className="setup-section-heading">
                <h2>{labels.staffActivity}</h2>
              </div>
              {report.staff.length === 0 ? (
                <p className="report-message">{labels.noActivity}</p>
              ) : (
                <div className="staff-activity-grid">
                  {report.staff.map((person) => (
                    <article key={person.membershipId}>
                      <header>
                        <div>
                          <strong>{person.displayName}</strong>
                          <span>{labels.roles[person.role]}</span>
                        </div>
                        {person.onShift && <em>{labels.onShift}</em>}
                      </header>
                      <div className="staff-activity-primary">
                        <strong>{person.actionCount}</strong>
                        <span>{labels.actions}</span>
                        <strong>{formatDuration(person.workedMinutes)}</strong>
                        <span>{labels.worked}</span>
                      </div>
                      <ul>
                        <li>
                          {person.ticketsStarted} {labels.started}
                        </li>
                        <li>
                          {person.ticketsReady} {labels.ready}
                        </li>
                        <li>
                          {person.partsServed} {labels.partsServed}
                        </li>
                        <li>
                          {person.requestsCompleted} {labels.requestsCompleted}
                        </li>
                        <li>
                          {person.paymentsRecorded} {labels.paymentsRecorded} ·{" "}
                          {formatMoney(
                            person.paymentTotalMinor,
                            report.currency,
                            locale,
                          )}
                        </li>
                        <li>
                          {person.tablesClosed} {labels.tablesClosed}
                        </li>
                      </ul>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <p className="report-boundary-note">{labels.operationalNote}</p>
          </>
        )}
      </div>
    </main>
  );
}

function ReportPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="report-panel">
      <h2>{title}</h2>
      <dl>{children}</dl>
    </article>
  );
}

function ReportValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
