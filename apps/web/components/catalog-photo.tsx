"use client";

import type { CanonicalMediaReference } from "@flowgastronomie/domain";
import { ProductMedia } from "./product-media";
import "./catalog-photo.css";

/** Public surfaces receive only the canonical media allowed by their API. */
export function CatalogPhoto({
  media,
  category,
}: {
  media?: CanonicalMediaReference | undefined;
  category: string;
}) {
  const api =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  return (
    <span className="catalog-photo">
      <ProductMedia
        category={category}
        demoLabel="DEMO"
        image={
          media
            ? {
                src: `${api}${media.url}`,
                kind: media.source === "DEMO" ? "demo" : "approved",
                label: media.label ?? undefined,
              }
            : undefined
        }
      />
    </span>
  );
}
