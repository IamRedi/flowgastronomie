#!/bin/sh
set -eu
# The proxy now serves two platforms. This legacy wrapper may inspect or exec,
# but must not recreate/stop it with an incomplete Compose file set.
sh "$(dirname -- "$0")/compose-guard.sh" "$@"
# No shell-sourcing secrets; Compose reads the protected environment directly.
cd /opt/flowgastronomie/current
exec docker compose --env-file /etc/flowgastronomie/production.env \
    -f compose.production.yaml -f compose.staging.yaml "$@"
