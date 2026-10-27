"use client";

import Image from "next/image";
import { useState } from "react";
import type { ProductImage } from "../../../../lib/pilot-product-images";

/** Decorative artwork, never a substitute for product names or ingredients. */
export function TableSetting({
  kind = "plate",
}: {
  kind?: "plate" | "drink" | "dessert";
}) {
  return (
    <svg viewBox="0 0 200 150" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M22 116C5 85 38 19 80 19s43 13 68 28 40 63 9 77-111 26-135-8Z"
        fill="currentColor"
        opacity=".055"
      />
      <g
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {kind === "drink" ? (
          <>
            <path d="m78 48 6 67h36l6-67ZM77 48h50M89 105h26M81 65h42" />
            <path d="m106 31-9 51M107 31h15" />
            <ellipse cx="102" cy="122" rx="36" ry="5" opacity=".35" />
          </>
        ) : kind === "dessert" ? (
          <>
            <ellipse cx="103" cy="111" rx="51" ry="11" />
            <path d="m70 96 5-43 52 8 9 37-30 10ZM75 53l32 13 20-5M107 66l-1 42M73 77l34 12 24-9" />
            <path
              d="M85 38c-7-7 3-10 0-17M105 42c-7-7 3-10 0-17"
              opacity=".5"
            />
          </>
        ) : (
          <>
            <ellipse cx="103" cy="81" rx="48" ry="44" />
            <ellipse cx="103" cy="81" rx="36" ry="33" opacity=".5" />
            <path d="M35 47v72M28 47v23q7 12 14 0V47M35 46v25M172 46v73M172 46c-12 18-12 36 0 39" />
          </>
        )}
        <path
          d="M130 126c18-1 31-12 37-27M143 122c-1-10 3-14 9-15-1 8-4 12-9 15ZM153 116c8 2 12-1 15-7-8-1-12 1-15 7Z"
          opacity=".65"
        />
      </g>
    </svg>
  );
}

export function ProductMedia({
  image,
  demoLabel,
  kind,
}: {
  image: ProductImage | undefined;
  demoLabel: string;
  kind: "plate" | "drink" | "dessert";
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={`pos-product-media${image && !failed ? " has-photo" : ""}`}
    >
      {image && !failed ? (
        <>
          <Image
            src={image.src}
            unoptimized
            alt=""
            width={480}
            height={360}
            sizes="(max-width: 760px) 46vw, (max-width: 1100px) 190px, 210px"
            onError={() => setFailed(true)}
          />
          {(image.label || image.kind === "demo") && (
            <small className="pos-photo-label">
              {image.label ?? demoLabel}
            </small>
          )}
        </>
      ) : (
        <TableSetting kind={kind} />
      )}
    </span>
  );
}
