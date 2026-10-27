# Business profiles, synthetic demos and self-registered businesses

Updated: 2026-10-09. This supersedes the earlier canonical local-pilot plan.

A BusinessProfileTemplate is configuration, never a database snapshot. The
canonical provisioner creates a fresh Tenant, Venue, Owner and Membership with
selected deterministic defaults. It never copies operational records, sessions,
QR tokens, prices or customer data from another business.

Every real customer, including former pilot businesses, uses:

Business Registration → Smart Onboarding → Smart Import → Review → Draft → Preview.

No real client account, tenant, menu, brand asset, contact or website is seeded
or used as a default. Public registration always creates REAL businesses;
LOCAL_PILOT is retained only for existing-row compatibility and cannot be created.
Login fields start empty and do not advertise fixture credentials.

The nine premium families remain PIZZERIA, RESTAURANT, BAKERY, DONER, CAFE, BAR,
IMBISS, FAST_FOOD and ICE_CAFE, with three styles each. GENERIC retains its empty
menu invitation and three styles. Catalogs and read-only showcases are synthetic;
explicit DEMO generation uses the same provisioner, canonical menu and media.
The minimal Restaurant Olive LEGACY_CI fixture exists only for technical gates.
It is not a customer's account or a dependency of registration/import.

Canonical MediaAsset, VenueMedia and ProductMedia remain the only shared media
source. Originals/provenance stay immutable, tenant scope is mandatory and public
use requires human approval. Test logos are generated synthetic fixtures.

Legacy local cleanup requires an exact inventory and verified ownership before
changes. Never delete invoices, fiscal history or unidentified customers. Remote
Neon/OVH/production changes require their own inventory and approval. No Git history
is rewritten. See cleanup evidence.
