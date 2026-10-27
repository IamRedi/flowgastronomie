"use client";

import {
  SERVICE_MODES,
  type ServiceMode,
  type StaffRole,
} from "@flowgastronomie/domain";
import { useCallback, useEffect, useState } from "react";

import type { Dictionary } from "../../../../lib/dictionaries";
import type { Locale } from "../../../../lib/i18n";

type Area = {
  id: string;
  name: string;
  serviceModeOverride: ServiceMode | null;
  tableCount: number;
};

type Table = {
  id: string;
  label: string;
  areaId: string | null;
  areaName: string | null;
  serviceModeOverride: ServiceMode | null;
  effectiveServiceMode: ServiceMode;
  qrConfigured: boolean;
  qrRevoked: boolean;
};

type Setup = {
  venue: {
    id: string;
    name: string;
    timezone: string;
    currency: string;
    defaultServiceMode: ServiceMode;
  };
  areas: Area[];
  tables: Table[];
};

type Staff = { role: StaffRole };

export function StaffSetupClient({
  labels,
  locale,
  modeLabels,
}: {
  labels: Dictionary["setupAdmin"];
  locale: Locale;
  modeLabels: Dictionary["menuPage"]["modes"];
}) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<"success" | "error" | null>(null);
  const [editingArea, setEditingArea] = useState<string | null>(null);
  const [editingTable, setEditingTable] = useState<string | null>(null);
  const [guestLink, setGuestLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";

  const goToLogin = useCallback(() => {
    window.location.assign(`/${locale}/staff/login`);
  }, [locale]);

  const load = useCallback(async () => {
    const [identityResponse, setupResponse] = await Promise.all([
      fetch(`${apiUrl}/v1/staff/me`, { credentials: "include" }),
      fetch(`${apiUrl}/v1/staff/setup`, {
        cache: "no-store",
        credentials: "include",
      }),
    ]);
    if (identityResponse.status === 401 || setupResponse.status === 401) {
      goToLogin();
      return;
    }
    if (identityResponse.ok) {
      const identity = (await identityResponse.json()) as { staff: Staff };
      setStaff(identity.staff);
    }
    if (setupResponse.ok) setSetup((await setupResponse.json()) as Setup);
    setLoading(false);
  }, [apiUrl, goToLogin]);

  useEffect(() => void load(), [load]);

  async function write(path: string, method: "POST" | "PUT", body?: unknown) {
    setBusy(true);
    setFeedback(null);
    setGuestLink(null);
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      credentials: "include",
      ...(body
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    if (response.status === 401) {
      goToLogin();
      return null;
    }
    if (!response.ok) {
      setBusy(false);
      setFeedback("error");
      return null;
    }
    const result = (await response.json()) as { qrToken?: string };
    if (result.qrToken) {
      setGuestLink(
        `${window.location.origin}/${locale}/menu/${encodeURIComponent(result.qrToken)}`,
      );
    }
    await load();
    setBusy(false);
    setFeedback("success");
    return result;
  }

  async function saveVenue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await write("/v1/staff/setup/venue", "PUT", {
      defaultServiceMode: data.get("defaultServiceMode"),
    });
  }

  async function saveArea(
    event: React.FormEvent<HTMLFormElement>,
    area?: Area,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const saved = await write(
      area
        ? `/v1/staff/setup/areas/${encodeURIComponent(area.id)}`
        : "/v1/staff/setup/areas",
      area ? "PUT" : "POST",
      {
        name: String(data.get("name") ?? "").trim(),
        serviceModeOverride: data.get("serviceModeOverride") || null,
      },
    );
    if (saved) setEditingArea(null);
  }

  async function saveTable(
    event: React.FormEvent<HTMLFormElement>,
    table?: Table,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const saved = await write(
      table
        ? `/v1/staff/setup/tables/${encodeURIComponent(table.id)}`
        : "/v1/staff/setup/tables",
      table ? "PUT" : "POST",
      {
        label: String(data.get("label") ?? "").trim(),
        areaId: data.get("areaId") || null,
        serviceModeOverride: data.get("serviceModeOverride") || null,
      },
    );
    if (saved) setEditingTable(null);
  }

  async function copyGuestLink() {
    if (!guestLink) return;
    await navigator.clipboard.writeText(guestLink);
    setCopied(true);
  }

  if (loading) {
    return <main className="setup-page setup-message">{labels.loading}</main>;
  }
  if (!setup || !staff || !["OWNER", "MANAGER"].includes(staff.role)) {
    return (
      <main className="setup-page setup-message">{labels.permissions}</main>
    );
  }

  const hasArea = setup.areas.length > 0;
  const hasSecureTable = setup.tables.some(
    (table) => table.qrConfigured && !table.qrRevoked,
  );
  const completedSteps = 2 + Number(hasArea) + Number(hasSecureTable);

  return (
    <main className="setup-page">
      <header className="menu-admin-header shell">
        <a className="brand" href={`/${locale}/staff/setup`}>
          <span className="brand-mark">FG</span>
          <span>FlowGastronomie</span>
        </a>
        <nav className="menu-admin-nav" aria-label="Staff workspace">
          <a href={`/${locale}/staff/radar`}>{labels.radar}</a>

          <a href={`/${locale}/staff/team`}>{labels.team}</a>
        </nav>
      </header>

      <section className="menu-admin-intro shell">
        <div>
          <p className="eyebrow">{setup.venue.name}</p>
          <h1>{labels.title}</h1>
          <p>{labels.subtitle}</p>
        </div>
      </section>

      <div className="setup-content shell">
        <section
          className="setup-checklist"
          aria-labelledby="setup-checklist-title"
        >
          <div>
            <p className="eyebrow">{labels.checklistTitle}</p>
            <h2 id="setup-checklist-title">
              {completedSteps}/4 {labels.checklistProgress}
            </h2>
          </div>
          <ol>
            <ChecklistItem
              complete
              label={labels.checkAccount}
              status={labels.done}
            />
            <ChecklistItem
              complete
              label={labels.checkVenue}
              status={labels.done}
            />
            <ChecklistItem
              complete={hasArea}
              href="#setup-areas"
              label={labels.checkArea}
              status={hasArea ? labels.done : labels.next}
            />
            <ChecklistItem
              complete={hasSecureTable}
              href="#setup-tables"
              label={labels.checkTable}
              status={hasSecureTable ? labels.done : labels.next}
            />
          </ol>
        </section>
        {feedback && (
          <p className={`menu-admin-feedback ${feedback}`} role="status">
            {labels[feedback]}
          </p>
        )}
        {guestLink && (
          <aside className="qr-result" role="status">
            <strong>{labels.qrReady}</strong>
            <code>{guestLink}</code>
            <p>{labels.qrWarning}</p>
            <button onClick={copyGuestLink} type="button">
              {copied ? labels.copied : labels.copy}
            </button>
          </aside>
        )}

        <form className="venue-default-card" onSubmit={saveVenue}>
          <label>
            {labels.venueDefault}
            <ModeSelect
              modeLabels={modeLabels}
              name="defaultServiceMode"
              value={setup.venue.defaultServiceMode}
            />
          </label>
          <button
            className="button button-primary"
            disabled={busy}
            type="submit"
          >
            {busy ? labels.saving : labels.saveDefault}
          </button>
        </form>

        <section className="setup-section" id="setup-areas">
          <div className="setup-section-heading">
            <h2>{labels.areas}</h2>
            <button
              className="button button-primary"
              onClick={() => setEditingArea("new")}
              type="button"
            >
              + {labels.addArea}
            </button>
          </div>
          {editingArea === "new" && (
            <AreaForm
              busy={busy}
              labels={labels}
              modeLabels={modeLabels}
              onCancel={() => setEditingArea(null)}
              onSubmit={saveArea}
            />
          )}
          <div className="area-card-grid">
            {setup.areas.map((area) => (
              <article className="area-card" key={area.id}>
                <div>
                  <h3>{area.name}</h3>
                  <p>
                    {area.tableCount} {labels.tableCount} ·{" "}
                    {area.serviceModeOverride
                      ? modeLabels[area.serviceModeOverride]
                      : labels.inherit}
                  </p>
                </div>
                <button
                  onClick={() =>
                    setEditingArea(editingArea === area.id ? null : area.id)
                  }
                  type="button"
                >
                  {labels.edit}
                </button>
                {editingArea === area.id && (
                  <AreaForm
                    area={area}
                    busy={busy}
                    labels={labels}
                    modeLabels={modeLabels}
                    onCancel={() => setEditingArea(null)}
                    onSubmit={(event) => saveArea(event, area)}
                  />
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="setup-section" id="setup-tables">
          <div className="setup-section-heading">
            <h2>{labels.tables}</h2>
            <button
              className="button button-primary"
              onClick={() => setEditingTable("new")}
              type="button"
            >
              + {labels.addTable}
            </button>
          </div>
          {editingTable === "new" && (
            <TableForm
              areas={setup.areas}
              busy={busy}
              labels={labels}
              modeLabels={modeLabels}
              onCancel={() => setEditingTable(null)}
              onSubmit={saveTable}
            />
          )}
          <div className="table-setup-grid">
            {setup.tables.map((table) => (
              <article className="table-setup-card" key={table.id}>
                <div className="table-setup-number">{table.label}</div>
                <div>
                  <h3>{table.areaName ?? labels.noArea}</h3>
                  <p>
                    {labels.effectiveMode}:{" "}
                    {modeLabels[table.effectiveServiceMode]}
                  </p>
                </div>
                <div className="table-setup-actions">
                  <button
                    onClick={() =>
                      setEditingTable(
                        editingTable === table.id ? null : table.id,
                      )
                    }
                    type="button"
                  >
                    {labels.edit}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      write(
                        `/v1/staff/setup/tables/${encodeURIComponent(table.id)}/rotate-qr`,
                        "POST",
                      )
                    }
                    type="button"
                  >
                    {labels.rotateQr}
                  </button>
                </div>
                {editingTable === table.id && (
                  <TableForm
                    areas={setup.areas}
                    busy={busy}
                    labels={labels}
                    modeLabels={modeLabels}
                    onCancel={() => setEditingTable(null)}
                    onSubmit={(event) => saveTable(event, table)}
                    table={table}
                  />
                )}
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function ChecklistItem({
  complete,
  href,
  label,
  status,
}: {
  complete: boolean;
  href?: string;
  label: string;
  status: string;
}) {
  const content = (
    <>
      <span aria-hidden="true">{complete ? "✓" : "→"}</span>
      <strong>{label}</strong>
      <small>{status}</small>
    </>
  );
  return (
    <li className={complete ? "complete" : "pending"}>
      {href && !complete ? <a href={href}>{content}</a> : <div>{content}</div>}
    </li>
  );
}

function ModeSelect({
  allowInherit,
  modeLabels,
  name,
  value,
}: {
  allowInherit?: string;
  modeLabels: Dictionary["menuPage"]["modes"];
  name: string;
  value: ServiceMode | null;
}) {
  return (
    <select defaultValue={value ?? ""} name={name}>
      {allowInherit && <option value="">{allowInherit}</option>}
      {SERVICE_MODES.map((mode) => (
        <option key={mode} value={mode}>
          {modeLabels[mode]}
        </option>
      ))}
    </select>
  );
}

function SetupFormActions({
  busy,
  labels,
  onCancel,
}: {
  busy: boolean;
  labels: Dictionary["setupAdmin"];
  onCancel: () => void;
}) {
  return (
    <div className="menu-form-actions">
      <button onClick={onCancel} type="button">
        {labels.cancel}
      </button>
      <button className="button button-primary" disabled={busy} type="submit">
        {busy ? labels.saving : labels.save}
      </button>
    </div>
  );
}

function AreaForm({
  area,
  busy,
  labels,
  modeLabels,
  onCancel,
  onSubmit,
}: {
  area?: Area;
  busy: boolean;
  labels: Dictionary["setupAdmin"];
  modeLabels: Dictionary["menuPage"]["modes"];
  onCancel: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="setup-inline-form" onSubmit={onSubmit}>
      <label>
        {labels.name}
        <input defaultValue={area?.name} maxLength={80} name="name" required />
      </label>
      <label>
        {labels.override}
        <ModeSelect
          allowInherit={labels.inherit}
          modeLabels={modeLabels}
          name="serviceModeOverride"
          value={area?.serviceModeOverride ?? null}
        />
      </label>
      <SetupFormActions busy={busy} labels={labels} onCancel={onCancel} />
    </form>
  );
}

function TableForm({
  areas,
  busy,
  labels,
  modeLabels,
  onCancel,
  onSubmit,
  table,
}: {
  areas: Area[];
  busy: boolean;
  labels: Dictionary["setupAdmin"];
  modeLabels: Dictionary["menuPage"]["modes"];
  onCancel: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  table?: Table;
}) {
  return (
    <form className="setup-inline-form table-form" onSubmit={onSubmit}>
      <label>
        {labels.label}
        <input
          defaultValue={table?.label}
          maxLength={30}
          name="label"
          required
        />
      </label>
      <label>
        {labels.area}
        <select defaultValue={table?.areaId ?? ""} name="areaId">
          <option value="">{labels.noArea}</option>
          {areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {labels.override}
        <ModeSelect
          allowInherit={labels.inherit}
          modeLabels={modeLabels}
          name="serviceModeOverride"
          value={table?.serviceModeOverride ?? null}
        />
      </label>
      <SetupFormActions busy={busy} labels={labels} onCancel={onCancel} />
    </form>
  );
}
