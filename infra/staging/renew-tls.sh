#!/bin/sh
set -eu
# Certbot deploy hook: validate configuration before the zero-downtime reload.
sh /opt/flowgastronomie/current/infra/staging/compose.sh exec -T proxy nginx -t
sh /opt/flowgastronomie/current/infra/staging/compose.sh exec -T proxy nginx -s reload
