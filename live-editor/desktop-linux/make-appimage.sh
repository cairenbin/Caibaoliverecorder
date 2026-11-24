#!/usr/bin/env bash
set -euo pipefail
layout=$1
output=$2
tools=$3
appimagetool="$tools/appimagetool-x86_64.AppImage"
runtime="$tools/runtime-20251108-x86_64"
APPIMAGE_EXTRACT_AND_RUN=1 ARCH=x86_64 "$appimagetool" --no-appstream \
  --runtime-file "$runtime" "$layout" "$output"
