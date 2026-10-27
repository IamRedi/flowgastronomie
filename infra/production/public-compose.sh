#!/bin/sh
set -eu
cd /opt/flowgastronomie-public/current
exec docker compose --env-file /etc/flowgastronomie-public/production.env \
    -f compose.production.yaml -f compose.public.yaml \
    -f /etc/flowgastronomie-public/release.compose.yaml "$@"
