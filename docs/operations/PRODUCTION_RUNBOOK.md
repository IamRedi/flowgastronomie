# FlowGastronomie production runbook

## Status and target

For the approved OVH VPS + Neon package, use the concrete
[M1 package runbook](OVH_PRODUCTION_PACKAGE.md) and
milestone rollout. The release, restore and alert
contracts below still apply; M1 package verification does not declare go-live.

This runbook describes the Commercial V1 pilot deployment baseline. It does not
declare the product production-ready; the release gate in the Commercial V1
roadmap still applies.

The supported shape is one Next.js web process, one Fastify API process, and a
managed PostgreSQL 17 database. Terminate TLS at the hosting platform or reverse
proxy. Web and API may use separate hosts, but the API must allow exactly the
public web origin and both must use HTTPS in production.

## Production environment

Set secrets in the hosting platform, never in a committed file.

| Variable                           | Process               | Requirement                                                                                                                     |
| ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                         | web, API              | Must be `production`; this enables secure staff cookies.                                                                        |
| `DATABASE_URL`                     | API                   | PostgreSQL connection string with provider-required TLS and a least-privilege application user. Never expose it to the browser. |
| `API_PORT`                         | API                   | Internal listen port; defaults to `4000`.                                                                                       |
| `WEB_ORIGIN`                       | API                   | Exact HTTPS web origin, with no wildcard, for credentialed CORS and secure links in transactional email.                        |
| `NEXT_PUBLIC_API_URL`              | web build and runtime | Public HTTPS API origin. It is embedded in browser assets and is not a secret.                                                  |
| `API_URL`                          | web runtime           | Server-side API origin; use an internal address when the platform provides one.                                                 |
| `PORT`                             | web runtime           | Next.js listen port; defaults to `3000`.                                                                                        |
| `TRUST_PROXY`                      | API                   | Exact comma-separated proxy IPs/CIDRs, or `disabled` for direct traffic. Required explicitly in production; never use `true`.   |
| `READINESS_TIMEOUT_MS`             | API                   | Maximum database readiness response time from `100` to `30000` ms; defaults to `2000`.                                          |
| `TRANSACTIONAL_EMAIL_PROVIDER`     | API                   | Set explicitly. Use `brevo` for pilot delivery; `disabled` is only an explicit non-delivery mode.                               |
| `BREVO_API_KEY`                    | API                   | Secret, scoped production API key. Required only when the provider is `brevo`; never expose or log it.                          |
| `TRANSACTIONAL_EMAIL_FROM_ADDRESS` | API                   | Authenticated sender address on the production domain.                                                                          |
| `TRANSACTIONAL_EMAIL_FROM_NAME`    | API                   | Sender display name; defaults to `FlowGastronomie`.                                                                             |
| `TRANSACTIONAL_EMAIL_TIMEOUT_MS`   | API                   | Total bounded delivery window from `500` to `30000` ms; defaults to `5000`.                                                     |

## Transactional email

The pilot adapter sends invitation, order-received, and order-status email
through Brevo's HTTPS API after the business mutation commits. Templates are
rendered by the API in English, German, Italian, and Albanian. Identical events
carry a SHA-256-derived idempotency key; retryable network, rate-limit, and
provider failures retry inside one bounded delivery window. Errors expose only
the provider, HTTP status, and short provider code, never recipient addresses,
message bodies, API keys, invitation tokens, or tracking tokens. Delivery
failure is logged but cannot roll back the committed operation.

Before enabling `brevo` in production:

1. Complete the account data-processing agreement and access review.
2. Authenticate the dedicated sender domain in Brevo and verify SPF/DKIM/DMARC
   alignment. Do not use an unverified personal sender.
3. Store the API key and sender values in the hosting secret store, then restart
   the API. Missing or invalid configuration fails at startup; production also
   rejects an omitted provider selection.
4. Send and retain one controlled invitation and order journey in each locale.
   Verify the sender, links, mobile rendering, plain-text fallback, provider
   delivery event, and that no duplicate arrives on an idempotent retry.
5. Alert on repeated
   `Transactional notification delivery failed after commit` log events and on
   Brevo bounce/block-rate degradation. Disable advertised email behavior if
   delivery cannot be trusted.

