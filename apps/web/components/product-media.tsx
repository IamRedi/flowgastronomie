"use client";

import Image from "next/image";
import { useState } from "react";
import {
  illustrationKind,
  type IllustrationKind,
} from "../lib/product-illustration";
import type { ProductImage } from "../lib/pilot-product-images";

/** Decorative artwork, never a substitute for product names or ingredients. */
export function TableSetting({ kind = "plate" }: { kind?: IllustrationKind }) {
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
        {kind === "pizza" ? (
          <>
            <circle cx="100" cy="78" r="47" fill="#d49a55" fillOpacity=".15" />
            <circle cx="100" cy="78" r="39" />
            <path d="M100 39v39l34 20M100 78 66 98" />
            <circle cx="82" cy="61" r="6" />
            <circle cx="118" cy="65" r="6" />
            <circle cx="100" cy="102" r="6" />
            <path d="m75 81 6-5m34 13 6-5M98 53l5 4" />
          </>
        ) : kind === "pasta" ? (
          <>
            <ellipse cx="100" cy="100" rx="54" ry="17" />
            <path d="M57 95q3 34 43 34t43-34M70 95c-24-25 37-37 26-9s-35-1-9-21 55 0 35 24-27-27-2-24M137 30v46m-7-46v19q7 10 14 0V30" />
          </>
        ) : kind === "salad" ? (
          <>
            <path d="M50 84h100q-8 40-50 40T50 84Z" />
            <path d="M66 84C40 58 68 37 88 71 75 28 119 27 117 71c27-41 49-8 21 13M86 79l-14-19m39 19 6-24" />
            <circle cx="96" cy="79" r="11" />
            <path d="m94 71 4 15" />
          </>
        ) : kind === "coffee" ? (
          <>
            <path d="M64 65h65v25a32 29 0 0 1-65 0ZM129 70h10a13 13 0 0 1 0 26h-10M86 53c-14-12 13-17 0-29m24 29c-14-12 13-17 0-29" />
            <ellipse cx="99" cy="123" rx="48" ry="7" />
          </>
        ) : kind === "drink" ? (
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
  category,
}: {
  image: ProductImage | undefined;
  demoLabel: string;
  kind?: IllustrationKind;
  category?: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = failedSource === image?.src;
  const resolvedKind = category
    ? illustrationKind(category)
    : (kind ?? "plate");
  return (
    <span
      className={`pos-product-media illustration-${resolvedKind}${image && !failed ? " has-photo" : ""}`}
      data-illustration={!image || failed ? resolvedKind : undefined}
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
            onError={() => setFailedSource(image.src)}
          />
          {(image.label || image.kind === "demo") && (
            <small className="pos-photo-label">
              {image.label ?? demoLabel}
            </small>
          )}
        </>
      ) : (
        <TableSetting kind={resolvedKind} />
      )}
    </span>
  );
}
