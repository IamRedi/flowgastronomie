#!/bin/sh
# Standalone backup service; activation requires explicit protected configuration.
set -eu
umask 077
[ "${FLOW_R2_OWNER_AUTHORIZED:-}" = 1 ] || {
    echo 'R2 activation is not authorized/configured' >&2
    exit 1
}
: "${FLOW_R2_BUNDLE_DIRECTORY:?Protected backup directory required}"
: "${FLOW_R2_RECIPIENTS:?Two public recipients file required}"
: "${FLOW_R2_BUDGET:?Fresh shared-account usage observation required}"
: "${FLOW_R2_ENDPOINT:?EU endpoint required}"
: "${FLOW_R2_WEEKLY_STATE:?Protected weekly receipt state path required}"
: "${FLOW_HEALTHCHECKS_URL:?External monitor required}"
: "${FLOW_R2_ANALYTICS_CREDENTIAL:?Protected read-only analytics credential required}"
: "${FLOW_R2_MONITOR_CREDENTIAL:?Protected monitor JSON required}"
: "${FLOW_R2_OBJECT_CREDENTIAL:?Protected bucket-only credential required}"
: "${FLOW_R2_RECOVERY_GATE:?Real recovery acceptance file required}"
: "${FLOW_R2_RETENTION_REPORT:?Protected retention report path required}"
: "${FLOW_R2_EXPECTED_BACKUP_BYTES:?Conservative next backup size required}"
: "${FLOW_R2_CODE_DIRECTORY:?Pinned standalone backup release directory required}"
: "${FLOW_R2_UPLOAD_PROOF:?Durable remote verification proof required}"
release=$FLOW_R2_CODE_DIRECTORY
bucket=${FLOW_R2_BUCKET:-flowgastronomie-staging-backups}
case "$bucket" in flowgastronomie-staging-backups|flowgastronomie-production-backups) ;; *) exit 1 ;; esac
compose=${FLOW_R2_COMPOSE_WRAPPER:-/opt/flowgastronomie/current/infra/staging/compose.sh}
scope=${FLOW_R2_JOB_SCOPE:-staging}
case "$scope:$bucket" in staging:flowgastronomie-staging-backups|production:flowgastronomie-production-backups) ;; *) exit 1 ;; esac
case "$scope" in staging) lock=/run/lock/flowgastronomie-backup.lock ;; production) lock=/run/lock/flowgastronomie-public-backup.lock ;; *) exit 1 ;; esac
exec 9>"$lock"
flock -n 9 || exit 1
marker=
finish() {
    result=$?
    trap - EXIT
    [ -z "$marker" ] || rm -f "$marker"
    if [ "$result" -ne 0 ]; then
        python3 -c 'import os,sys; sys.path.insert(0,sys.argv[1]); from r2_backup import ping; ping(os.environ["FLOW_HEALTHCHECKS_URL"],False)' \
            "$release/infra/staging" 2>/dev/null || true
    fi
    exit "$result"
}
trap finish EXIT
python3 -c 'import json,sys; g=json.load(open(sys.argv[1])); sys.exit(0 if all(g.get(k)=="PASS" for k in ("primary","recovery","postgresRestore","mediaSHA256","bucketLocks")) else 1)' \
    "$FLOW_R2_RECOVERY_GATE"
python3 -c 'import os,sys; sys.path.insert(0,sys.argv[1]); from r2_backup import ping; ping(os.environ["FLOW_HEALTHCHECKS_URL"],"start")' "$release/infra/staging"
python3 "$release/infra/staging/r2_usage.py" \
    --credential "$FLOW_R2_ANALYTICS_CREDENTIAL" --output "$FLOW_R2_BUDGET" \
    --expected-bucket eu_flowgastronomie-staging-backups \
    --expected-bucket eu_businesssite-rc-recovery-backups \
    --expected-bucket "eu_$bucket" \
    --next-backup-bytes "$FLOW_R2_EXPECTED_BACKUP_BYTES" \
    --failure-monitor-credential "$FLOW_R2_MONITOR_CREDENTIAL"
