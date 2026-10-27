# M1 production package

This is the reproducible package for the OVH rollout.
It runs one Node 22 Next.js standalone web image, one Node 22 API image, and
NGINX. PostgreSQL is external Neon. The separate operations image bundles the
existing retention commands and includes the pinned Prisma migration CLI; the
API runtime contains production dependencies only. Domain behavior is unchanged.

M1 listens on **127.0.0.1:8080 over HTTP** for package verification. M2 must add
real HTTPS and validate the internet-facing edge before staff/customer use.
Secure staff/recovery cookies remain enabled by `NODE_ENV=production`; there
is no insecure-cookie override for the local package smoke. This document does
not authorize M2 deployment, tenant creation, fiscal activation or go-live.

## Configuration

Copy `production.env.example` to `/etc/flowgastronomie/production.env` on the
server. It contains variable names only. Keep the populated file root-owned
with mode `0600`, outside the checkout. Do not print `docker compose config`
without `--quiet`, because resolved configuration contains runtime secrets.

| Variable                                                          | Value/behavior                                                                                                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RELEASE_TAG`                                                     | Exact reviewed Git SHA. Retain the prior tagged images for rollback.                                                                                                         |
| `WEB_HOST`, `API_HOST`                                            | Distinct DNS hostnames, without scheme/port. Use sibling hosts under the same registrable domain so `SameSite=Lax` cookies work. M1 does not configure custom venue domains. |
| `WEB_ORIGIN`                                                      | Exact public HTTPS web origin for credentialed CORS, recovery/SSE requests and invitation/order links.                                                                       |
| `NEXT_PUBLIC_API_URL`                                             | Exact public HTTPS API origin. This is the only public build argument; changing it requires a web rebuild.                                                                   |
| `DATABASE_URL`                                                    | Neon pooled application connection with TLS, scoped database role and bounded connection count. Server-side API and retention only.                                          |
| `DATABASE_URL_DIRECT`                                             | Direct, unpooled Neon connection with TLS for migrations and `pg_dump`. Use a plain libpq-compatible URI without Prisma-only options such as `connection_limit`.             |
| `PROXY_HTTP_PORT`                                                 | Optional loopback HTTP port; `8080` by default.                                                                                                                              |
| `READINESS_TIMEOUT_MS`                                            | Optional; `2000` by default.                                                                                                                                                 |
| `TRANSACTIONAL_EMAIL_PROVIDER`                                    | Explicit `brevo` or `disabled`. Disabled is a staging non-delivery choice, not evidence of working notifications.                                                            |
| `BREVO_API_KEY`, `TRANSACTIONAL_EMAIL_FROM_ADDRESS`               | Required for Brevo; runtime API secrets/configuration only.                                                                                                                  |
| `TRANSACTIONAL_EMAIL_FROM_NAME`, `TRANSACTIONAL_EMAIL_TIMEOUT_MS` | Optional display name and bounded delivery deadline.                                                                                                                         |
| `HARDWARE_COMMAND_PRIVATE_KEY_BASE64`                             | Server-only command signer when physical hardware is enabled at M4. Simulator is always disabled in this package.                                                            |
| `BACKUP_DIRECTORY`                                                | Absolute protected host directory, initially `/var/backups/flowgastronomie`; root-owned mode `0700`.                                                                         |

Compose sets `API_URL=http://api:4000` only inside the web container. API and web
have no published host ports. The dedicated bridge is `172.30.42.0/28`; automatic
allocation uses `172.30.42.8/29`, leaving the proxy address reserved. NGINX
has address `172.30.42.2`, which is the API's only trusted proxy. If this subnet
conflicts with the host network, change the subnet, proxy IP and `TRUST_PROXY`
together, then repeat the package gate. Client forwarding headers are replaced
at this edge. M2 must re-verify client-IP forwarding when introducing HTTPS.

