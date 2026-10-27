#!/bin/sh
# Installed as /etc/flowgastronomie/shared-edge/compose.sh after owner approval.
# This wrapper never builds, pulls, changes application images, or stops the stack.
set -eu
base=/opt/flowgastronomie/current
state=/etc/flowgastronomie/shared-edge
case "${1:-}" in
  validate)
    action=validate
    ;;
  recreate)
    action=recreate
    ;;
  *)
    echo "Only validate or recreate is accepted by the shared-edge operator." >&2
    exit 2
    ;;
esac
[ "$#" -eq 1 ] || exit 2
for file in flow-public.conf businesssite.conf public-edge.compose.yaml shared-edge.compose.yaml edge-image.compose.yaml staging-template.conf; do
    [ -f "$state/$file" ] && [ ! -L "$state/$file" ] || exit 1
done
export PUBLIC_EDGE_CONFIG="$state/flow-public.conf"
export STAGING_EDGE_TEMPLATE="$state/staging-template.conf"
compose() {
    docker compose --project-directory "$base" -p flowgastronomie \
        --env-file /etc/flowgastronomie/production.env \
        -f "$base/compose.production.yaml" -f "$base/compose.staging.yaml" \
        -f "$state/public-edge.compose.yaml" \
        -f "$state/edge-image.compose.yaml" \
        -f "$state/shared-edge.compose.yaml" "$@"
}
# Configuration validation alone does not prove runtime acceptance.
compose config --quiet
if [ "$action" = recreate ]; then
    exec python3 "$state/shared-edge-transaction.py" recreate
else
    exec python3 "$state/shared-edge-transaction.py" validate
fi
