#!/usr/bin/env bash
set -euo pipefail
directory=$(dirname "$(readlink -f "$0")")
exec "$directory/glibc/ld-linux-x86-64.so.2" \
  --library-path "$directory/lib:$directory/glibc" "$directory/bin/${0##*/}" "$@"