The API retains its current `/health` liveness and `/ready` database-readiness
contracts. Compose waits for readiness before starting the web/proxy. Failed
readiness marks the API unhealthy without automatically restarting it for a
database outage; process exits are restarted with `unless-stopped`. Logs rotate
at three 10 MB files per service. Proxy access logs omit URLs, queries and cookies.
NGINX forwards SSE without buffering/cache/gzip and has 75-second stream timeouts.

## M1 gate on a development/review machine

Prerequisites: Node 22+, Docker Engine/Desktop and Compose v2 supporting
`up --wait`, sufficient disk for the four package images, and the normal npm install.

```bash
npm ci
npm run db:generate
npm run test:production-package
npm run check
```

The package gate copies Git source files and the pending review diff into a
temporary clean directory, excluding local dependencies/builds/environment.
Docker builds the application/operations images using lockfile dependencies and
the PostgreSQL 17 backup-client image. Only its disposable
test override starts PostgreSQL 17; **production Compose never starts Postgres**.
The gate migrates the empty target, repeats migration to verify retry safety,
starts all services, checks proxied `/health` and `/ready`, loads the proxied web,
and proves the web container reaches the internal API. It also runs packaged
retention/check and validates a custom-format logical backup. No data is seeded.

Secret canaries in excluded environment/private-key files and the runtime-only
test database credential must be absent from final image files, image metadata
and build history. `.dockerignore` allows only named build inputs; no secrets
are accepted as build arguments. API runtime also rejects bundled dev tooling.
Evidence is written to `artifacts/m1-package-gate.json`; the temporary database,
containers, network, dumps and source directory are removed even on failure.
Tagged test images remain locally available for inspection.

The local PostgreSQL gate proves packaging/migrations. The dedicated Neon staging
branch, HTTPS/SSE, reboot behavior, alerting and restore rehearsal belong to M2.
Stop for review after the package gate and `npm run check` are green.

## Minimal host bootstrap (execute during M2)

Use the approved Ubuntu LTS VPS and a named operator with SSH-key access. First
verify a second key-authenticated SSH session and sudo access. Then configure
an SSH drop-in with `PasswordAuthentication no`, `KbdInteractiveAuthentication no`
and `PermitRootLogin no`; run `sudo sshd -t` before `sudo systemctl reload ssh`.
Keep the verified session open until a new session succeeds.

