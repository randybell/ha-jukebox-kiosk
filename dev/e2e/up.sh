#!/bin/sh
# Bring up the throwaway real-Home-Assistant e2e env on this machine (docker, host network).
#   Music Assistant 2.10.9 (:8095) + filesystem provider on generated sine tones + 2 snapclient test players
#   Home Assistant 2026.10 (:8123) + music_assistant + jukebox_kiosk from this checkout + dashboard "jukebox-e2e"
# Everything lives in $E2E_DIR (default /tmp/jbe2e): random throwaway passwords in secrets.env, tokens in *.token.
# Then: node dev/e2e/ha-e2e.mjs [--shots DIR]      Tear down: sh dev/e2e/down.sh
set -eu
E2E_DIR=${E2E_DIR:-/tmp/jbe2e}; export E2E_DIR
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
PY=${PY:-python3}                      # needs aiohttp
DOCKER=${DOCKER:-sudo docker}
MA_IMAGE=${MA_IMAGE:-ghcr.io/music-assistant/server:2.10.9}
HA_IMAGE=${HA_IMAGE:-ghcr.io/home-assistant/home-assistant:2026.10}
# ha-config/www must exist before HA starts, or /local/ is not served (the D1/D2 double-load checks use it)
mkdir -p "$E2E_DIR/ma-data" "$E2E_DIR/media" "$E2E_DIR/ha-config/custom_components" "$E2E_DIR/ha-config/www"
if [ ! -f "$E2E_DIR/secrets.env" ]; then
  umask 077
  printf 'MA_ADMIN_PW=%s\nHA_ADMIN_PW=%s\nHA_KIOSK_PW=%s\n' "$(openssl rand -hex 16)" "$(openssl rand -hex 16)" "$(openssl rand -hex 16)" > "$E2E_DIR/secrets.env"
  umask 022
fi
[ -n "$(ls -A "$E2E_DIR/media")" ] || sh "$HERE/make-media.sh" "$E2E_DIR/media"

running() { $DOCKER ps --format '{{.Names}}' | grep -qx "$1"; }
running jbe2e-ma || $DOCKER run -d --name jbe2e-ma --network host \
  -v "$E2E_DIR/ma-data:/data" -v "$E2E_DIR/media:/media:ro" "$MA_IMAGE" >/dev/null
$PY "$HERE/ma_setup.py"
sleep 5   # the snapcast provider starts its built-in snapserver
for p in kitchen-test patio-test; do
  running "jbe2e-snap-$p" || $DOCKER run -d --name "jbe2e-snap-$p" --network host --entrypoint snapclient "$MA_IMAGE" \
    --host 127.0.0.1 --port 1704 --hostID "$p" --player file:filename=/dev/null >/dev/null
done
$PY "$HERE/ma_setup.py" --name-players

# the integration from this checkout (built card included)
$DOCKER run --rm -v "$E2E_DIR/ha-config:/config" --entrypoint rm "$HA_IMAGE" -rf /config/custom_components/jukebox_kiosk
cp -r "$ROOT/custom_components/jukebox_kiosk" "$E2E_DIR/ha-config/custom_components/"
rm -rf "$E2E_DIR/ha-config/custom_components/jukebox_kiosk/__pycache__"
if running jbe2e-ha; then $DOCKER restart jbe2e-ha >/dev/null; else
  $DOCKER run -d --name jbe2e-ha --network host -e TZ=America/Chicago -v "$E2E_DIR/ha-config:/config" "$HA_IMAGE" >/dev/null
fi
printf 'waiting for Home Assistant'
i=0; until [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8123/api/)" = 401 ] || \
  curl -sf http://127.0.0.1:8123/api/onboarding >/dev/null 2>&1; do i=$((i+1)); [ $i -lt 120 ] || { echo ' timeout'; exit 1; }; printf .; sleep 2; done; echo
sleep 5
# pass 1: onboarding, users, MA entry, old-plugin resource + stand-in plugin folder, jukebox_kiosk, dashboard
$PY "$HERE/ha_setup.py" --legacy-resource
# pass 2: the card config (the card finds the MA entry itself through jukebox_kiosk)
CARD='{"entity":"media_player.kitchen_test","rooms":["media_player.kitchen_test","media_player.patio_test"]}'
$PY "$HERE/ha_setup.py" --card-config "$CARD" >/dev/null
echo "e2e env up: HA http://127.0.0.1:8123/jukebox-e2e/jukebox  MA http://127.0.0.1:8095  (secrets in $E2E_DIR/secrets.env)"
