"use client";
import { useEffect, useRef } from "react";
export function WebsiteInlineText({
  value,
  label,
  multiline,
  limit,
  placeholder,
  onChange,
}: {
  value: string;
  label: string;
  multiline?: boolean;
  limit: number;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (node && document.activeElement !== node) node.textContent = value;
  }, [value]);
  return (
    <span
      ref={ref}
      className="ws-inline"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      data-placeholder={placeholder}
      aria-multiline={multiline ?? false}
      tabIndex={0}
      onKeyDown={(e) => {
        if (!multiline && e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onInput={(e) => {
        const node = e.currentTarget;
        const text = (node.textContent ?? "").slice(0, limit);
        if ((node.textContent ?? "").length > limit) node.textContent = text;
        onChange(text);
      }}
      onBlur={(e) => {
        e.currentTarget.textContent = value;
      }}
    />
  );
}
