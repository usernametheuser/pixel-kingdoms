#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$project_root"
mkdir -p backups
backup_path="backups/worlds-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
# Stop invokes the game's SIGTERM save handler; restart even if archiving fails.
trap 'docker compose up -d game' EXIT
docker compose stop game
docker compose run --rm --no-deps --entrypoint tar game -czf - -C /data/saves . > "$backup_path"
printf 'World backup saved to %s\n' "$backup_path"
