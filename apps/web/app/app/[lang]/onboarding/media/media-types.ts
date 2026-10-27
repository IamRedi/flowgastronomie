import type {
  CanonicalMediaReference,
  SetupMediaAssignment,
} from "@flowgastronomie/domain";
export type MediaPhoto = CanonicalMediaReference & { provenance: unknown };
export type MediaWorkspace = {
  progress: { version: number; step: number; status: string };
  venue: { name: string; defaultLocale: string; tenant: { kind: string } };
  products: {
    id: string;
    published: boolean;
    translations: { locale: string; name: string }[];
  }[];
  assignments: SetupMediaAssignment[];
  assets: MediaPhoto[];
};
