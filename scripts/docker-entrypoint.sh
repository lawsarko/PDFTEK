#!/bin/sh
# Starts pdftek as the unprivileged "node" user. A Render Disk (or Docker volume) mounted at
# DATA_DIR is usually owned by root, so first hand it to "node", or the app couldn't save files.
set -e
DIR="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DIR"
  if [ "$(stat -c %U "$DIR")" != "node" ]; then
    chown -R node:node "$DIR"
  fi
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
