#!/bin/sh
set -eu

# Allow users to choose the UID/GID that should own persisted data.
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
DATA_DIR="${DATA_DIR:-/data}"

# Basic validation to avoid obscure failures when invalid values are provided.
case "${PUID}" in
  ''|*[!0-9]*) echo "Invalid PUID: ${PUID}" >&2; exit 1 ;;
esac
case "${PGID}" in
  ''|*[!0-9]*) echo "Invalid PGID: ${PGID}" >&2; exit 1 ;;
esac

# Ensure the runtime group exists for PGID.
if ! getent group "${PGID}" >/dev/null 2>&1; then
  groupadd -g "${PGID}" appgroup
fi

# Ensure a runtime user exists for PUID.
if ! getent passwd "${PUID}" >/dev/null 2>&1; then
  useradd -u "${PUID}" -g "${PGID}" -M -s /usr/sbin/nologin appuser
fi

# Ensure configured data directory exists and is writable by runtime UID/GID.
mkdir -p "${DATA_DIR}"
chown -R "${PUID}:${PGID}" "${DATA_DIR}"

# Run the server as the requested user.
exec gosu "${PUID}:${PGID}" deno run \
  --allow-net \
  --allow-read \
  --allow-write \
  --allow-env \
  src/index.ts
