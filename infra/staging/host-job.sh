#!/bin/sh
set -eu
umask 077
case "${1:-}" in
    backup) services="backup" ;;
    retention) services="retention retention-check" ;;
    *) echo 'Usage: host-job.sh backup|retention' >&2; exit 2 ;;
esac
# Same lock names as M1: manual and scheduled invocations cannot overlap.
exec 9>"/run/lock/flowgastronomie-${1}.lock"
flock -n 9 || exit 1
for service in $services; do
    sh /opt/flowgastronomie/current/infra/staging/compose.sh \
        --profile operations run --rm --no-deps "$service"
done
