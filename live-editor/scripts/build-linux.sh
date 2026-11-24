#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd -P)
[[ $(uname -m) == x86_64 ]] || { echo '当前 Linux 构建仅支持 x86_64。' >&2; exit 1; }
output=$(realpath -m "${1:-$root/release/linux}")
format=${2:-all}
case "$format" in all|deb|appimage|rpm) ;; *) echo '用法：build-linux.sh [输出目录] [all|deb|appimage|rpm]' >&2; exit 2;; esac
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
  if [[ "$format" == all || "$format" == appimage ]]; then
    download https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage \
      ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0
    # Use a versioned runtime. Keep the cache filename versioned as well.
    download https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64 \
      2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d runtime-20251108-x86_64
  fi
  if [[ "$format" == all || "$format" == rpm ]]; then
    download https://github.com/goreleaser/nfpm/releases/download/v2.48.0/nfpm_2.48.0_amd64.deb \
      787af76e172dd5fc7cedf4d7c5a090a2f62be9001557a4db1103e270f90ddefd
  fi
  flock -u 8
fi
# Container root maps to the calling user in a rootless Docker daemon.
container_user="$(id -u):$(id -g)"
if [[ $(docker info --format '{{json .SecurityOptions}}') == *name=rootless* ]]; then
  container_user=0:0
fi

run_builder() {
  local script=$1 destination=$2
  shift 2
  docker run --rm --platform linux/amd64 --user "$container_user" \
    --mount "type=bind,source=$root,target=/source,readonly" \
    --mount "type=bind,source=$destination,target=/output" \
    "$image" bash "/source/live-editor/desktop-linux/$script" "$@"
}

image=caibo-recorder-linux-build:noble
docker build --platform linux/amd64 -t "$image" "$root/live-editor/desktop-linux"

if [[ "$format" == deb || "$format" == appimage ]]; then
  run_builder package.sh "$output" "$format"
  exit 0
fi

# Promote packages together after the RPM has installed and run on a clean EL9 image.
staging=$(mktemp -d "$output/.caibo-release.XXXXXX")
trap 'rm -rf "$staging"' EXIT
if [[ "$format" == all ]]; then
  run_builder package.sh "$staging" all
else
  run_builder package.sh "$staging" rpm-payload
fi
run_builder package-rpm.sh "$staging"
rm "$staging/rpm-payload.tar"
docker run --rm --platform linux/amd64 \
  --mount "type=bind,source=$staging,target=/packages,readonly" \
  --mount "type=bind,source=$root/live-editor/desktop-linux,target=/scripts,readonly" \
  --env "CAIBO_ALMA_MIRROR=${CAIBO_ALMA_MIRROR:-}" \
  almalinux:9 bash -ec '
    if [[ -n "$CAIBO_ALMA_MIRROR" ]]; then bash /scripts/configure-el9-mirror.sh "$CAIBO_ALMA_MIRROR"; fi
    dnf -y --setopt=install_weak_deps=False --setopt=max_parallel_downloads=12 install /packages/*.rpm
    app=/usr/lib64/caibo-recorder
    expected=$(sha256sum < /packages/rpm-media-sources.tsv)
    installed=$(sha256sum < /usr/share/doc/caibo-recorder/ffmpeg/rpm-media-sources.tsv)
    [[ "$installed" == "$expected" ]]
    test -s /usr/share/doc/caibo-recorder/LINUX-NOTICE.md
    export PATH="$app/runtime/node:$PATH"
    bash /scripts/smoke.sh /usr/bin/caibo-recorder "$app/runtime/ffmpeg"
  '

if [[ "$format" == all ]]; then
  cat "$staging"/SHA256SUMS-*-rpm.txt >> "$staging"/SHA256SUMS-*-all.txt
  rm "$staging"/SHA256SUMS-*-rpm.txt
fi
for file in "$staging/"*; do
  [[ ! -e "$output/${file##*/}" ]] || { echo "输出文件已存在：$output/${file##*/}" >&2; exit 1; }
done
for file in "$staging/"*; do
  mv -T "$file" "$output/${file##*/}"
  printf '已生成 %s/%s\n' "$output" "${file##*/}"
done
