# WF3 recipient inbox and outbox operations

Publications and WF2 operations persist notices/channel records in their original
transaction. Draft edits never notify. Publication changes target affected workers;
request/decision/hour notices target only their authorized parties or active venue
managers. Account close/compensation targets its employee. Schema version 1 and unique
event/recipient/channel identity make replay append-free. Migration does not silently
send old events; authorized scoped replay reconstructs missing intents without
resetting existing delivery rows or resending delivered messages. A finite source-ID
set is replayed in batches of 25 with fresh actor/scope checks per transaction;
large history never holds one transaction across all events, and partial runs resume
with the same deduplication keys.

## Personal inbox and consent

Inbox has cursor pages of 100 with complete authorized unread counts. Employee sees
self only. Manager-purpose notices require current venue-manager authority and are
hidden after role downgrade. Read and important-change acknowledgment are separate,
idempotent persisted evidence. Acknowledgment requires explicit reviewed confirmation;
it is not automatically inferred from opening a link. Direct links return to scoped
shift/hour/request/leave/month views in the same app.

Consent preferences use expected version and immutable before/after revisions;
a deferred PostgreSQL guard binds the current cursor to consent history. Email/PWA
are off by default, while relevant inbox records persist independently. Reminder lead
is configurable (default 60 minutes). Opting into an external channel does not resend
historical disabled deliveries. Subscriptions are personal, retained/revoked and never
exposed to another worker/manager. Only known HTTPS browser push provider hosts,
no credentials/custom ports/fragments, and bounded browser keys are accepted.

## Durable delivery and recovery

Two worker processes claim `FOR UPDATE SKIP LOCKED` leases (two minutes). The
transaction ends before bounded provider transport. Recipient active membership,
current manager purpose, preference and frozen destination are checked again before
send. Stale reminders/resolved approvals/missing punches are disabled. Missing-punch
jobs emit notices for missing clock-in/out; they never invent attendance or close it.

Immutable attempts retain outcome, sanitized code, provider, lease token and times.
Retry uses 30/120/480/1920-second progression, capped at an hour, with five failed
attempts becoming FAILED. Crash recovery records expired lease uncertainty, advances
attempt identity and rejects stale worker completion. The first attempt starts the
provider deduplication window, not an old event's creation time. Outside 23 hours,
ambiguous retry becomes UNCERTAIN; do not blindly resend without provider review.

Existing Brevo is the email adapter. Immutable notice identity/locale/link/destination
makes its provider idempotency stable across retries. PWA uses Web Push topic/tag plus
opaque notice-ID browser deduplication. External exactly-once delivery cannot be
certified from a successful request; DELIVERED means transport/provider acceptance,
not employee read or acknowledgment. Provider-disabled/no-op is always DISABLED,
never DELIVERED, even if a caller supplied an inconsistent provider-name hint.

Push carries only a generic update, opaque notice ID and authenticated inbox path.
No diagnosis/absence category, work hours, HR term, employee name/email or VAPID key
appears in push content. The push-only service worker does not cache staff pages or
API responses. This is the existing web workspace with an optional manifest, not a
new native app or identity catalog. Real browser/device/provider acceptance is a
separate authorized staging activity; test transports and default-disabled behavior
are not claimed as certified real delivery.

## Configuration and operator command

```dotenv
TRANSACTIONAL_EMAIL_PROVIDER=disabled
WORKFORCE_NOTIFICATION_WORKER_ENABLED=false
WORKFORCE_PUSH_PROVIDER=disabled
WORKFORCE_VAPID_PUBLIC_KEY=
WORKFORCE_VAPID_PRIVATE_KEY=
WORKFORCE_VAPID_SUBJECT=
```

Brevo uses the existing server credentials/sender/origin configuration. Optional
`WORKFORCE_PUSH_PROVIDER=webpush` requires reviewed private server VAPID configuration;
only the public key is disclosed to authenticated staff who opt in. API startup never
starts delivery. After separately authorized environment/provider setup, an operator
may run the existing-workspace command:

```text
npm run workforce:notifications --workspace=@flowgastronomie/api -- --once
```

It requires explicit `WORKFORCE_NOTIFICATION_WORKER_ENABLED=true`; without `--once`
it handles due notices/batches every ten seconds. No deployment, scheduler, key
generation, actual provider call or remote database operation is performed by this PR.
FAILED/UNCERTAIN require operator investigation of sanitized attempts/provider history;
read/ack and normal business approval are not delivery retries or paid activation.

## Database-side unread count

Inbox count uses a parameterized PostgreSQL NOT EXISTS anti-join against read receipts,
with the same tenant, venue, user, membership and current purpose permissions as the
page query. Only the current page (maximum 100) loads receipt/delivery DTOs. Historical
read IDs never enter application memory. Existing scoped notification and unique
notification-receipt indexes support the query; no speculative index or migration is added.
The acceptance fixture checks 10,020 notices and 10,020 receipts, complete stable
pagination, read/ack, role downgrade, revoked membership and unauthorized cursors.
EXPLAIN ANALYZE/BUFFERS evidence is generated with the actual production query.
