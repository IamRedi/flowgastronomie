import { NextResponse, type NextRequest } from "next/server";

import { detectLocale, locales } from "./lib/i18n";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = (
    (request.headers.get("host") ?? "").split(":")[0] ?? ""
  ).toLowerCase();
  const isPlatformHost =
    !hostname ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".restaurantflow.com") ||
    hostname.endsWith(".restaurantflow.site") ||
    hostname.endsWith(".flowgastronomie.com") ||
    hostname.endsWith(".flowgastronomie.site");

  if (!isPlatformHost && pathname === "/") {
    const apiUrl =
      process.env.API_URL?.replace(/\/$/, "") ??
      process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
      "http://localhost:4000";
    try {
      const response = await fetch(
        `${apiUrl}/v1/public/domains/${encodeURIComponent(hostname)}`,
        { cache: "no-store" },
      );
      if (response.ok) {
        const domain = (await response.json()) as {
          publicSlug: string;
          defaultLocale: string;
        };
        const destination = request.nextUrl.clone();
        destination.pathname = `/${domain.defaultLocale}/venue/${domain.publicSlug}`;
        return NextResponse.rewrite(destination);
      }
    } catch {
      // Continue to the normal locale route when domain resolution is unavailable.
    }
  }
  const pathnameHasLocale = locales.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );

  const workspaceHasLocale = locales.some(
    (locale) =>
      pathname === `/app/${locale}` || pathname.startsWith(`/app/${locale}/`),
  );

  if (pathnameHasLocale || workspaceHasLocale) return NextResponse.next();

  const locale = detectLocale(request.headers.get("accept-language"));
  const destination = request.nextUrl.clone();
  destination.pathname = pathname.startsWith("/app")
    ? `/app/${locale}${pathname.slice(4)}`
    : `/${locale}${pathname}`;

  return NextResponse.redirect(destination);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
