#!/bin/sh
# Keep existing backup/retention jobs; refuse implicit proxy recreation.
set -eu
case "${1:-}" in
    config|ps|logs|top|images|version|exec) exit 0 ;;
esac
if [ "$#" -ge 6 ] && [ "$1" = --profile ] && [ "$2" = operations ] &&
   [ "$3" = run ] && [ "$4" = --rm ] && [ "$5" = --no-deps ]; then
    shift 5
    if [ "$#" -eq 1 ]; then
        case "$1" in backup|retention|retention-check) exit 0 ;; esac
    fi
    if [ "$#" -eq 3 ] && [ "$1" = -v ] && [ "$3" = backup ]; then
        case "$2" in
            /opt/flowgastronomie/*/infra/staging/../production/backup.sh:/opt/backup.sh:ro|/opt/flowgastronomie/*/infra/production/backup.sh:/opt/backup.sh:ro)
                exit 0
                ;;
        esac
    fi
fi
echo "Use a scoped application deployer or the shared-edge operator; unrestricted stack mutation is refused." >&2
exit 2
