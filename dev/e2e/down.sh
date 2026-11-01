#!/bin/sh
# Stop and remove the e2e containers. Data stays in $E2E_DIR (default /tmp/jbe2e) unless --purge
# (the containers write root-owned files, so the purge runs in a container).
set -u
E2E_DIR=${E2E_DIR:-/tmp/jbe2e}
DOCKER=${DOCKER:-sudo docker}
for c in jbe2e-ha jbe2e-snap-kitchen-test jbe2e-snap-patio-test jbe2e-ma; do $DOCKER rm -f "$c" >/dev/null 2>&1 && echo "removed $c"; done
if [ "${1:-}" = "--purge" ]; then $DOCKER run --rm -v "$E2E_DIR:/x" --entrypoint sh "${MA_IMAGE:-ghcr.io/music-assistant/server:2.10.9}" -c 'rm -rf /x/*' && rmdir "$E2E_DIR" && echo "purged $E2E_DIR"; fi
