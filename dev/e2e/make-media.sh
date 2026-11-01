#!/bin/sh
# Generate royalty-free test tracks (sine tones) with tags for the e2e MA filesystem provider.
set -eu
OUT=${1:-/tmp/jbe2e/media}
mkdir -p "$OUT"
i=0
for artist in "Test Tones" "Sine Ensemble"; do
  for album in "Album One" "Album Two"; do
    for n in 1 2 3 4; do
      i=$((i+1)); f=$((200 + i*40))
      d="$OUT/$artist/$album"; mkdir -p "$d"
      ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=$f:duration=$((60 + n*15))" -ac 2 -ar 44100 -b:a 128k \
        -metadata artist="$artist" -metadata album_artist="$artist" -metadata album="$album" \
        -metadata title="Tone $f Hz" -metadata track="$n" -metadata genre="Electronic" -metadata date=2026 \
        "$d/$(printf %02d $n) Tone $f Hz.mp3"
    done
  done
done
echo "$i tracks in $OUT"
