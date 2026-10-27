import { notFound } from "next/navigation";
import { hasLocale } from "../../../../lib/i18n";
import "../../../../components/creative/studio.css";
export default async function MarketingPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const { view } = await searchParams;
  return (
    <main className="cs-root">
      <nav className="cs-marketing" aria-label="Marketing">
        {[
          ["Overview", ""],
          ["Promotions", "?view=promotions"],
          ["Gift Cards", "?view=gift-cards"],
          ["Creative Studio", "/creative"],
          ["Analytics", "?view=analytics"],
        ].map(([label, url]) => (
          <a key={label} href={`/app/${lang}/marketing${url}`}>
            {label}
          </a>
        ))}
      </nav>
      <p className="cs-eyebrow">MARKETING</p>
      <h1>
        {view === "promotions"
          ? "Promotions"
          : view === "gift-cards"
            ? "Gift Cards"
            : view === "analytics"
              ? "Analytics"
              : "Bring your venue to life."}
      </h1>
      {view ? (
        <div className="cs-empty">
          <h2>Not operational yet</h2>
          <p>
            {view === "gift-cards"
              ? "Design a gift-card visual in Creative Studio. Issuance, redemption and balances are not available."
              : view === "promotions"
                ? "Create promotional artwork in Creative Studio. No discount or campaign is activated here."
                : "Campaign measurement is not available. Export history is available inside each design."}
          </p>
        </div>
      ) : (
        <div className="cs-library-header">
          <div>
            <h2>Creative Studio</h2>
            <p>
              Your real menu and brand. Editable designs for social, print and
              the table.
            </p>
            <a href={`/app/${lang}/marketing/creative`}>
              Open Creative Studio →
            </a>
          </div>
        </div>
      )}
    </main>
  );
}
