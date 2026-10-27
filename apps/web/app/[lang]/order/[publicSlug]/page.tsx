// Keep bookmarked order URLs, tokens and the venue-scoped basket intact.
// Both entry routes render the same published website and ordering component.
export { default, generateMetadata } from "../../venue/[publicSlug]/page";
export const dynamic = "force-dynamic";
