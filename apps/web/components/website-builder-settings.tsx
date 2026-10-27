"use client";
import { WEEKDAYS } from "@flowgastronomie/domain";
import type { Dictionary } from "../lib/dictionaries";
import type { WebsiteEditor } from "../app/app/[lang]/website/website-editor-client";
export function WebsiteBuilderSettings({
  website,
  labels,
  update,
  busy,
  unpublish,
}: {
  website: WebsiteEditor;
  labels: Dictionary["websiteAdmin"];
  update: (change: Partial<WebsiteEditor>) => void;
  busy: boolean;
  unpublish: () => void;
}) {
  return (
    <details>
      <summary>
        {labels.brand} · {labels.hours}
      </summary>
      <label>
        {labels.publicSlug}
        <input
          value={website.publicSlug}
          maxLength={60}
          onChange={(e) => update({ publicSlug: e.target.value })}
        />
      </label>
      {(["primaryColor", "accentColor"] as const).map((key) => (
        <label key={key}>
          {labels[key]}
          <input
            type="color"
            value={website[key]}
            onChange={(e) => update({ [key]: e.target.value })}
          />
        </label>
      ))}
      {(["instagramUrl", "facebookUrl"] as const).map((key) => (
        <label key={key}>
          {key === "instagramUrl" ? labels.instagram : labels.facebook}
          <input
            type="url"
            value={website[key] ?? ""}
            onChange={(e) => update({ [key]: e.target.value || null })}
          />
        </label>
      ))}
      <label>
        <input
          type="checkbox"
          checked={website.openingHours.length > 0}
          onChange={(e) =>
            update({
              openingHours: e.target.checked
                ? WEEKDAYS.map((day) => ({
                    day,
                    closed: true,
                    opensAt: "00:00",
                    closesAt: "00:00",
                  }))
                : [],
            })
          }
        />
        {labels.hours}
      </label>
      {website.openingHours.map((hours) => (
        <div key={hours.day}>
          <strong>{labels.days[hours.day]}</strong>
          <label>
            <input
              type="checkbox"
              checked={hours.closed}
              onChange={(e) =>
                update({
                  openingHours: website.openingHours.map((h) =>
                    h.day === hours.day
                      ? { ...h, closed: e.target.checked }
                      : h,
                  ),
                })
              }
            />
            {labels.closed}
          </label>
          {!hours.closed &&
            (["opensAt", "closesAt"] as const).map((key) => (
              <input
                key={key}
                aria-label={`${labels.days[hours.day]} ${key === "opensAt" ? labels.hours : "—"}`}
                type="time"
                value={hours[key]}
                onChange={(e) =>
                  update({
                    openingHours: website.openingHours.map((h) =>
                      h.day === hours.day ? { ...h, [key]: e.target.value } : h,
                    ),
                  })
                }
              />
            ))}
        </div>
      ))}
      {website.status === "PUBLISHED" && (
        <button type="button" disabled={busy} onClick={unpublish}>
          {labels.unpublish}
        </button>
      )}
    </details>
  );
}
