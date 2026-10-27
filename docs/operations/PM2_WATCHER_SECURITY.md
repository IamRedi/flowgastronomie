# PM2 development watcher security

PM2 7.0.4 pins Chokidar 3.6.0, which brings the unpatched nested-brace
stack-exhaustion advisory GHSA-vfj7-8cjw-p6xm into development dependencies.
The npm suggested PM2 2.9.3 downgrade is not used.

The PM2-scoped override selects Chokidar 4.0.3, a CommonJS-compatible release
without glob/braces parsing. Other consumers are unaffected. Node 22 meets its
engine requirement. Operations Lab already configures `watch: false` and keeps
that behavior. No application runtime dependency or Production image changes.

Chokidar 4 removed glob expansion: future PM2 watch configurations must use exact
directories/files and regular-expression/function ignores. Do not add PM2 glob
watch or string-glob ignores expecting the Chokidar 3 semantics. The regression
test exercises PM2's actual watcher lifecycle with an exact directory, plus a
bounded nested-brace input. Full Operations Lab background/restart/restore
acceptance remains required before merge.

Validation: `node --test tests/operations/dependency-security.test.mjs`,
`npm run check`, full release CI and Operations Lab. `npm audit --json` must
report zero findings, including development; preserve its timestamp and lockfile
hash in the external audit evidence.

Rollback: revert the dependency/test/documentation commit and run `npm ci` in
the isolated CI/Lab environment. This reinstates the three development findings;
it never changes a Production database, credential or deployed image.

Sources: <https://github.com/advisories/GHSA-vfj7-8cjw-p6xm> and
<https://github.com/paulmillr/chokidar/tree/4.0.3>.
