#!/usr/bin/env bash
set -euo pipefail
directory=$(dirname "$(readlink -f "$0")")
export LD_LIBRARY_PATH="$directory/lib"
exec "$directory/bin/${0##*/}" "$@"
