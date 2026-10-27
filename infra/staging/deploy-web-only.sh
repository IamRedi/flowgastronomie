#!/bin/sh
# Owner-authorized staging web-only cutover. No migrations or backup changes.
set -eu
umask 077
[ "$(id -u)" = 0 ] || exit 1
image=${1:?Verified local image SHA256 required}
case "$image" in sha256:*) ;; *) exit 1 ;; esac
[ "$(docker image inspect "$image" --format '{{.Id}}')" = "$image" ] || exit 1
exec 9>/run/lock/flowgastronomie-web-deploy.lock
flock -n 9 || exit 1
old=$(docker inspect flowgastronomie-web-1 --format '{{.Image}}')
base=$(readlink -f /opt/flowgastronomie/current)
state=/var/lib/flowgastronomie/web-rollbacks/$(date -u +%Y%m%dT%H%M%SZ)
install -d -m0700 "$state"
override=/etc/flowgastronomie/web-release.compose.yaml
printf '%s\n' "$old" > "$state/previous-image"
printf '%s\n' "$image" > "$state/candidate-image"
compose() {
    docker compose --project-directory "$base" \
        --env-file /etc/flowgastronomie/production.env \
        -f "$base/compose.production.yaml" -f "$base/compose.staging.yaml" \
        -f "$override" "$@"
}
write_override() {
    printf 'services:\n  web:\n    image: %s\n    pull_policy: never\n' "$1" > "$override"
}
# Persist the exact previous image, even when there was no earlier override.
printf 'services:\n  web:\n    image: %s\n    pull_policy: never\n' "$old" > "$state/previous.compose.yaml"
cat > "$state/rollback.sh" <<EOF
#!/bin/sh
set -eu
cp '$state/previous.compose.yaml' '$override'
docker compose --project-directory '$base' --env-file /etc/flowgastronomie/production.env -f '$base/compose.production.yaml' -f '$base/compose.staging.yaml' -f '$override' up -d --no-deps --no-build --wait --wait-timeout 90 web
docker exec flowgastronomie-proxy-1 nginx -t
docker exec flowgastronomie-proxy-1 nginx -s reload
EOF
chmod 0700 "$state/rollback.sh"
rollback_on_error() {
    result=$?
    trap - EXIT
    if [ "$result" -ne 0 ]; then
        echo 'Web cutover failed; restoring previous web image' >&2
        "$state/rollback.sh"
    fi
    exit "$result"
}
trap rollback_on_error EXIT
write_override "$image"
compose up -d --no-deps --no-build --wait --wait-timeout 90 web
docker exec flowgastronomie-proxy-1 nginx -t
docker exec flowgastronomie-proxy-1 nginx -s reload
curl --fail --silent --show-error --retry 3 --retry-delay 1 https://staging.123serve.de/sq -o /dev/null
[ "$(docker inspect flowgastronomie-web-1 --format '{{.Image}}')" = "$image" ]
echo "Web cutover PASS; rollback: $state/rollback.sh"
