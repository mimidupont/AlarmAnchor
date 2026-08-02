#!/bin/sh
set -e

# Fly mounts the volume owned by root, but the server runs as the
# unprivileged `node` user — without this the session snapshot fails to
# write and every restart silently loses the active anchor watches.
DATA_DIR="${DATA_DIR:-/data}"
if [ -d "$DATA_DIR" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR" || echo "warning: could not chown $DATA_DIR"
fi

exec su-exec node "$@"
