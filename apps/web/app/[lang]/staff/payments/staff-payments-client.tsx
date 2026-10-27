"use client";

import type { StaffPaymentHistory } from "@flowgastronomie/domain";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { Dictionary } from "../../../../lib/dictionaries";
import type { Locale } from "../../../../lib/i18n";

function formatMoney(amount: number, currency: string, locale: Locale) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount / 100);
}

export function StaffPaymentsClient({
  labels,
  locale,
}: {
  labels: Dictionary["paymentsAdmin"];
  locale: Locale;
}) {
  const [history, setHistory] = useState<StaffPaymentHistory | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";

  const loadPayments = useCallback(
    async (date?: string) => {
      setLoading(true);
      setError(false);
      try {
        const query = date ? "?date=" + encodeURIComponent(date) : "";
        const response = await fetch(apiUrl + "/v1/staff/payments" + query, {
          cache: "no-store",
          credentials: "include",
        });
        if (response.status === 401) {
          window.location.assign("/" + locale + "/staff/login");
          return;
        }
        if (!response.ok) throw new Error("Payment history request failed");
        const result = (await response.json()) as StaffPaymentHistory;
        setHistory(result);
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
    void loadPayments();
  }, [loadPayments]);

  function selectDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    if (selectedDate) void loadPayments(selectedDate);
  }

  async function voidPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!voidingId || reason.trim().length < 3) return;
    setLoading(true);
    setFeedback(null);
    try {
      const response = await fetch(
        apiUrl +
          "/v1/staff/payments/" +
          encodeURIComponent(voidingId) +
          "/void",
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
      if (response.status === 401) {
        window.location.assign("/" + locale + "/staff/login");
        return;
      }
      if (!response.ok) {
        const failure = (await response.json()) as { code?: string };
        setFeedback(
          failure.code === "ACTIVE_SHIFT_REQUIRED"
            ? labels.shiftRequired
            : labels.voidError,
        );
        return;
      }
      setVoidingId(null);
      setReason("");
      setFeedback(labels.voidSuccess);
      await loadPayments(selectedDate);
    } catch {
      setFeedback(labels.voidError);
    } finally {
      setLoading(false);
    }
  }

  const methodLabel = (
    method: "CASH" | "CARD_AT_TABLE" | "CARD_AT_COUNTER" | "OTHER",
  ) =>
    method === "CASH"
      ? labels.cash
      : method === "CARD_AT_TABLE" || method === "CARD_AT_COUNTER"
        ? labels.card
        : labels.other;

  return (
    <main className="setup-page payments-page">
      <header className="menu-admin-header shell">
        <a className="brand" href={"/" + locale + "/staff/payments"}>
          <span className="brand-mark">FG</span>
          <span>FlowGastronomie</span>
        </a>
        <nav className="menu-admin-nav" aria-label="Staff workspace">
          <a href={"/" + locale + "/staff/radar"}>{labels.radar}</a>
        </nav>
      </header>

      <section className="reports-intro shell">
        <div>
          <p className="eyebrow">FlowGastronomie OS</p>
          <h1>{labels.title}</h1>
          <p>{labels.subtitle}</p>
        </div>
        <form className="report-date-control" onSubmit={selectDate}>
          <label htmlFor="payment-date">{labels.date}</label>
          <div>
            <input
              id="payment-date"
              max="9999-12-31"
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

      <div className="payments-content shell" aria-busy={loading}>
        {loading && !history && (
          <p className="report-message">{labels.loading}</p>
        )}
        {error && <p className="report-message error">{labels.error}</p>}
        {feedback && (
          <p className="payment-feedback" role="status">
            {feedback}
          </p>
        )}
        {history && (
          <>
            <div className="report-scope-strip">
              <strong>
                {history.scope === "VENUE"
                  ? labels.venueScope
                  : labels.selfScope}
              </strong>
              <span>{history.date + " · " + history.timezone}</span>
            </div>
            {history.payments.length === 0 ? (
              <p className="report-message">{labels.noPayments}</p>
            ) : (
              <section className="payment-history-list">
                {history.payments.map((payment) => (
                  <article
                    className={"payment-history-card status-" + payment.status}
                    key={payment.id}
                  >
                    <div className="payment-history-main">
                      <span className="payment-table">
                        {labels.table} {payment.tableLabel}
                      </span>
                      <div>
                        <strong>
                          {formatMoney(
                            payment.amountMinor,
                            payment.currency,
                            locale,
                          )}
                        </strong>
                        <span>{methodLabel(payment.method)}</span>
                      </div>
                    </div>
                    <dl>
                      <div>
                        <dt>{labels.recordedAt}</dt>
                        <dd>
                          {new Intl.DateTimeFormat(locale, {
                            dateStyle: "medium",
                            timeStyle: "short",
                            timeZone: history.timezone,
                          }).format(new Date(payment.recordedAt))}
                        </dd>
                      </div>
                      <div>
                        <dt>{labels.recordedBy}</dt>
                        <dd>{payment.recordedBy.displayName}</dd>
                      </div>
                    </dl>
                    <div className="payment-history-status">
                      <strong>
                        {payment.status === "RECORDED"
                          ? labels.recorded
                          : labels.voided}
                      </strong>
                      {payment.status === "VOIDED" && (
                        <small>
                          {labels.voidedBy}:{" "}
                          {payment.voidedBy?.displayName ?? "—"} ·{" "}
                          {payment.voidReason}
                        </small>
                      )}
                    </div>
                    {payment.canVoid && voidingId !== payment.id && (
                      <button
                        className="payment-void-trigger"
                        disabled={loading}
                        onClick={() => {
                          setVoidingId(payment.id);
                          setReason("");
                          setFeedback(null);
                        }}
                        type="button"
                      >
                        {labels.voidAction}
                      </button>
                    )}
                    {payment.canVoid && voidingId === payment.id && (
                      <form
                        className="payment-void-form"
                        onSubmit={voidPayment}
                      >
                        <label htmlFor={"void-reason-" + payment.id}>
                          {labels.reason}
                        </label>
                        <textarea
                          autoFocus
                          id={"void-reason-" + payment.id}
                          maxLength={300}
                          minLength={3}
                          onChange={(event) => setReason(event.target.value)}
                          placeholder={labels.reasonPlaceholder}
                          required
                          value={reason}
                        />
                        <div>
                          <button disabled={loading} type="submit">
                            {labels.confirmVoid}
                          </button>
                          <button
                            className="secondary-action"
                            disabled={loading}
                            onClick={() => {
                              setVoidingId(null);
                              setReason("");
                            }}
                            type="button"
                          >
                            {labels.cancel}
                          </button>
                        </div>
                      </form>
                    )}
                  </article>
                ))}
              </section>
            )}
            <p className="report-boundary-note">{labels.boundary}</p>
          </>
        )}
      </div>
    </main>
  );
}
