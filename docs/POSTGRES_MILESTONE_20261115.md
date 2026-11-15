# Flow infrastructure milestone — 15 November 2026

The private operational source is RestaurantFlow PR66, runtime operator d0c0851.
The existing pilot switched to private PostgreSQL 18 at 21:18:48 UTC, preserving
all business tables and sequences. The application image, public website, proxy,
fiscal/payment mode and other applications did not change. Existing encrypted
backup infrastructure now includes bounded native WAL/PITR. Actual business
native restore, a real off-host incremental synthetic stream and post-cutover
logical/media backup have separate verified evidence. Private operational paths,
credentials and customer data are intentionally absent from this public note.

The initial attempt safely stopped before the connection switch and restarted
the unchanged source; a corrected explicit-database check and fresh final backup
preceded the successful attempt. Recovery is not a claim of zero downtime or
physical/fiscal LIVE acceptance. Private filesystem media retain their nightly
cadence. No new paid provider/server/plan was added; future unlimited volume or
zero operating cost is not promised. The retained hosted source was observed
naturally idle after the switch; it was not deleted or manually suspended.

Presentation assessment: the native public website and portfolio card still
accurately describe the same pilot product and generic PostgreSQL/Prisma stack.
NO_CONTENT_CHANGE for public UI, media, languages, card order, About and maturity.
This README update records the internal deployment milestone; historical source
snapshot stack/test counts retain their original dates. No app test/build or
new screenshot is needed for these documentation-only changes. Publication is
pending merge of this companion PR; no showcase/portfolio deploy is claimed.
