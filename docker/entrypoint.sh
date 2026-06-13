#!/usr/bin/env sh
set -eu

mkdir -p "${HOMEOPS_DATA_DIR:-/data}"
chown -R node:node "${HOMEOPS_DATA_DIR:-/data}"

exec su-exec node "$@"
