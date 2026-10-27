"use client";

import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../lib/i18n";

type Customer = {
  id: string;
  displayName: string;
  emailNormalized: string | null;
  phoneNormalized: string | null;
  preferredLocale: string;
  createdAt: string;
  _count: { reservations: number; onlineOrders: number };
};
type Timeline = Customer & {
  reservations: Array<{
    id: string;
    status: string;
    requestedFor: string;
    partySize: number;
  }>;
  onlineOrders: Array<{
    id: string;
    referenceCode: string;
    fulfillmentType: string;
    status: string;
    totalMinor: number;
    currency: string;
    requestedFor: string;
  }>;
};

export function CustomersClient({ locale }: { locale: Locale }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Timeline | null>(null);
  const [error, setError] = useState("");
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const request = useCallback(
    async (path: string) => {
      const response = await fetch(`${apiUrl}${path}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (response.status === 401)
        window.location.assign(`/${locale}/staff/login`);
      if (!response.ok) throw new Error("CUSTOMER_TIMELINE_UNAVAILABLE");
      return response.json();
    },
    [apiUrl, locale],
  );
  const load = useCallback(async () => {
    try {
      setCustomers(await request("/v1/staff/customers"));
    } catch {
      setError(
        "Customer timeline is unavailable for this subscription or account.",
      );
    }
  }, [request]);
  useEffect(() => void load(), [load]);
  async function select(id: string) {
    try {
      setSelected(await request(`/v1/staff/customers/${id}`));
    } catch {
      setError("Customer record could not be loaded.");
    }
  }
  return (
    <main className="setup-page">
      <section className="reports-intro shell">
        <div>
          <p className="eyebrow">Customer timeline</p>
          <h1>Purpose-limited customer records</h1>
          <p>
            Review contact-bearing reservation and online-order history without
            creating guest accounts.
          </p>
        </div>
      </section>
      {error && <p className="shell staff-board-feedback">{error}</p>}
      <section className="shell report-detail-grid">
        <article className="report-panel">
          <h2>Customers</h2>
          <div className="report-product-list">
            {customers.map((customer) => (
              <button
                key={customer.id}
                onClick={() => void select(customer.id)}
                type="button"
              >
                <strong>{customer.displayName}</strong>
                <span>
                  {customer._count.reservations} reservations ·{" "}
                  {customer._count.onlineOrders} orders
                </span>
              </button>
            ))}
          </div>
        </article>
        <article className="report-panel">
          <h2>Timeline</h2>
          {selected ? (
            <div className="report-product-list">
              <p>
                {selected.emailNormalized ??
                  selected.phoneNormalized ??
                  "No retained contact"}
              </p>
              {selected.reservations.map((item) => (
                <article key={item.id}>
                  <strong>Reservation · {item.status}</strong>
                  <span>
                    {new Date(item.requestedFor).toLocaleString(locale)} ·{" "}
                    {item.partySize} guests
                  </span>
                </article>
              ))}
              {selected.onlineOrders.map((item) => (
                <article key={item.id}>
                  <strong>
                    {item.referenceCode} · {item.status}
                  </strong>
                  <span>
                    {item.fulfillmentType} ·{" "}
                    {new Intl.NumberFormat(locale, {
                      style: "currency",
                      currency: item.currency,
                    }).format(item.totalMinor / 100)}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p>Select a customer to view the permitted source timeline.</p>
          )}
        </article>
      </section>
    </main>
  );
}
