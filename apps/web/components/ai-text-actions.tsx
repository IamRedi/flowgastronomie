"use client";
import { aiTextActions } from "@flowgastronomie/domain";
import type { Locale } from "../lib/i18n";
import { websiteBuilderCopy } from "./website-builder-copy";
// Shared content controls; the owning surface supplies its authorized context.
export function AiTextActions({
  locale,
  disabled,
  onAction,
}: {
  locale: Locale;
  disabled: boolean;
  onAction: (action: (typeof aiTextActions)[number]) => void;
}) {
  const c = websiteBuilderCopy(locale);
  return (
    <div className="ai-text-actions">
      {aiTextActions.map((action, index) => (
        <button
          type="button"
          key={action}
          disabled={disabled}
          onClick={() => onAction(action)}
        >
          {c[44 + index]}
        </button>
      ))}
    </div>
  );
}
