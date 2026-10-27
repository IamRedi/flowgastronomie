#!/bin/sh
set -eu
umask 077
cd /opt/flowgastronomie/current
case "${1:-}" in
    backup) services="backup" ;;
    retention) services="retention retention-check" ;;
    *) echo 'Usage: host-job.sh backup|retention' >&2; exit 2 ;;
esac
# Prevent overlap of the same scheduled/manual job. Failures reach systemd.
exec 9>"/run/lock/flowgastronomie-${1}.lock"
flock -n 9 || exit 1
for service in $services; do
    docker compose --env-file /etc/flowgastronomie/production.env \
        -f compose.production.yaml --profile operations run --rm --no-deps "$service"
done
