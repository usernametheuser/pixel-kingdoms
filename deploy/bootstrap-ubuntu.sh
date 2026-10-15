#!/usr/bin/env bash
set -euo pipefail

# Intended for a reviewed Ubuntu 24.04 cloud VM. This script does not create
# cloud resources or change account billing settings.
if [[ ${EUID} -ne 0 ]]; then
  printf '%s\n' 'Run with sudo: sudo bash deploy/bootstrap-ubuntu.sh YOUR_HOSTNAME' >&2
  exit 1
fi
domain=${1:-}
if [[ ! "$domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$ ]] || [[ "$domain" == *..* ]]; then
  printf '%s\n' 'Provide a valid public hostname that resolves to this VM.' >&2
  exit 1
fi
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$project_root"

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2
fi
systemctl enable --now docker
if [[ -f .env ]]; then
  printf '%s\n' 'Existing .env retained. Confirm GAME_DOMAIN matches your hostname.'
else
  umask 077
  printf 'GAME_DOMAIN=%s\nFREE_AI=on\n' "$domain" > .env
fi
docker compose config --quiet
docker compose up -d --build
printf 'Game configured at https://%s\n' "$domain"
printf '%s\n' 'Check the HTTPS site and join from two browsers before sharing it.'
