#!/bin/sh
set -eu
current=$1
ready=$2
staging=$3
pid=$4
backup="${current}.previous"
count=0
while kill -0 "$pid" 2>/dev/null && [ "$count" -lt 120 ]; do sleep 1; count=$((count + 1)); done
if kill -0 "$pid" 2>/dev/null; then exit 1; fi
# Keep one previous build for a manual rollback; replace it on the next update.
if [ -e "$backup" ]; then rm -rf "$backup"; fi
mv "$current" "$backup"
if mv "$ready" "$current" && { [ "${PAWPRINT_TEST_INSTALL_NO_OPEN:-0}" = "1" ] || /usr/bin/open -a "$current"; }; then
  rm -rf "$staging"
else
  if [ -e "$current" ]; then mv "$current" "$staging/failed-Pawprint.app"; fi
  mv "$backup" "$current"
  if [ "${PAWPRINT_TEST_INSTALL_NO_OPEN:-0}" != "1" ]; then /usr/bin/open -a "$current" || true; fi
  exit 1
fi