Brevo's current send contract and idempotency header are documented in its
[transactional email API](https://developers.brevo.com/reference/send-transac-email).
The EU pilot choice also depends on Brevo's documented
[EU data-storage locations](https://help.brevo.com/hc/en-us/articles/360001005510-Data-storage-location),
which must be reconfirmed during the vendor review. The direct adapter is the
pilot baseline, not a durable queue: add a database outbox and worker before
delivery volume or recovery requirements outgrow the bounded request-time send.

## Unauthenticated rate limiting and proxy trust

The API uses `@fastify/rate-limit` with normalized client IPs and separate
in-memory budgets for unauthenticated workload groups:

| Group                                    | Limit          |
| ---------------------------------------- | -------------- |
| Public content, menus, assets, demo read | 600/minute     |
| Private online-order tracking/SSE        | 180/minute     |
| Online-order submission                  | 30/10 minutes  |
| Online-order guest messages              | 60/10 minutes  |
| QR session creation                      | 120/10 minutes |
| Table-order submission                   | 120/10 minutes |
| Table service requests                   | 180/10 minutes |
| Trial registration                       | 5/hour         |
| Staff login                              | 30/15 minutes  |
| Invitation acceptance                    | 10/hour        |
| Demo mutations                           | 60/10 minutes  |

Exceeded requests return `429`, `RATE_LIMIT_EXCEEDED`, the standard
`X-RateLimit-*` fields, and `Retry-After`. They also emit
`Unauthenticated request rate limit exceeded` with method and route but without
tokens or credentials. Alert on sustained events by route and correlate them
with edge/proxy traffic; do not log raw QR, guest, invitation, or tracking
tokens as metric labels.

`TRUST_PROXY` controls whether Fastify may derive the client address from
forwarding headers. For a directly exposed API, use `disabled`. Behind a proxy,
list only the exact proxy source addresses or CIDRs supplied by the selected
hosting platform, for example `127.0.0.1,10.20.0.0/24`; never set `true` or copy
an unverified broad network. Confirm with a production smoke that two controlled
forwarded client IPs receive independent budgets and an untrusted direct request
cannot spoof `X-Forwarded-For`.

The release topology supports one API process, so the bounded in-memory store is
intentional. A restart resets counters. Before horizontal scaling, configure
and test the plugin's shared Redis store, failure behavior, namespace, latency,
and alerts. The official plugin documents both standard response headers and
the shared-store requirement in its
[Fastify rate-limit guide](https://github.com/fastify/fastify-rate-limit).

## Pre-deployment gate

From a clean checkout of the exact revision being released:

```bash
npm ci
npm run db:generate
npm run check
npx dotenv -e .env -- npm run test:integration
npx dotenv -e .env -- prisma migrate status --schema packages/database/prisma/schema.prisma
```

CI must pass against PostgreSQL before promotion. Build
`NEXT_PUBLIC_API_URL` into the web artifact for the target environment; changing
it later requires rebuilding the web application.

## Deployment and migrations

1. Record the commit SHA, operator, start time, and target environment.
2. Confirm the latest successful backup and take a fresh pre-migration backup.
3. Put the database provider's connection-pool and storage alerts in a healthy
   state before changing schema.
4. Apply committed migrations once from a dedicated release job:

   ```bash
   npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
   ```

5. Start or roll the API, then the web process. Never run `prisma migrate dev`
   or seed data in production.
6. Configure `GET /health` as process liveness and `GET /ready` as the traffic
   readiness check. Verify both through the production proxy, then verify one
   public venue page, staff login, a tenant-scoped staff read, and an SSE
   connection.
7. Watch error rate, latency, database connections, and SSE disconnects during
   the initial observation window before declaring the deployment complete.

Migrations are forward-only. Do not edit a migration that has run anywhere. If
an application rollback remains compatible with the migrated schema, roll the
processes back to the previous artifact. Otherwise stop writes, restore into a
new database, verify it, and switch the connection explicitly. Never improvise
a destructive schema rollback on the live database.

## Backup

For the pilot baseline, take a managed-provider snapshot or a PostgreSQL custom
dump at least daily and immediately before every migration. Define the actual
retention, encryption, region, RPO, and RTO with the hosting provider before a
venue goes live.

Example logical backup, run from a secured operator host:

```bash
backup_file="flowgastronomie-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --no-acl --file="$backup_file" "$DATABASE_URL"
pg_restore --list "$backup_file" >/dev/null
```

Store the dump in encrypted, access-controlled storage separate from the
database account. Capture its checksum, PostgreSQL version, schema migration,
timestamp, and operator. A dump is not considered usable until a restore
rehearsal succeeds.

## Restore rehearsal

Restore only into a newly created, empty database identified by an explicit
`RESTORE_DATABASE_URL`; never point this variable at production.

```bash
pg_restore --exit-on-error --no-owner --no-acl \
  --dbname="$RESTORE_DATABASE_URL" flowgastronomie-UTC_TIMESTAMP.dump
DATABASE_URL="$RESTORE_DATABASE_URL" \
  npx prisma migrate status --schema packages/database/prisma/schema.prisma
```

Then start an isolated API against the restored database and verify liveness,
database readiness, staff authentication, tenant-scoped order reads, public
menu access, and row counts for key venue/order tables. Record duration and
result. Rehearse at least before the first pilot and after material schema or
provider changes.

The repository automates that baseline against a temporary, memory-only
PostgreSQL 17 Compose target on port `55432`:

```bash
npm run test:backup-restore
```

The command refuses an identical source and target identity, creates and
validates a custom-format archive, restores it with `--exit-on-error`, confirms
the committed migration status, compares tenant, venue, product, table-order,
online-order, and audit-event counts, then starts an isolated API for liveness,
database readiness, staff login, workspace, tenant-scoped online-order, and
Albanian public-menu checks. It prints one JSON evidence record containing the
UTC timestamp, archive size and SHA-256 checksum, counts, checks, duration, and
result. The archive and target are removed in cleanup; CI retains the evidence
in the job log.

The first recorded repository rehearsal completed on 2026-08-09 using
`postgres:17-alpine`: the 169,330-byte archive had SHA-256
`2e5480b048ea681b28e2d4f6945ff661ecd56695a4efde5132ea8673f97c5880`, all
committed migrations were present, all key counts matched, and all five API
checks passed in 6,782 ms. This local/CI rehearsal proves the procedure and does
not replace the required managed-provider rehearsal before the first live pilot.

After database readiness was added, the rehearsal was repeated on 2026-08-09.
The 173,842-byte archive had SHA-256
`ef64a5d89332c4f94b869f0b4f649d2d30c8e7aa79647f707e62efc0000ac074`;
all key counts matched and all six API checks, including `/ready` against the
restored database, passed in 6,443 ms.

## Logging and alerts

The API writes structured JSON logs to stdout; the platform must collect them
centrally with timestamp, level, request ID, service, environment, and release
SHA. PostgreSQL emits errors only in production. Do not log passwords, session
cookies, invitation/tracking/QR tokens, database URLs, payment details, or
unnecessary guest PII.

## Scheduled retention job

Before enabling contact-bearing reservations or online ordering for a live
venue, configure one daily scheduler in the API worker environment:

```bash
npm run retention:run --workspace=@flowgastronomie/database
npm run retention:check --workspace=@flowgastronomie/database
```

Run the health check after each daily command and at least every 24 hours. Its
non-zero exit indicates that no successful `RetentionRun` exists within the
previous 48 hours and must trigger the documented job-failure Page alert. Keep
only its aggregate JSON output in the job log. Before release, retain one
successful run and check record, and confirm that an active targeted legal hold
does not stop redaction for unrelated records.

### Probe contract

`GET /health` returns `200` when the API event loop can serve a request. It does
not touch PostgreSQL and must be used for process liveness, not traffic
readiness. `GET /ready` runs `SELECT 1` through the shared Prisma pool within
`READINESS_TIMEOUT_MS` and sets `Cache-Control: no-store`:

- `200 {"status":"ready","checks":{"database":"ok"}}` means traffic may
  be routed to the instance;
- `503 {"status":"not_ready","checks":{"database":"unavailable"}}` means
  stop new traffic but do not restart the process solely for this dependency
  failure.

Parallel readiness requests share one active query so a slow database cannot
create a probe-driven query storm. The API logs `Database readiness check
failed` with only the check name; it never serializes the underlying Prisma
error or connection information. Probe every 10 seconds, use a two-second
request timeout, and remove traffic after two consecutive failures. Require two
consecutive successes before restoring traffic where the hosting platform
supports separate thresholds.

### Pilot alert policy

Create these rules in the selected hosting and managed-PostgreSQL platforms:

| Signal                              | Pilot threshold                     | Severity |
| ----------------------------------- | ----------------------------------- | -------- |
| External API liveness               | 2 failures within 1 minute          | Page     |
| API readiness                       | 2 consecutive `503` responses       | Page     |
| HTTP 5xx rate                       | ≥5% and ≥20 requests over 5 minutes | Page     |
| API p95 response latency            | >2 seconds for 10 minutes           | Warn     |
| Database connection utilization     | >80% for 10 minutes                 | Warn     |
| Database connection utilization     | >90% for 5 minutes                  | Page     |
| Database remaining storage          | <20%                                | Warn     |
| Database remaining storage          | <10%                                | Page     |
| Transactional notification failures | ≥3 over 10 minutes                  | Warn     |
| SSE refresh failures                | ≥5 over 5 minutes                   | Warn     |
| Unauthenticated rate-limit events   | ≥30 on one route over 5 minutes     | Warn     |
| Migration, backup, or restore job   | Any failed scheduled/release run    | Page     |
| Backup freshness                    | No successful backup for 26 hours   | Page     |

Tune traffic-based thresholds after the first pilot week, but never disable
liveness, readiness, database saturation/storage, or backup-freshness alerts.
Route Page alerts to the named on-call person plus a fallback destination; route
Warn alerts to the operational channel. Before release, trigger one synthetic
Warn and one synthetic Page, acknowledge them, and record provider, rule ID,
UTC timestamps, recipients, delivery latency, operator, and release SHA in the
release record.

Also alert on:

- API unavailability or sustained HTTP 5xx responses;
- migration failure, database connection exhaustion, low storage, or replica
  lag when replicas are used;
- repeated `Transactional notification delivery failed after commit` events;
- repeated `SSE refresh failed` events or abnormal reconnect volume;
- authentication spikes, rate-limit spikes, and
  backup or scheduled restore failures.

## Reverse proxy requirements for SSE

Forward cookies and preserve credentialed CORS. Disable response buffering and
compression transformations for `text/event-stream`, keep connections open for
at least 60 seconds, and do not cache stream responses. The API emits
heartbeats, reconnect hints, and `X-Accel-Buffering: no`; the proxy must honor
equivalent behavior. Clients temporarily use scoped HTTP polling while the
stream reconnects.

The repository includes a pinned NGINX reference configuration at
`infra/nginx/sse-smoke.conf`. It is an executable compatibility baseline, not a
requirement that the final hosting provider use NGINX. With migrated and seeded
local PostgreSQL data, run:

```bash
npm run test:sse-proxy
```

The test starts an isolated API on port `4200` and the Compose `sse-smoke`
profile on port `4280`. It verifies that the first event and reconnect hint pass
without buffering, aborts and reconnects the client, deactivates the authenticated
membership, observes the stream close within eight seconds, and requires `401`
from a reconnect using that now-invalid scope. Cleanup restores the membership,
revokes the created session, stops the proxy, and stops the isolated API. CI
retains the structured result in its job log as release evidence.

## Incident sequence

1. Identify affected tenant/venue and release without placing credentials or
   guest PII in the incident channel.
2. Stop or restrict the failing entry point if continued writes threaten data
   integrity; do not delete evidence.
3. Check API logs, database health, migration status, and external-provider
   status.
4. Prefer a compatible application rollback or feature disablement. Restore
   data only after confirming corruption or loss and selecting an exact backup.
5. Verify tenant isolation and core guest/staff paths after recovery.
6. Record timeline, impact, data handling, corrective action, and follow-up
   tests. Escalate legal/privacy obligations through the responsible operator.

## Release record

For every production change retain: commit SHA, migration list, environment,
operator, backup identifier/checksum, gate results, start/end time, smoke-test
results, observed errors, rollback decision, and final status.
