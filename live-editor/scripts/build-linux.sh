#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd -P)
[[ $(uname -m) == x86_64 ]] || { echo '当前 Linux 构建仅支持 x86_64。' >&2; exit 1; }
output=$(realpath -m "${1:-$root/release/linux}")
format=${2:-all}
case "$format" in all|deb|appimage) ;; *) echo '用法：build-linux.sh [输出目录] [all|deb|appimage]' >&2; exit 2;; esac
mkdir -p "$output"
exec 9<"$output"
flock -n 9 || { echo "该输出目录已在构建中：$output" >&2; exit 1; }

cache="$root/.tools/linux"
mkdir -p "$cache"
if [[ "$format" != deb ]]; then
  exec 8<"$cache"
  flock 8
  download() (
    set -euo pipefail
    local_file="$cache/${3:-${1##*/}}"
    checksum=$2
    verify() { printf '%s  %s\n' "$checksum" "$1" | sha256sum -c --status; }
    if ! verify "$local_file" 2>/dev/null; then
      temp=$(mktemp "$cache/.download.XXXXXX")
      trap 'rm -f "$temp"' EXIT
      curl -fLsS --retry 3 --connect-timeout 30 --max-time 600 "$1" -o "$temp"
      verify "$temp" || { echo "下载校验失败：$1" >&2; exit 1; }
      mv -f "$temp" "$local_file"
    fi
    chmod 755 "$local_file"
  )
  download https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage \
    ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0
  # Use a versioned runtime. Keep the cache filename versioned as well.
  download https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64 \
    2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d runtime-20251108-x86_64
  flock -u 8
fi
image=caibo-recorder-linux-build:noble
docker build --platform linux/amd64 -t "$image" "$root/live-editor/desktop-linux"
# Container root maps to the calling user in a rootless Docker daemon.
container_user="$(id -u):$(id -g)"
if [[ $(docker info --format '{{json .SecurityOptions}}') == *name=rootless* ]]; then
  container_user=0:0
fi
docker run --rm --platform linux/amd64 --user "$container_user" \
  --mount "type=bind,source=$root,target=/source,readonly" \
  --mount "type=bind,source=$output,target=/output" \
  "$image" bash /source/live-editor/desktop-linux/package.sh "$format"