# Reserve space BEFORE making another local dump. Never free space by deleting
# unverified backups. This uses the same conservative operator size estimate.
python3 -c 'import sys; sys.path.insert(0,sys.argv[1]); from r2_backup import disk_guard; disk_guard(sys.argv[2],int(sys.argv[3]))' \
    "$release/infra/staging" "$FLOW_R2_BUNDLE_DIRECTORY" "$FLOW_R2_EXPECTED_BACKUP_BYTES"
marker=$(mktemp)
# The lock covers local dump, remote verification and weekly state commit.
# Do not call host-job.sh here: it would acquire the same lock recursively.
if ! sh "$compose" --profile operations run \
    --rm --no-deps -v "$release/infra/production/backup.sh:/opt/backup.sh:ro" backup; then
    python3 -c 'import os,sys; sys.path.insert(0,sys.argv[1]); from r2_backup import ping; ping(os.environ["FLOW_HEALTHCHECKS_URL"],False)' \
        "$release/infra/staging" 2>/dev/null || true
    echo 'Local backup failed; no R2 success and no pruning' >&2
    exit 1
fi
# Exactly one new completed bundle must have been produced by this locked run.
stem=$(python3 -c 'import pathlib,sys; m=pathlib.Path(sys.argv[1]).stat().st_mtime_ns; p=[p.stem for p in pathlib.Path(sys.argv[2]).glob("flowgastronomie-*.complete") if p.stat().st_mtime_ns>=m]; sys.exit(1) if len(p)!=1 else print(p[0])' \
    "$marker" "$FLOW_R2_BUNDLE_DIRECTORY")
week=$(python3 -c 'import datetime as d; n=d.datetime.now(d.timezone.utc).date(); print(n-d.timedelta(days=(n.weekday()+1)%7))')
previous=$(cat "$FLOW_R2_WEEKLY_STATE" 2>/dev/null || true)
weekly=
[ "$previous" = "$week" ] || weekly=--weekly-due
python3 "$release/infra/staging/r2_backup.py" \
    --bundle-directory "$FLOW_R2_BUNDLE_DIRECTORY" --stem "$stem" \
    --recipients "$FLOW_R2_RECIPIENTS" --budget-observation "$FLOW_R2_BUDGET" \
    --eu-endpoint "$FLOW_R2_ENDPOINT" ${weekly:+$weekly} --execute-authorized-upload \
    --credential "$FLOW_R2_OBJECT_CREDENTIAL" --proof-output "$FLOW_R2_UPLOAD_PROOF" --defer-success
if [ -n "$weekly" ]; then
    printf '%s\n' "$week" >"${FLOW_R2_WEEKLY_STATE}.partial"
    mv "${FLOW_R2_WEEKLY_STATE}.partial" "$FLOW_R2_WEEKLY_STATE"
fi
# Actual executor refuses any deletion unless the real recovery gate is complete.
# It runs under the SAME lock as dump/upload. No independent pruning timer.
if ! python3 "$release/infra/staging/r2_retention.py" \
    --credential "$FLOW_R2_OBJECT_CREDENTIAL" --recovery-gate "$FLOW_R2_RECOVERY_GATE" \
    --output "$FLOW_R2_RETENTION_REPORT" --execute; then
    python3 -c 'import os,sys; sys.path.insert(0,sys.argv[1]); from r2_backup import ping; ping(os.environ["FLOW_HEALTHCHECKS_URL"],False)' \
        "$release/infra/staging" 2>/dev/null || true
    exit 1
fi
# No local deletion: keep local archives until a separately reviewed, digest-bound
# local pruning policy exists. Disk reserve failure blocks/alerts instead.
python3 -c 'import os,sys; sys.path.insert(0,sys.argv[1]); from r2_backup import ping; ping(os.environ["FLOW_HEALTHCHECKS_URL"],True)' "$release/infra/staging"
echo 'R2 automatic cycle PASS: remote SHA256, retention and Healthchecks acknowledged'
