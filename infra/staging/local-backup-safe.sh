#!/bin/sh
# Standalone backup-only release; does not restart application containers.
set -eu
umask 077
code=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec 9>/run/lock/flowgastronomie-backup.lock
flock -n 9 || exit 1
python3 -c 'import sys; sys.path.insert(0,sys.argv[1]); from r2_backup import disk_guard; disk_guard("/var/backups/flowgastronomie",1073741824)' "$code"
exec sh /opt/flowgastronomie/current/infra/staging/compose.sh \
    --profile operations run --rm --no-deps \
    -v "$code/../production/backup.sh:/opt/backup.sh:ro" backup