Install Docker Engine and the Compose plugin using the
[official Ubuntu installation procedure](https://docs.docker.com/engine/install/ubuntu/),
then enable Docker at boot. Keep Docker administration restricted to trusted
operators; scheduled jobs use root rather than granting broad Docker access.

```bash
sudo systemctl enable --now docker
sudo apt-get update
sudo apt-get install -y ufw unattended-upgrades
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo dpkg-reconfigure -plow unattended-upgrades
sudo systemctl enable --now apt-daily.timer apt-daily-upgrade.timer
sudo install -d -m 0700 /etc/flowgastronomie /var/backups/flowgastronomie
sudo install -d -m 0755 /opt/flowgastronomie/releases
```

Confirm the generated APT periodic configuration enables unattended security
upgrades; coordinate reboot handling with the staging rehearsal. Publish only
the intended HTTPS/HTTP edge during M2. Docker-published ports bypass some UFW
rules, so never publish API, web or database ports. M1's proxy port is loopback-only.

Create a reviewed release checkout under
`/opt/flowgastronomie/releases/REVIEWED_SHA` and point
`/opt/flowgastronomie/current` at it. Populate the protected environment file
using `sudoedit`; set its permissions with `sudo chmod 0600`.

## Bootstrap, update and compatible rollback

Run from `/opt/flowgastronomie/current` as a trusted Docker operator. Every command
uses the same explicit configuration and Compose project name, independent of
which release directory the symlink selects:

```bash
docker compose --env-file /etc/flowgastronomie/production.env -f compose.production.yaml config --quiet
docker compose --env-file /etc/flowgastronomie/production.env -f compose.production.yaml --profile operations build api web migrate backup
docker compose --env-file /etc/flowgastronomie/production.env -f compose.production.yaml --profile operations run --rm --no-deps migrate
docker compose --env-file /etc/flowgastronomie/production.env -f compose.production.yaml up -d --wait api web proxy
```

For an update: record the current release SHA and migration status, stop the two
job timers, run a fresh backup from the current release, create a detached
checkout for the reviewed new SHA with `git worktree add --detach`, and change
the `current` symlink and `RELEASE_TAG` together. Build, apply migrations once,
start the stack, and verify health/readiness through the proxy using the API
Host header plus the web response using the web Host header. Re-enable timers
and observe errors before recording completion. Never seed pilot/demo identities.

```bash
sudo systemctl stop flowgastronomie-backup.timer flowgastronomie-retention.timer
sudo sh /opt/flowgastronomie/current/infra/production/host-job.sh backup
git fetch origin
git worktree add --detach /opt/flowgastronomie/releases/REVIEWED_NEW_SHA REVIEWED_NEW_SHA
sudo ln -sfn /opt/flowgastronomie/releases/REVIEWED_NEW_SHA /opt/flowgastronomie/current
sudoedit /etc/flowgastronomie/production.env
# Change RELEASE_TAG to REVIEWED_NEW_SHA, then run the four package commands above.
sudo systemctl start flowgastronomie-backup.timer flowgastronomie-retention.timer
```

Rollback is allowed only when the previous app image is compatible with the
applied schema. Point `current` back to the retained checkout, restore its
`RELEASE_TAG` and public-origin settings in the protected file, then use the
following commands; never automatically reverse migrations:

```bash
sudo ln -sfn /opt/flowgastronomie/releases/PREVIOUS_SHA /opt/flowgastronomie/current
sudoedit /etc/flowgastronomie/production.env
docker compose --env-file /etc/flowgastronomie/production.env -f compose.production.yaml up -d --no-build --wait api web proxy
sudo systemctl start flowgastronomie-backup.timer flowgastronomie-retention.timer
```

If schema compatibility fails, stop writes and follow the separate
[restore procedure](PRODUCTION_RUNBOOK.md#restore-rehearsal) into a new database.
Do not restore a dump over the live target or remove retained release images
until the observation/rollback window closes.

## Nightly jobs and backup retention

Install the checked-in units during M2; no schedule runs in the API process:

```bash
sudo install -m 0644 infra/production/flowgastronomie-*.service /etc/systemd/system/
sudo install -m 0644 infra/production/flowgastronomie-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now flowgastronomie-backup.timer flowgastronomie-retention.timer
sudo systemctl start flowgastronomie-backup.service
sudo systemctl start flowgastronomie-retention.service
sudo systemctl list-timers 'flowgastronomie-*'
```

Backup runs at 02:00 UTC and retention at 03:00 UTC, with a small randomized delay
and catch-up after downtime. Each job is overlap-locked; retention must succeed
before its freshness check runs. Non-zero exit marks the systemd unit failed.
Monitor failed jobs, backup age over 26 hours and retention freshness before
allowing real venue data; wire the alerts during M2.

The backup client uses PostgreSQL 17 `pg_dump`; a small Python URI adapter supplies
libpq environment defaults and a temporary `0600` password file. The direct URI
is supplied only at runtime, never in command arguments. TLS defaults to required;
the disposable local gate explicitly disables it. Supported URI options are
`sslmode`, `channel_binding`, `connect_timeout`, `application_name`, `sslrootcert`
and `options`; unsupported options fail without logging credentials. Files are
custom-format, `0600`, verified
with `pg_restore --list`, and receive a SHA-256 sidecar. Failed partial dumps are
removed and do not trigger pruning. Completed copies older than seven days are
removed only after a successful backup. Set up the OVH VPS backup to capture this
protected directory too; the VPS copy alone is not an independent restore proof.
Verify a real Neon restore into an empty dedicated branch during M2. Size the
directory and adjust retention from measured data before go-live.

The package follows [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output),
[Docker build inputs](https://docs.docker.com/build/concepts/context/#dockerignore-files)
and [Neon direct/pooler connection guidance](https://neon.com/docs/connect/connection-pooling).
