import type {
  BusinessProfileTemplate,
  MenuImportProposal,
  ReviewedMenuItem,
  SmartSetupUpdate,
} from "@flowgastronomie/domain";
export const setupApi =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:4000";
export async function setupRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${setupApi}/v1/staff/${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      ...(typeof init.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.message ?? body.code ?? `Request failed (${response.status})`,
    );
  }
  return response.json() as Promise<T>;
}
export type SetupData = {
  progress: SmartSetupUpdate & {
    version: number;
    status: string;
    activeImportSessionId: string | null;
  };
  venue: { name: string; currency: string; timezone: string };
  profiles: BusinessProfileTemplate[];
};
export type ImportRow = {
  id: string;
  status: string;
  original: MenuImportProposal["items"][number];
  reviewed: ReviewedMenuItem;
  duplicates: { id: string; name: string; priceMinor: number }[];
};
export type ImportData = {
  businessData?: { schemaVersion: number } | null;
  products: { id: string; names: string[]; priceMinor: number }[];
  id: string;
  version: number;
  status: string;
  extractionState: string;
  errorCode: string | null;
  provenance: unknown;
  sources: {
    id: string;
    filename: string;
    mimeType: string;
    url: string;
    contentHash: string;
    pageCount: number;
  }[];
  items: ImportRow[];
  categories: {
    id: string;
    translations: { locale: string; name: string }[];
  }[];
};
