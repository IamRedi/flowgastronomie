#!/bin/sh
set -eu
umask 077
: "${PGDATABASE:?Database name required}" "${PGPASSFILE:?Password file required}"
archive="/backups/flowgastronomie-$(date -u +%Y%m%dT%H%M%SZ).dump"
temporary="${archive}.partial"
media="${archive%.dump}.media.tar.gz"
media_temporary="${media}.partial"
trap 'rm -f "$temporary" "$media_temporary"' EXIT HUP INT TERM
test ! -e "$archive"
if [ "${BACKUP_MEDIA:-false}" = true ]; then
    # Alpine already contains /media: existence alone does not prove a mount.
    grep -qs ' /media ' /proc/self/mountinfo || {
        echo 'Private media backup mount missing' >&2
        exit 1
    }
fi
# Suppress provider errors which may contain connection details. Exit still fails.
if ! pg_dump --format=custom --no-owner --no-acl --file="$temporary" 2>/dev/null; then
    echo 'Logical backup failed' >&2
    exit 1
fi
pg_restore --list "$temporary" >/dev/null
# Database first: committed Creative references point to already-written,
# immutable files. Extra files arriving during this copy are harmless orphans.
# Canonical MediaAsset and menu-import originals are already inside pg_dump.
if [ "${BACKUP_MEDIA:-false}" = true ]; then
    test -d /media
    tar -czf "$media_temporary" -C /media .
    tar -tzf "$media_temporary" >/dev/null
    mv "$media_temporary" "$media"
    sha256sum "$media" >"${media}.sha256"
fi
mv "$temporary" "$archive"
sha256sum "$archive" >"${archive}.sha256"
# A completion marker is written last; incomplete bundles never satisfy monitoring.
if [ "${BACKUP_MEDIA:-false}" = true ]; then
    touch "${archive%.dump}.complete"
fi
# Retention belongs exclusively to the separately verified off-host executor.
# Local dump success alone never authorizes deleting a recovery point.
echo 'Logical backup completed; automatic local pruning disabled'
