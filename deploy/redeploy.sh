#!/bin/sh
# Forced command for the GitHub Actions deploy key: pull the new image and restart, nothing else.
set -eu
cd /opt/adb-live-preview
docker compose pull --quiet
docker compose up -d --remove-orphans
docker image prune -f --filter "label=org.opencontainers.image.source=https://github.com/rendydev404/ADB-LIVE-PREVIEW" >/dev/null
