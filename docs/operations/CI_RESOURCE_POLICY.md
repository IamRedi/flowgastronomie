# CI resource policy — 18 October 2026

The account reached its included 2,000 Actions minutes and 0.5 GB storage.
The repository has 139 retained artifacts totalling 6,087,005,915 bytes in the
18 October API inventory. Most large evidence archives use the inherited
90-day retention. This is retained artifact size, not billed GB-hours.

## Bounded change

CI and Operations Lab cancel obsolete pull-request runs when a new commit is
pushed to the same PR. Separate workflows and PRs have separate groups. Main
pushes and manual Lab runs never cancel an in-progress run through this policy.
All release, database, browser, restore and Lab steps remain required.

New evidence artifacts have a seven-day retention. Existing artifacts retain
their existing expiry dates; this change does not delete them or recover the
already consumed monthly minutes. Preserve release evidence independently
before an explicitly approved deletion of historical artifacts.

No path filters, test skips, runner routing, backup schedules, branch protection
or application deployment are changed. Seven-day retention reduces the window
for future transient evidence; selected release evidence must be retained in
the existing private evidence archive when needed beyond that window.

## Runner decision

CI runs only on GitHub-hosted runners. A public repository must never route
jobs to a self-hosted runner, because pull requests could execute code on it.

## Rollback and validation

Revert the two workflow changes to remove concurrency and restore inherited
retention for future uploads. Existing archives remain unaffected either way.
Validation must parse both YAML files, compare all job steps/services/triggers
with the baseline and confirm that the only execution delta is concurrency.
Remote CI remains quota-blocked until actual execution proves otherwise.

## Phase 2 checkpoint — 19 October 2026

The earlier quota-blocked statement is historical. PR34 was merged after CI
39170266701 and Operations Lab39170266702 passed on its exact source tree.
Post-merge main CI39174046843 exposed two PostgreSQL integration tests exceeding
their existing five-second deadline, followed by a cleanup FK error. This
checkpoint does not relabel that run as successful.

General CI explicitly uses one Vitest worker and a bounded 512MiB tmpfs for its
disposable PostgreSQL17 data directory, within the existing 1GiB container cap.
All 70 database integration tests passed on a fresh synthetic fixture on the CI
VM with original deadlines (11.99 seconds total command). A controlled probe of
100 commits measured 0.378s on disk versus 0.088s on tmpfs; these are samples,
not an application performance or availability guarantee.

No assertion, security check, test selection or deadline is removed. PostgreSQL
fsync and synchronous_commit retain their defaults. Only the per-job synthetic
fixture uses tmpfs. Lab persistent/replay volumes, encrypted recovery storage
and hosted databases remain unchanged. The fixture is discarded after its job
by design; it must never contain operational data.

Full exact-head CI remains required. Rollback removes the tmpfs option and the
worker override. Job hooks still serialize heavy work across both repositories.
