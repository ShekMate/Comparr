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

# Ensure the Deno cache dir is writable by the runtime user
# (it is populated as root during docker build, so we must re-own it here)
chown -R "${PUID}:${PGID}" /deno-dir || true

# Resolve the system SQLite3 shared library so @db/sqlite uses it directly
# instead of having @denosaurs/plug attempt a runtime download.
if [ -z "${DENO_SQLITE_PATH:-}" ]; then
  DENO_SQLITE_PATH=$(ldconfig -p 2>/dev/null | grep -m1 'libsqlite3\.so\b' | awk '{print $NF}')
  if [ -z "$DENO_SQLITE_PATH" ]; then
    DENO_SQLITE_PATH=$(find /usr/lib /usr/local/lib -name 'libsqlite3.so*' ! -name '*.a' 2>/dev/null | head -1)
  fi
fi
export DENO_SQLITE_PATH

echo "[entrypoint] PUID=${PUID} PGID=${PGID}"
echo "[entrypoint] DENO_SQLITE_PATH=${DENO_SQLITE_PATH}"
echo "[entrypoint] Deno version: $(deno --version 2>&1 | head -1)"
echo "[entrypoint] Starting server as uid=${PUID} gid=${PGID}"

# Run the server as the requested user
exec gosu "${PUID}:${PGID}" deno run \
  --allow-net \
  --allow-ffi \
  --allow-read=/data,/app,/usr/lib,/usr/local/lib \
  --allow-write=/data \
  --allow-env \
  src/index.ts
