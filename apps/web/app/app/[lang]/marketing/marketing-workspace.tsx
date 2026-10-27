"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { hasStaffPermission } from "@flowgastronomie/domain";
import type { Locale } from "../../../../lib/i18n";
import {
  marketingSections,
  marketingText,
  marketingStarterText,
  type MarketingSection,
} from "../../../../lib/marketing-copy";
import { usePilotStaff } from "../../../pilot-app-shell";
import { PilotIcon } from "../../../[lang]/staff/pilot-icon";
import { PilotDialog } from "../../../[lang]/staff/pilot-dialog";
import "./marketing.css";
import {
  marketingStarterCatalog,
  type PromotionStarter,
  type GiftCardStarter,
  type CreativeStarter,
} from "../../../../lib/marketing-starter-templates";

type MarketingDialog =
  | { kind: "promotion" }
  | { kind: "gift"; starter?: GiftCardStarter }
  | { kind: "starter-promotion"; starter: PromotionStarter };
const sectionIcons = [
  "campaign",
  "campaign",
  "gift",
  "creative",
  "report",
] as const;

export function MarketingWorkspace({
  locale,
  section,
}: {
  locale: Locale;
  section: MarketingSection;
}) {
  const staff = usePilotStaff();
  const text = marketingText(locale);
  const starters = marketingStarterText(locale);
  const [dialog, setDialog] = useState<MarketingDialog | null>(null);
  const base = `/app/${locale}/marketing`;
  const href = (key: MarketingSection) =>
    key === "overview" ? base : `${base}/${key}`;
  const activeIndex = marketingSections.indexOf(section);
  if (!staff || !hasStaffPermission(staff.role, "CREATIVE_VIEW"))
    return (
      <main className="marketing-workspace">
        <p role="status">{text.denied}</p>
      </main>
    );
  const action =
    section === "promotions"
      ? text.newPromotion
      : section === "gift-cards"
        ? text.newGift
        : null;
  return (
    <main className="marketing-workspace">
      <nav className="marketing-nav" aria-label="Marketing">
        {marketingSections.map((key, index) => (
          <Link
            key={key}
            href={href(key)}
            aria-current={key === section ? "page" : undefined}
          >
            {text.sections[index]}
          </Link>
        ))}
      </nav>
      <header className="marketing-heading">
        <div>
          <span className="marketing-eyebrow">{text.foundation}</span>
          <h2>
            {section === "overview" ? text.intro : text.sections[activeIndex]}
          </h2>
          <p>
            {section === "overview"
              ? text.subtitle
              : section === "promotions"
                ? text.promotionHelp
                : section === "gift-cards"
                  ? text.giftHelp
                  : section === "creative-studio"
                    ? starters.note
                    : text.analyticsHelp}
          </p>
        </div>
        {action && (
          <button
            className="marketing-primary"
            onClick={() =>
              setDialog({
                kind: section === "promotions" ? "promotion" : "gift",
              })
            }
          >
            <PilotIcon name="plus" />
            {action}
          </button>
        )}
      </header>
      <Link className="marketing-primary" href={`${base}/creative`}>
        {
          {
            en: "Open Creative Studio",
            de: "Creative Studio öffnen",
            it: "Apri Creative Studio",
            sq: "Hap Creative Studio",
          }[locale]
        }
      </Link>
      <p className="marketing-notice">
        <PilotIcon name="info" />
        {text.notice}
      </p>
      {section === "overview" && (
        <>
          <div className="marketing-actions">
            <button
              className="marketing-primary"
              onClick={() => setDialog({ kind: "promotion" })}
            >
              <PilotIcon name="plus" />
              {text.newPromotion}
            </button>
            <button onClick={() => setDialog({ kind: "gift" })}>
              <PilotIcon name="plus" />
              {text.newGift}
            </button>
            <Link href={href("creative-studio")}>
              <PilotIcon name="creative" />
              {text.create}
            </Link>
          </div>
          <div className="marketing-overview-grid">
            {(
              [
                [
                  "promotions",
                  text.sections[1]!,
                  `${marketingStarterCatalog.promotions.length} ${starters.drafts}`,
                  starters.summaryHelp,
                ],
                [
                  "gift-cards",
                  text.sections[2]!,
                  `${marketingStarterCatalog.giftCards.length} ${starters.templates}`,
                  starters.summaryHelp,
                ],
                [
                  "creative-studio",
                  text.sections[3]!,
                  `${marketingStarterCatalog.creative.length} ${starters.templates}`,
                  starters.summaryHelp,
                ],
              ] as const
            ).map(([key, title, empty, help]) => (
              <MarketingCard
                key={key}
                icon={sectionIcons[marketingSections.indexOf(key)]!}
                title={title}
              >
                <h4>{empty}</h4>
                <p>{help}</p>
                <Link className="marketing-card-link" href={href(key)}>
                  {text.open} <span aria-hidden="true">→</span>
                </Link>
              </MarketingCard>
            ))}
          </div>
          <div className="marketing-detail-grid">
            <MarketingCard icon="pending" title={text.activity}>
              <p>{text.noActivity}</p>
            </MarketingCard>
            <MarketingCard icon="report" title={text.sections[4]!}>
              <p>{starters.noData}</p>
              <Link className="marketing-card-link" href={href("analytics")}>
                {text.open} <span aria-hidden="true">→</span>
              </Link>
            </MarketingCard>
          </div>
        </>
      )}
      {section === "promotions" && (
        <section className="marketing-drafts" aria-label={text.sections[1]}>
          {marketingStarterCatalog.promotions.map((starter) => (
            <article
              className="marketing-draft-row"
              key={starter.key}
              data-promotion-starter={starter.key}
            >
              <div>
                <div className="marketing-draft-title">
                  <h3>{starter.name}</h3>
                  <span className="marketing-badge">{starters.draft}</span>
                </div>
                <p className="marketing-draft-type">
                  {text.types[starter.typeIndex]}
                </p>
                <p>{starter.plannedRule[locale]}</p>
                {starter.needsSelection && (
                  <small>{starters.confirmation}</small>
                )}
                {starter.typeIndex === 8 && (
                  <span className="marketing-nonoperational">
                    {starters.notOperational}
                  </span>
                )}
              </div>
              <div className="marketing-draft-actions">
                <small>{starters.channels}</small>
                <span>{plannedChannels(starter, locale)}</span>
                <button
                  aria-label={`${starters.preview}: ${starter.name}`}
                  onClick={() =>
                    setDialog({ kind: "starter-promotion", starter })
                  }
                >
                  {starters.preview}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
      {section === "gift-cards" && (
        <section className="marketing-gift-grid" aria-label={text.sections[2]}>
          {marketingStarterCatalog.giftCards.map((starter) => (
            <article
              className="marketing-card marketing-gift-template"
              key={starter.key}
              data-gift-starter={starter.key}
            >
              <span className="marketing-badge">
                {starters.template} · {starters.notIssued}
              </span>
              <h3>{starter.name[locale]}</h3>
              <strong className="marketing-gift-value">
                {starter.value[locale]}
              </strong>
              <p>{starters.futureCode}</p>
              <p>{starters.futureBalance}</p>
              <button
                aria-label={`${starters.preview}: ${starter.name[locale]}`}
                onClick={() => setDialog({ kind: "gift", starter })}
              >
                {starters.preview}
              </button>
            </article>
          ))}
        </section>
      )}
      {section === "creative-studio" && (
        <CreativeStudio locale={locale} venueName={staff.venueName} />
      )}
      {section === "analytics" && (
        <div className="marketing-metrics">
          {text.metrics.map((metric) => (
            <MarketingCard key={metric} icon="report" title={metric}>
              <p>{starters.noData}</p>
            </MarketingCard>
          ))}
        </div>
      )}
      {dialog?.kind === "promotion" && (
        <PromotionPreview locale={locale} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "starter-promotion" && (
        <PilotDialog
          className="marketing-dialog"
          title={dialog.starter.name}
          closeLabel={text.close}
          onClose={() => setDialog(null)}
          dismissOnBackdrop
        >
          <p className="marketing-notice">{text.prototype}</p>
          <span className="marketing-badge">
            {starters.draft} · {starters.notOperational}
          </span>
          <dl className="marketing-starter-details">
            <dt>{text.type}</dt>
            <dd>{text.types[dialog.starter.typeIndex]}</dd>
            <dt>{starters.rule}</dt>
            <dd>{dialog.starter.plannedRule[locale]}</dd>
            <dt>{starters.channels}</dt>
            <dd>{plannedChannels(dialog.starter, locale)}</dd>
          </dl>
          {dialog.starter.needsSelection && <p>{starters.confirmation}</p>}
          <button className="marketing-primary" onClick={() => setDialog(null)}>
            {text.close}
          </button>
        </PilotDialog>
      )}
      {dialog?.kind === "gift" && (
        <PilotDialog
          className="marketing-dialog"
          title={dialog.starter?.name[locale] ?? text.newGift}
          closeLabel={text.close}
          onClose={() => setDialog(null)}
          dismissOnBackdrop
        >
          <p className="marketing-notice">{text.prototype}</p>
          <span className="marketing-badge">
            {starters.template} · {starters.notIssued}
          </span>
          {dialog.starter && (
            <>
              <h3>{dialog.starter.value[locale]}</h3>
              <p>{starters.futureCode}</p>
              <p>{starters.futureBalance}</p>
            </>
          )}
          <h3>{text.giftNext}</h3>
          <div className="marketing-field-list">
            {text.giftFields.map((field) => (
              <span key={field}>{field}</span>
            ))}
          </div>
          <p>{text.giftHelp}</p>
          <p>{text.giftBoundary}</p>
          <button className="marketing-primary" onClick={() => setDialog(null)}>
            {text.close}
          </button>
        </PilotDialog>
      )}
    </main>
  );
}

function plannedChannels(starter: PromotionStarter, locale: Locale) {
  const text = marketingStarterText(locale);
  return starter.channels.length
    ? starter.channels
        .map((channel) => (channel === "POS" ? "POS" : text.online))
        .join(" + ")
    : text.confirmation;
}

function MarketingCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: Parameters<typeof PilotIcon>[0]["name"];
  children: ReactNode;
}) {
  return (
    <section className="marketing-card">
      <span className="marketing-card-icon">
        <PilotIcon name={icon} />
      </span>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
function PromotionPreview({
  locale,
  onClose,
}: {
  locale: Locale;
  onClose: () => void;
}) {
  const text = marketingText(locale);
  const [review, setReview] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("0");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [pos, setPos] = useState(false);
  const [online, setOnline] = useState(false);
  return (
    <PilotDialog
      className="marketing-dialog"
      title={text.newPromotion}
      closeLabel={text.close}
      onClose={onClose}
      dismissOnBackdrop
    >
      <p className="marketing-notice">{text.prototype}</p>
      {!review ? (
        <form
          className="marketing-form"
          onSubmit={(event) => {
            event.preventDefault();
            setReview(true);
          }}
        >
          <label>
            {text.campaignName}
            <input
              value={name}
              maxLength={120}
              placeholder={text.nameHint}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            {text.type}
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              {text.types.map((label, index) => (
                <option value={index} key={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <details>
            <summary>{text.advanced}</summary>
            <p>{text.channelsHelp}</p>
            <div className="marketing-date-fields">
              <label>
                {text.starts}
                <input
                  type="date"
                  value={starts}
                  onChange={(event) => setStarts(event.target.value)}
                />
              </label>
              <label>
                {text.ends}
                <input
                  type="date"
                  value={ends}
                  min={starts || undefined}
                  onChange={(event) => setEnds(event.target.value)}
                />
              </label>
            </div>
            <label className="marketing-check">
              <input
                type="checkbox"
                checked={pos}
                onChange={(event) => setPos(event.target.checked)}
              />
              {text.pos}
            </label>
            <label className="marketing-check">
              <input
                type="checkbox"
                checked={online}
                onChange={(event) => setOnline(event.target.checked)}
              />
              {text.online}
            </label>
          </details>
          <button className="marketing-primary" type="submit">
            {text.next}
          </button>
        </form>
      ) : (
        <div className="marketing-review">
          <h3 tabIndex={-1} ref={(node) => node?.focus()}>
            {text.review}
          </h3>
          <dl>
            <dt>{text.campaignName}</dt>
            <dd>{name.trim() || text.noName}</dd>
            <dt>{text.type}</dt>
            <dd>{text.types[Number(type)]}</dd>
            <dt>{text.dates}</dt>
            <dd>
              {starts || ends
                ? `${starts || "—"} → ${ends || "—"}`
                : text.noDates}
            </dd>
            <dt>{text.status}</dt>
            <dd>{text.unavailable}</dd>
          </dl>
          <p>{text.channelsHelp}</p>
          <p>{text.activation}</p>
          <div className="marketing-actions">
            <button onClick={() => setReview(false)}>{text.back}</button>
            <button className="marketing-primary" onClick={onClose}>
              {text.close}
            </button>
          </div>
        </div>
      )}
    </PilotDialog>
  );
}

function CreativeStudio({
  locale,
  venueName,
}: {
  locale: Locale;
  venueName: string;
}) {
  const text = marketingText(locale);
  const words = marketingStarterText(locale);
  const [selected, setSelected] = useState<CreativeStarter>(
    marketingStarterCatalog.creative[0]!,
  );
  const promotion =
    selected.source.kind === "promotion"
      ? marketingStarterCatalog.promotions.find(
          (starter) => starter.key === selected.source.templateKey,
        )
      : undefined;
  const gift =
    selected.source.kind === "gift-card"
      ? marketingStarterCatalog.giftCards.find(
          (starter) => starter.key === selected.source.templateKey,
        )
      : undefined;
  const headline = promotion?.name ?? gift?.name[locale] ?? text.sampleHeadline;
  const rule =
    promotion?.plannedRule[locale] ?? gift?.value[locale] ?? text.sampleBody;
  return (
    <div className="marketing-studio">
      <ol className="marketing-steps">
        {text.workflow.map((step, index) => (
          <li key={step}>
            <span>{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      <div className="marketing-studio-grid">
        <section className="marketing-card">
          <p className="marketing-eyebrow">{words.source}</p>
          <p>{words.summaryHelp}</p>
          <div className="marketing-formats marketing-starter-formats">
            {marketingStarterCatalog.creative.map((starter) => (
              <button
                key={starter.key}
                type="button"
                data-creative-starter={starter.key}
                aria-pressed={selected.key === starter.key}
                onClick={() => setSelected(starter)}
              >
                <span
                  className="marketing-format-paper"
                  style={{ aspectRatio: starter.ratio }}
                  aria-hidden="true"
                />
                <strong>{starter.name[locale]}</strong>
                <small>
                  {words.template} · {words.preview}
                </small>
              </button>
            ))}
          </div>
        </section>
        <section
          className="marketing-card marketing-preview"
          aria-label={text.workflow[2]}
        >
          <h3>{text.workflow[2]}</h3>
          <p className="marketing-eyebrow" role="status">
            {text.template} · {selected.name[locale]}
          </p>
          <div
            className={`marketing-template ${selected.treatment === "thermal" ? "is-thermal" : ""} ${selected.treatment === "gift" ? "is-gift" : ""}`}
            style={{ aspectRatio: selected.ratio }}
          >
            <span>{venueName}</span>
            <PilotIcon name={gift ? "gift" : "creative"} />
            <h4>{headline}</h4>
            <p>{rule}</p>
            {selected.treatment === "qr-placeholder" && (
              <span className="marketing-qr-placeholder">
                {words.futureCode}
              </span>
            )}
            <small>
              {gift
                ? `${words.template} · ${words.notIssued}`
                : `${words.draft} · ${words.notOperational}`}
            </small>
          </div>
          {promotion?.needsSelection && <p>{words.confirmation}</p>}
          <p className="marketing-preview-note">{words.note}</p>
        </section>
      </div>
    </div>
  );
}
