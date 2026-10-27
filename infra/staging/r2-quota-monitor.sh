#!/bin/sh
# Independent read-only account telemetry and local capacity monitor.
set -eu
umask 077
code=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
failed() {
    result=$?
    trap - EXIT
    if [ "$result" -ne 0 ]; then
        python3 -c 'import json,sys; sys.path.insert(0,sys.argv[1]); from r2_backup import ping; ping(json.load(open("/etc/flowgastronomie/r2/monitor.json"))["backup"],False)' "$code" 2>/dev/null || true
    fi
    exit "$result"
}
trap failed EXIT
python3 "$code/r2-disk-monitor.py"
exec python3 "$code/r2_usage.py" \
    --credential /etc/flowgastronomie/r2/analytics.json \
    --output /var/lib/flowgastronomie/r2-monitor/usage.json \
    --expected-bucket eu_flowgastronomie-staging-backups \
    --expected-bucket eu_businesssite-rc-recovery-backups \
    --next-backup-bytes 1048576 \
    --failure-monitor-credential /etc/flowgastronomie/r2/monitor.json
