"use client";
import { useState } from "react";
import {
  businessProfileIds,
  WEEKDAYS,
  importAllergenCodes,
  menuDuplicateCandidates,
  type BusinessReview,
  type PlatformLocale,
  type OpeningHoursEntry,
  type BusinessImage,
} from "@flowgastronomie/domain";
import { setupApi } from "../setup-api";
import type { ImportView } from "./import-client";
import type { ImportCopy } from "./import-copy";

export function ImportFields({
  data,
  review,
  onChange,
  words,
  locale,
}: {
  data: ImportView;
  review: BusinessReview;
  onChange: (next: BusinessReview) => void;
  words: ImportCopy;
  locale: PlatformLocale;
}) {
  const update = (
    index: number,
    patch: Partial<BusinessReview["fields"][number]>,
  ) =>
    onChange({
      ...review,
      fields: review.fields.map((field, i) =>
        i === index ? { ...field, ...patch } : field,
      ),
    });
  return (
    <div className="bi-fields">
      {review.fields.map((field, index) => {
        const proposals = data.businessData.fields.filter(
          (f) => f.field === field.field,
        );
        const selected = proposals.find((p) => p.id === field.proposalId);
        const website = data.canonical.website;
        const translation = website?.translations.find(
          (t) => t.locale.toLowerCase() === locale,
        );
        const current =
          field.field === "venueName"
            ? data.canonical.venue.name
            : field.field === "description"
              ? translation?.heroSubtitle
              : field.field === "seoTitle"
                ? translation?.seoTitle
                : field.field === "seoDescription"
                  ? translation?.seoDescription
                  : website && field.field in website
                    ? website[field.field as keyof typeof website]
                    : null;
        return (
          <article
            className="bi-field"
            key={field.field}
            data-field={field.field}
            data-decision={field.decision}
          >
            <div>
              <span className="bi-field-label">
                {words.fields[field.field]}
              </span>
              {field.field === "openingHours" ? (
                <Hours
                  value={field.value}
                  words={words}
                  locale={locale}
                  change={(value) =>
                    update(index, { value, decision: "PENDING" })
                  }
                />
              ) : field.field === "businessType" ? (
                <select
                  aria-label={words.fields[field.field]}
                  value={field.value}
                  onChange={(e) =>
                    update(index, {
                      value: e.target.value,
                      decision: "PENDING",
                    })
                  }
                >
                  <option value="">{words.choose}</option>
                  {businessProfileIds.map((id) => (
                    <option key={id} value={id}>
                      {words.profiles[id]}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={words.fields[field.field]}
                  value={field.value}
                  placeholder={words.missing}
                  maxLength={4000}
                  onChange={(e) =>
                    update(index, {
                      value: e.target.value,
                      decision: "PENDING",
                    })
                  }
                />
              )}
            </div>
            <div className="bi-decisions">
              <button
                type="button"
                aria-pressed={field.decision === "APPROVE"}
                onClick={() => update(index, { decision: "APPROVE" })}
              >
                ✓ {words.accept}
              </button>
              <button
                type="button"
                aria-pressed={field.decision === "REJECT"}
                onClick={() => update(index, { decision: "REJECT" })}
              >
                {words.reject}
              </button>
            </div>
            <details>
              <summary>
                {words.details}
                {proposals.length > 1 ? ` · ${proposals.length}` : ""}
              </summary>
              {current != null && (
                <p>
                  {words.current}:{" "}
                  {typeof current === "string"
                    ? current
                    : JSON.stringify(current)}
                </p>
              )}
              {proposals.length > 1 && (
                <select
                  aria-label={words.details}
                  value={field.proposalId ?? ""}
                  onChange={(e) => {
                    const next = proposals.find((p) => p.id === e.target.value);
                    if (next)
                      update(index, {
                        proposalId: next.id,
                        value: next.value,
                        decision: "PENDING",
                      });
                  }}
                >
                  {proposals.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.value.slice(0, 120)}
                    </option>
                  ))}
                </select>
              )}
              {selected && (
                <>
                  <blockquote>{selected.evidence.excerpt}</blockquote>
                  <p>
                    {selected.evidence.method} · {selected.evidence.status}
                  </p>
                  <code>{selected.evidence.sourceHash}</code>
                  {selected.evidence.sourceUrl && (
                    <a
                      href={selected.evidence.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {new URL(selected.evidence.sourceUrl).hostname} ↗
                    </a>
                  )}
                </>
              )}
            </details>
          </article>
        );
      })}
    </div>
  );
}
function Hours({
  value,
  change,
  words,
  locale,
}: {
  value: string;
  change: (value: string) => void;
  words: ImportCopy;
  locale: PlatformLocale;
}) {
  let rows: OpeningHoursEntry[] = [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) rows = parsed;
  } catch {
    /* Empty source is intentional. */
  }
  const update = (index: number, patch: Partial<OpeningHoursEntry>) =>
    change(
      JSON.stringify(
        rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
      ),
    );
  return (
    <div className="bi-hours">
      {rows.map((row, index) => (
        <div key={row.day} className="bi-hours-row">
          <span>{words.days[WEEKDAYS.indexOf(row.day)]}</span>
          <label className="bi-check">
            <input
              type="checkbox"
              checked={row.closed}
              onChange={(e) =>
                update(index, {
                  closed: e.target.checked,
                  ...(e.target.checked
                    ? { opensAt: "00:00", closesAt: "00:00" }
                    : {}),
                })
              }
            />
            {words.closed}
          </label>
          {!row.closed && (
            <>
              <input
                aria-label={words.opens}
                type="time"
                value={row.opensAt}
                onChange={(e) => update(index, { opensAt: e.target.value })}
              />
              <input
                aria-label={words.closes}
                type="time"
                value={row.closesAt}
                onChange={(e) => update(index, { closesAt: e.target.value })}
              />
            </>
          )}
          <button
            type="button"
            onClick={() =>
              change(JSON.stringify(rows.filter((_, i) => i !== index)))
            }
          >
            {words.remove}
          </button>
        </div>
      ))}
      <select
        aria-label={words.day}
        value=""
        onChange={(e) => {
          if (e.target.value)
            change(
              JSON.stringify([
                ...rows,
                {
                  day: e.target.value,
                  closed: false,
                  opensAt: "",
                  closesAt: "",
                },
              ]),
            );
        }}
      >
        <option value="">+ {words.day}</option>
        {WEEKDAYS.filter((day) => !rows.some((row) => row.day === day)).map(
          (day) => (
            <option key={day} value={day}>
              {words.days[WEEKDAYS.indexOf(day)]}
            </option>
          ),
        )}
      </select>
    </div>
  );
}
const minor = (value: string) =>
  value === "" || !Number.isFinite(Number(value))
    ? null
    : Math.round(Number(value) * 100);
