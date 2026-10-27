"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { businessIdentityLabel, type StaffRole } from "@flowgastronomie/domain";
import { PilotIcon } from "./[lang]/staff/pilot-icon";
import { PilotDialog } from "./[lang]/staff/pilot-dialog";
import {
  pilotNavigation,
  pilotNavigationActive,
  pilotArea,
} from "../lib/pilot-navigation";
import { dashboardText } from "../lib/pilot-dashboard-copy";
import { pilotText } from "../lib/pilot-copy";
import { localeNames, type Locale } from "../lib/i18n";

type PilotStaff = {
  displayName: string;
  email: string;
  role: StaffRole;
  venueName: string;
  venueLogoUrl?: string | null;
  venueCity?: string | null;
  tenantId: string;
  venueId: string;
  tenantKind?: "REAL" | "DEMO" | "LOCAL_PILOT" | "LEGACY_CI";
};
const StaffContext = createContext<PilotStaff | null>(null);
export const usePilotStaff = () => useContext(StaffContext);
const DemoContext = createContext(false);
export const usePilotDemo = () => useContext(DemoContext);
const preferenceKey = "pilot-sidebar:area:v2";

export function PilotAppShell({
  children,
  locale,
}: {
  children: ReactNode;
  locale: Locale;
}) {
  const pathname = usePathname();
  // Authentication and invitation entry points remain outside the signed-in shell.
  if (/\/staff\/(login|invite)(?:\/|$)/.test(pathname)) return children;
  return (
    <AuthenticatedShell locale={locale} pathname={pathname}>
      {children}
    </AuthenticatedShell>
  );
}
function AuthenticatedShell({
  children,
  locale,
  pathname,
}: {
  children: ReactNode;
  locale: Locale;
  pathname: string;
}) {
  const [staff, setStaff] = useState<PilotStaff | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [preference, setPreference] = useState<{
    area: string;
    collapsed: boolean;
  } | null>(null);
  const [mobile, setMobile] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [profile, setProfile] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const profilePopover = useRef<HTMLDivElement>(null);
  const words = dashboardText(locale);
  const text = pilotText(locale);
  const api =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const area = pilotArea(pathname, locale);
  const collapsed =
    preference?.area === area ? preference.collapsed : area !== "home";
  useEffect(() => {
    try {
      localStorage.removeItem("pilot-sidebar:v1");
    } catch {
      /* obsolete global preference */
    }
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => {
      setMobile(query.matches);
      setDrawer(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let next = { area, collapsed: area !== "home" };
    try {
      const saved = JSON.parse(sessionStorage.getItem(preferenceKey) ?? "null");
      if (saved?.area === area && typeof saved.collapsed === "boolean")
        next = saved;
      sessionStorage.setItem(preferenceKey, JSON.stringify(next));
    } catch {
      /* Optional tab-local preference. */
    }
    setPreference(next);
    setDrawer(false);
  }, [area]);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    fetch(`${api}/v1/staff/me`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.assign(`/${locale}/staff/login`);
          return;
        }
        if (!response.ok) throw new Error();
        const result = (await response.json()) as { staff: PilotStaff };
        if (!controller.signal.aborted) setStaff(result.staff);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [api, locale, retry]);
  function toggle() {
    const next = !collapsed;
    setPreference({ area, collapsed: next });
    try {
      sessionStorage.setItem(
        preferenceKey,
        JSON.stringify({ area, collapsed: next }),
      );
    } catch {
      /* In-memory preference still works. */
    }
  }
  async function logout() {
    setLogoutBusy(true);
    try {
      const response = await fetch(`${api}/v1/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error();
      window.location.assign(`/${locale}/staff/login`);
    } catch {
      setFailed(true);
      setLogoutBusy(false);
    }
  }
  if (!staff)
    return (
      <main className="workspace-state">
        <p role="status">{failed ? text.error : text.unknown}</p>
        {failed && (
          <button onClick={() => setRetry((value) => value + 1)}>
            {text.refresh}
          </button>
        )}
      </main>
    );
  const brand = staff.venueLogoUrl
    ? {
        name: staff.venueName,
        city: staff.venueCity,
        logoUrl: `${api}${staff.venueLogoUrl}`,
      }
    : undefined;
  const navigation = pilotNavigation(locale, staff.role);
  const navLink = (item: (typeof navigation)[number]) => (
    <a
      key={item.key}
      data-primary={item.key}
      href={item.href}
      aria-label={item.label}
      title={item.label}
      aria-current={
        pilotNavigationActive(item.key, item.href, pathname)
          ? "page"
          : undefined
      }
      onClick={() => setDrawer(false)}
    >
      <PilotIcon name={item.icon} />
      <span className="app-nav-label">{item.label}</span>
    </a>
  );
  const sidebar = (
    <>
      <div className="app-sidebar-brand">
        {brand ? (
          <span className="app-venue-logo">
            <Image
              src={brand.logoUrl}
              unoptimized
              alt={brand.name}
              width={56}
              height={56}
            />
          </span>
        ) : (
          <span className="pos-brand-mark">
            <PilotIcon name="home" />
          </span>
        )}
        <span className="app-nav-label">
          <strong>{brand?.name ?? staff.venueName}</strong>
          {staff.tenantKind && (
            <small>{businessIdentityLabel(staff.tenantKind)}</small>
          )}
          {brand && <small>{brand.city}</small>}
        </span>
      </div>
      {!mobile && (
        <button
          type="button"
          className="app-sidebar-toggle"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls="pilot-navigation"
          aria-label={collapsed ? words.expand : words.collapse}
        >
          <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
        </button>
      )}
      <nav
        id="pilot-navigation"
        className="app-navigation"
        aria-label="Operations"
      >
        <div className="app-nav-main">
          {navigation.filter((item) => item.key !== "settings").map(navLink)}
        </div>
        <div className="app-sidebar-bottom">
          {navigation.filter((item) => item.key === "settings").map(navLink)}
          <button
            type="button"
            className="app-language"
            popoverTarget="desk-language-menu"
            aria-label={words.language}
            title={words.language}
          >
            <PilotIcon name="translate" />
            <span className="app-nav-label">{localeNames[locale]}</span>
          </button>
          <div
            id="desk-language-menu"
            className="desk-popover app-popover"
            popover="auto"
          >
            {(["sq", "de", "it", "en"] as const).map((language) => (
              <a
                key={language}
                href={pathname.replace(
                  new RegExp(`^(/app)?/${locale}(?=/|$)`),
                  `$1/${language}`,
                )}
                hrefLang={language}
                aria-current={locale === language ? "true" : undefined}
              >
                {localeNames[language]}
                {locale === language && <PilotIcon name="ready" />}
              </a>
            ))}
          </div>
          <button
            type="button"
            className="app-user"
            popoverTarget="desk-profile-menu"
            aria-label={staff.displayName}
            title={staff.displayName}
          >
            <span className="desk-avatar">{staff.displayName.slice(0, 1)}</span>
            <span className="app-nav-label">{staff.displayName}</span>
            <span className="app-nav-label">
              <PilotIcon name="chevron" />
            </span>
          </button>
          <div
            id="desk-profile-menu"
            ref={profilePopover}
            className="desk-popover app-popover"
            popover="auto"
          >
            <small>
              {staff.displayName}
              <br />
              {words.role} · {staff.role}
            </small>
            <button
              type="button"
              onClick={() => {
                profilePopover.current?.hidePopover();
                setDrawer(false);
                setProfile(true);
              }}
            >
              <PilotIcon name="user" />
              {words.profile}
            </button>
            <button
              type="button"
              disabled={logoutBusy}
              onClick={() => void logout()}
            >
              <PilotIcon name="logout" />
              {words.logout}
            </button>
            {failed && <p role="alert">{text.error}</p>}
          </div>
        </div>
      </nav>
    </>
  );
  return (
    <StaffContext.Provider value={staff}>
      <DemoContext.Provider value={!!brand}>
        <div
          className={`pilot-app-shell ${collapsed ? "is-collapsed" : "is-expanded"}`}
        >
          {mobile ? (
            <>
              {drawer && (
                <PilotDialog
                  className="app-navigation-drawer"
                  title={words.navigation}
                  closeLabel={text.close}
                  onClose={() => setDrawer(false)}
                >
                  {sidebar}
                </PilotDialog>
              )}
            </>
          ) : (
            <aside className="app-sidebar">{sidebar}</aside>
          )}
          <div className="app-page-content">
            <header className="app-platform-header">
              {mobile && (
                <button
                  type="button"
                  className="pilot-icon-button"
                  aria-label={words.expand}
                  aria-expanded={drawer}
                  onClick={() => setDrawer(true)}
                >
                  <PilotIcon name="navigation" />
                </button>
              )}
              <h1>
                {navigation.find((item) => item.key === area)?.label ??
                  words.overview}
              </h1>
              <span className="app-platform-brand">
                <b>RF</b>RestaurantFlow
              </span>
            </header>
            {children}
          </div>
          {profile && (
            <PilotDialog
              title={words.profile}
              closeLabel={text.close}
              onClose={() => setProfile(false)}
            >
              <dl className="desk-info">
                <dt>{words.profile}</dt>
                <dd>{staff.displayName}</dd>
                <dt>Email</dt>
                <dd>{staff.email}</dd>
                <dt>{words.role}</dt>
                <dd>{staff.role}</dd>
              </dl>
            </PilotDialog>
          )}
        </div>
      </DemoContext.Provider>
    </StaffContext.Provider>
  );
}
