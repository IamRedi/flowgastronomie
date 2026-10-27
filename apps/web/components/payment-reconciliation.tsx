import type { DailyReconciliation } from "@flowgastronomie/domain";
import type { Locale } from "../lib/i18n";
import { reconciliationText } from "../lib/order-reconciliation-copy";

export function ReconciliationNotes({
  data,
  locale,
}: {
  data: DailyReconciliation;
  locale: Locale;
}) {
  const text = reconciliationText(locale);
  return (
    <div className="reconciliation-notes">
      <p>{text.explanation}</p>
      <p>{text.paidNote}</p>
      {data.ordersCreated.unallocatedMinor > 0 && <p>{text.sessionNote}</p>}
      {data.paymentsRecorded.unlinkedMinor > 0 && (
        <p role="status">{text.reviewNote}</p>
      )}
    </div>
  );
}

export function ReconciliationPanel({
  data,
  locale,
  currency,
}: {
  data: DailyReconciliation;
  locale: Locale;
  currency: string;
}) {
  const text = reconciliationText(locale);
  const money = (amount: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      amount / 100,
    );
  const created = data.ordersCreated;
  const recorded = data.paymentsRecorded;
  const rows = [
    [text.orderValue, created.orderValueMinor, "reconciliation-order-value"],
    [text.paidTodayOrders, created.paidMinor, "reconciliation-paid"],
    [text.pendingTodayOrders, created.pendingMinor, "reconciliation-pending"],
    [text.otherPayments, recorded.otherPaymentsMinor, "reconciliation-other"],
    [text.recordedToday, recorded.totalMinor, "reconciliation-recorded"],
  ] as const;
  return (
    <section
      id="reconciliation"
      className="report-panel reconciliation-panel"
      aria-labelledby="reconciliation-title"
    >
      <h2 id="reconciliation-title">{text.reconciliation}</h2>
      <dl>
        {rows.map(([label, amount, testId]) => (
          <div key={testId}>
            <dt>{label}</dt>
            <dd data-testid={testId}>{money(amount)}</dd>
          </div>
        ))}
      </dl>
      <div className="reconciliation-breakdown">
        <dl>
          <div>
            <dt>{text.todayRecordings}</dt>
            <dd>{money(recorded.todayOrdersMinor)}</dd>
          </div>
          <div>
            <dt>{text.earlierOrders}</dt>
            <dd>{money(recorded.earlierOrdersMinor)}</dd>
          </div>
          <div>
            <dt>{text.sessionOnly}</dt>
            <dd>{money(recorded.tableSessionOnlyMinor)}</dd>
          </div>
          <div>
            <dt>{text.excludedPayments}</dt>
            <dd>{money(recorded.excludedOrdersMinor)}</dd>
          </div>
          <div>
            <dt>{text.unlinked}</dt>
            <dd>{money(recorded.unlinkedMinor)}</dd>
          </div>
          {created.unallocatedMinor > 0 && (
            <div>
              <dt>{text.unallocated}</dt>
              <dd data-testid="reconciliation-unallocated">
                {money(created.unallocatedMinor)}
              </dd>
            </div>
          )}
          {created.overpaidMinor > 0 && (
            <div>
              <dt>{text.overpaid}</dt>
              <dd>{money(created.overpaidMinor)}</dd>
            </div>
          )}
          {created.excludedCount > 0 && (
            <div>
              <dt>{text.excluded}</dt>
              <dd>{created.excludedCount}</dd>
            </div>
          )}
        </dl>
      </div>
      <ReconciliationNotes data={data} locale={locale} />
    </section>
  );
}
