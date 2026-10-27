#!/bin/sh
set -eu
umask 077
: "${PGDATABASE:?Database name required}" "${PGPASSFILE:?Password file required}"
archive="/backups/flowgastronomie-$(date -u +%Y%m%dT%H%M%SZ).dump"
temporary="${archive}.partial"
trap 'rm -f "$temporary"' EXIT HUP INT TERM
# Suppress provider errors which may contain connection details. Exit still fails.
if ! pg_dump --format=custom --no-owner --no-acl --file="$temporary" 2>/dev/null; then
    echo 'Logical backup failed' >&2
    exit 1
fi
pg_restore --list "$temporary" >/dev/null
mv "$temporary" "$archive"
sha256sum "$archive" >"${archive}.sha256"
# Prune only our completed archives, only after a successful verified dump.
find /backups -maxdepth 1 -type f -name 'flowgastronomie-*.dump' -mtime +6 -delete
find /backups -maxdepth 1 -type f -name 'flowgastronomie-*.dump.sha256' -mtime +6 -delete
echo 'Logical backup completed and archive verified'
