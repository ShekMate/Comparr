#!/bin/sh
set -e

# Allow users to choose the UID/GID that should own /data
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# Ensure the runtime user/group exist to match PUID/PGID
if ! getent group "${PGID}" >/dev/null 2>&1; then
  groupadd -g "${PGID}" appgroup || true
fi

if ! id -u "${PUID}" >/dev/null 2>&1; then
  useradd -u "${PUID}" -g "${PGID}" -M -s /usr/sbin/nologin appuser || true
fi

# Make sure /data exists and is owned correctly
mkdir -p /data
chown -R "${PUID}:${PGID}" /data || true

# Run the server as the requested user
exec gosu "${PUID}:${PGID}" deno run \
  --allow-net \
  --allow-read \
  --allow-write \
  --allow-env \
  src/index.ts