export function ImportProduct({
  row,
  data,
  onChange,
  words,
}: {
  row: BusinessReview["items"][number];
  data: ImportView;
  onChange: (next: BusinessReview["items"][number]) => void;
  words: ImportCopy;
}) {
  const item = row.item;
  const products = data.canonical.products.filter((p) => !p.archivedAt);
  const duplicates = menuDuplicateCandidates(
    item,
    products.map((p) => ({
      id: p.id,
      names: p.translations.map((t) => t.name),
      priceMinor: p.priceMinor,
    })),
  );
  const edit = (patch: Partial<typeof item>) =>
    onChange({
      ...row,
      item: { ...item, ...patch },
      approvePrice: false,
      approveConfiguration: false,
    });
  return (
    <article className="bi-product" data-action={row.action}>
      <div className="bi-product-main">
        <label>
          {words.name}
          <input
            value={item.name}
            maxLength={160}
            onChange={(e) => edit({ name: e.target.value })}
          />
        </label>
        <label>
          {words.price}
          <input
            type="number"
            min="0"
            step="0.01"
            value={item.priceMinor === null ? "" : item.priceMinor / 100}
            onChange={(e) => edit({ priceMinor: minor(e.target.value) })}
          />
        </label>
        <label>
          {data.canonical.venue.currency}
          <input
            aria-label={`${words.price} · currency`}
            value={item.currency}
            maxLength={3}
            onChange={(e) => edit({ currency: e.target.value.toUpperCase() })}
          />
        </label>
      </div>
      <label>
        {words.description}
        <textarea
          value={item.description}
          maxLength={2000}
          onChange={(e) => edit({ description: e.target.value })}
        />
      </label>
      <div className="bi-two">
        <label>
          {words.category}
          <select
            value={item.categoryId ?? ""}
            aria-label={words.category}
            onChange={(e) =>
              edit({
                categoryId: e.target.value || null,
                categoryName:
                  data.canonical.categories.find((c) => c.id === e.target.value)
                    ?.translations[0]?.name ?? item.categoryName,
              })
            }
          >
            <option value="">{words.newCategory}</option>
            {data.canonical.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.translations[0]?.name}
              </option>
            ))}
          </select>
          {!item.categoryId && (
            <input
              aria-label={words.newCategory}
              value={item.categoryName}
              onChange={(e) => edit({ categoryName: e.target.value })}
            />
          )}
        </label>
        <label>
          {words.action}
          <select
            value={row.action}
            aria-label={words.action}
            onChange={(e) =>
              onChange({
                ...row,
                action: e.target.value as typeof row.action,
                targetProductId: null,
              })
            }
          >
            <option value="PENDING">{words.pending}</option>
            <option value="ADD">{words.addSeparate}</option>
            <option value="UPDATE">{words.update}</option>
            <option value="SKIP">{words.skip}</option>
          </select>
          {row.action === "UPDATE" && (
            <select
              aria-label={words.target}
              value={row.targetProductId ?? ""}
              onChange={(e) =>
                onChange({
                  ...row,
                  targetProductId: e.target.value || null,
                  approvePrice: false,
                  approveConfiguration: false,
                })
              }
            >
              <option value="">{words.choose}</option>
              {products
                .filter((p) => !p.published)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.translations[0]?.name} ·{" "}
                    {(p.priceMinor / 100).toFixed(2)} {p.currency}
                  </option>
                ))}
            </select>
          )}
        </label>
      </div>
      {duplicates.length > 0 && (
        <aside className="bi-duplicate">
          <strong>{words.duplicate}</strong>
          <p>
            {duplicates
              .map((d) => `${d.name} · ${(d.priceMinor / 100).toFixed(2)}`)
              .join(" / ")}
          </p>
        </aside>
      )}
      <details>
        <summary>{words.configuration}</summary>
        <label>
          {words.station}
          <select
            value={item.station}
            aria-label={words.station}
            onChange={(e) =>
              edit({ station: e.target.value as typeof item.station })
            }
          >
            {Object.entries(words.stations).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {item.variants.map((variant, index) => (
          <div className="bi-option" key={index}>
            <input
              aria-label={words.variant}
              value={variant.name}
              onChange={(e) =>
                edit({
                  variants: item.variants.map((v, i) =>
                    i === index ? { ...v, name: e.target.value } : v,
                  ),
                })
              }
            />
            <input
              aria-label={words.delta}
              type="number"
              step="0.01"
              value={
                variant.priceDeltaMinor === null
                  ? ""
                  : variant.priceDeltaMinor / 100
              }
              onChange={(e) =>
                edit({
                  variants: item.variants.map((v, i) =>
                    i === index
                      ? { ...v, priceDeltaMinor: minor(e.target.value) }
                      : v,
                  ),
                })
              }
            />
            <label className="bi-check">
              <input
                type="radio"
                name={`default-${row.id}`}
                checked={variant.isDefault}
                onChange={() =>
                  edit({
                    variants: item.variants.map((v, i) => ({
                      ...v,
                      isDefault: i === index,
                    })),
                  })
                }
              />
              {words.defaultVariant}
            </label>
            <button
              type="button"
              onClick={() =>
                edit({ variants: item.variants.filter((_, i) => i !== index) })
              }
            >
              {words.remove}
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            edit({
              variants: [
                ...item.variants,
                {
                  name: "",
                  priceDeltaMinor: null,
                  isDefault: item.variants.length === 0,
                },
              ],
            })
          }
        >
          + {words.variant}
        </button>
        {item.modifierGroups.map((group, index) => {
          const setGroup = (patch: Partial<typeof group>) =>
            edit({
              modifierGroups: item.modifierGroups.map((g, i) =>
                i === index ? { ...g, ...patch } : g,
              ),
            });
          return (
            <fieldset key={index}>
              <legend>
                {words.extra} {index + 1}
              </legend>
              <input
                aria-label={words.name}
                value={group.name}
                onChange={(e) => setGroup({ name: e.target.value })}
              />
              <div className="bi-two">
                <label>
                  {words.min}
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={group.minSelect}
                    onChange={(e) =>
                      setGroup({ minSelect: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  {words.max}
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={group.maxSelect}
                    onChange={(e) =>
                      setGroup({ maxSelect: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              {group.options.map((option, n) => (
                <div className="bi-option" key={n}>
                  <input
                    aria-label={words.option}
                    value={option.name}
                    onChange={(e) =>
                      setGroup({
                        options: group.options.map((o, i) =>
                          i === n ? { ...o, name: e.target.value } : o,
                        ),
                      })
                    }
                  />
                  <input
                    type="number"
                    aria-label={words.delta}
                    min="0"
                    step="0.01"
                    value={
                      option.priceDeltaMinor === null
                        ? ""
                        : option.priceDeltaMinor / 100
                    }
                    onChange={(e) =>
                      setGroup({
                        options: group.options.map((o, i) =>
                          i === n
                            ? { ...o, priceDeltaMinor: minor(e.target.value) }
                            : o,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setGroup({
                        options: group.options.filter((_, i) => i !== n),
                      })
                    }
                  >
                    {words.remove}
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setGroup({
                    options: [
                      ...group.options,
                      { name: "", priceDeltaMinor: null },
                    ],
                  })
                }
              >
                + {words.option}
              </button>
              <button
                type="button"
                onClick={() =>
                  edit({
                    modifierGroups: item.modifierGroups.filter(
                      (_, i) => i !== index,
                    ),
                  })
                }
              >
                {words.remove}
              </button>
            </fieldset>
          );
        })}
        <button
          type="button"
          onClick={() =>
            edit({
              modifierGroups: [
                ...item.modifierGroups,
                { name: "", minSelect: 0, maxSelect: 1, options: [] },
              ],
            })
          }
        >
          + {words.extra}
        </button>
        <div className="bi-allergens">
          {importAllergenCodes.map((code) => (
            <label className="bi-check" key={code}>
              <input
                type="checkbox"
                checked={item.approvedAllergens.includes(code)}
                onChange={(e) =>
                  edit({
                    approvedAllergens: e.target.checked
                      ? [...item.approvedAllergens, code]
                      : item.approvedAllergens.filter((c) => c !== code),
                  })
                }
              />
              {words.allergens[code]}
            </label>
          ))}
        </div>
      </details>
      <details>
        <summary>{words.details}</summary>
        <pre>
          {JSON.stringify(
            data.items.find((i) => i.id === row.id)?.original,
            null,
            2,
          )}
        </pre>
      </details>
      {row.action !== "SKIP" && (
        <div className="bi-approvals">
          <label className="bi-check">
            <input
              type="checkbox"
              checked={item.duplicateAcknowledged}
              onChange={(e) =>
                onChange({
                  ...row,
                  item: { ...item, duplicateAcknowledged: e.target.checked },
                })
              }
            />
            {words.acknowledge}
          </label>
          <label className="bi-check">
            <input
              type="checkbox"
              checked={row.approvePrice}
              onChange={(e) =>
                onChange({ ...row, approvePrice: e.target.checked })
              }
            />
            {words.priceApproval}
          </label>
          <label className="bi-check">
            <input
              type="checkbox"
              checked={row.approveConfiguration}
              onChange={(e) =>
                onChange({ ...row, approveConfiguration: e.target.checked })
              }
            />
            {words.configurationApproval}
          </label>
        </div>
      )}
    </article>
  );
}
export function ImportPhotographs({
  data,
  review,
  words,
  onChange,
  onImport,
}: {
  data: ImportView;
  review: BusinessReview;
  words: ImportCopy;
  onChange: (review: BusinessReview) => void;
  onImport: (id: string, publicUse: boolean) => Promise<void>;
}) {
  return (
    <div className="bi-photos">
      {!data.businessData.images.length && <p>{words.noImages}</p>}
      {data.businessData.images.map((image) => (
        <ImportPhoto
          key={image.id}
          image={image}
          review={review}
          words={words}
          onChange={onChange}
          onImport={onImport}
        />
      ))}
    </div>
  );
}
function ImportPhoto({
  image,
  review,
  words,
  onChange,
  onImport,
}: {
  image: BusinessImage;
  review: BusinessReview;
  words: ImportCopy;
  onChange: (review: BusinessReview) => void;
  onImport: (id: string, publicUse: boolean) => Promise<void>;
}) {
  const [rights, setRights] = useState(false);
  const [publicUse, setPublicUse] = useState(false);
  const assignment = review.media.find((row) => row.candidateId === image.id);
  const change = (patch: Partial<BusinessReview["media"][number]>) =>
    onChange({
      ...review,
      media: review.media.map((row) =>
        row.candidateId === image.id ? { ...row, ...patch } : row,
      ),
    });
  return (
    <article className="bi-photo">
      <h3>{image.label || words.media}</h3>
      {image.assetId ? (
        <img
          src={`${setupApi}/v1/media/${image.assetId}`}
          alt={image.label}
          loading="lazy"
        />
      ) : (
        <div className="bi-photo-origin">
          <span>↗</span>
          <a href={image.url} target="_blank" rel="noreferrer">
            {new URL(image.url).hostname}
          </a>
        </div>
      )}
      <details>
        <summary>{words.details}</summary>
        <p>{image.url}</p>
        <code>{image.evidence.sourceHash}</code>
      </details>
      {!image.assetId ? (
        <>
          <label className="bi-check">
            <input
              type="checkbox"
              checked={rights}
              onChange={(e) => setRights(e.target.checked)}
            />
            {words.rights}
          </label>
          <label className="bi-check">
            <input
              type="checkbox"
              checked={publicUse}
              onChange={(e) => setPublicUse(e.target.checked)}
            />
            {words.publicUse}
          </label>
          <button
            type="button"
            disabled={!rights}
            onClick={() => void onImport(image.id, publicUse)}
          >
            {words.importImage}
          </button>
        </>
      ) : (
        <>
          <label className="bi-check">
            <input
              type="checkbox"
              checked={!!assignment}
              onChange={(e) =>
                onChange({
                  ...review,
                  media: e.target.checked
                    ? [
                        ...review.media,
                        {
                          candidateId: image.id,
                          assetId: image.assetId!,
                          targetItemId: null,
                          role: "GALLERY",
                          rightsConfirmed: true,
                        },
                      ]
                    : review.media.filter(
                        (row) => row.candidateId !== image.id,
                      ),
                })
              }
            />
            {words.useImage}
          </label>
          {assignment && (
            <>
              <select
                aria-label={words.target}
                value={assignment.targetItemId ?? ""}
                onChange={(e) =>
                  change({
                    targetItemId: e.target.value || null,
                    role: "GALLERY",
                  })
                }
              >
                <option value="">{words.venue}</option>
                {review.items
                  .filter((i) => ["ADD", "UPDATE"].includes(i.action))
                  .map((i) => (
                    <option value={i.id} key={i.id}>
                      {i.item.name}
                    </option>
                  ))}
              </select>
              <select
                aria-label={words.role}
                value={assignment.role}
                onChange={(e) =>
                  change({ role: e.target.value as typeof assignment.role })
                }
              >
                {(assignment.targetItemId
                  ? ["PRIMARY", "GALLERY"]
                  : ["LOGO", "HERO", "GALLERY"]
                ).map((role) => (
                  <option key={role} value={role}>
                    {words.roles[role]}
                  </option>
                ))}
              </select>
            </>
          )}
        </>
      )}
    </article>
  );
}
