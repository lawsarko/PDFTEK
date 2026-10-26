#!/bin/sh
# Starts pdftek as the unprivileged "node" user.
set -e

# Size Node's heap to the instance's real memory. Left alone, Node can size it from the host
# machine's memory, let garbage pile up for hours, and get the container killed for using more
# than its plan allows. ~45% goes to the heap; the rest is for images, PDF rendering, LibreOffice.
if ! echo "${NODE_OPTIONS:-}" | grep -q "max-old-space-size"; then
  LIMIT=""
  if [ -r /sys/fs/cgroup/memory.max ]; then LIMIT=$(cat /sys/fs/cgroup/memory.max); fi
  if [ -z "$LIMIT" ] || [ "$LIMIT" = "max" ]; then
    if [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then LIMIT=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes); fi
  fi
  case "$LIMIT" in
    ''|max|*[!0-9]*) ;;
    *)
      MB=$((LIMIT / 1048576))
      if [ "$MB" -gt 0 ] && [ "$MB" -lt 65536 ]; then
        HEAP=$((MB * 45 / 100))
        [ "$HEAP" -lt 256 ] && HEAP=256
        [ "$HEAP" -gt 4096 ] && HEAP=4096
        export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=$HEAP"
        echo "[pdftek] instance memory ${MB} MB, Node heap limit ${HEAP} MB"
      fi
      ;;
  esac
fi

# A Render Disk (or Docker volume) mounted at DATA_DIR is usually owned by root, so first hand it
# to "node", or the app couldn't save files.
DIR="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DIR"
  if [ "$(stat -c %U "$DIR")" != "node" ]; then
    chown -R node:node "$DIR"
  fi
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
