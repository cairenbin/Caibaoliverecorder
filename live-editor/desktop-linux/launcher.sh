#!/usr/bin/env bash
set -euo pipefail
app=$(dirname "$(readlink -f "$0")")
EDITOR_DATA=$(realpath -m -- "${EDITOR_DATA:-${XDG_DATA_HOME:-$HOME/.local/share}/caibo-recorder}")
export EDITOR_PROJECT_ROOT="$app"
EDITOR_EXPORT_ROOT=$(realpath -m -- "${EDITOR_EXPORT_ROOT:-$EDITOR_DATA/导出视频}")
export EDITOR_DATA EDITOR_EXPORT_ROOT
export RECORDER_PATH="$app/runtime/recorder/BililiveRecorder.Cli"
export EDITOR_DESKTOP_MANAGED=0
if [[ -x "$app/runtime/ffmpeg/ffmpeg" ]]; then
  export FFMPEG_PATH="$app/runtime/ffmpeg/ffmpeg"
  export FFPROBE_PATH="$app/runtime/ffmpeg/ffprobe"
fi
exec "$app/runtime/node/node" "$app/launcher.mjs" "$@"
