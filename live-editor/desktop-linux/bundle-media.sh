#!/usr/bin/env bash
set -euo pipefail
target=$1
notices=$2
root=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$target"/{bin,lib} "$notices"
for tool in ffmpeg ffprobe; do
  install -m 755 "/usr/bin/$tool" "$target/bin/$tool"
  install -m 755 "$root/media-tool.sh" "$target/$tool"
done

dependencies=$(ldd /usr/bin/ffmpeg /usr/bin/ffprobe)
if [[ "$dependencies" == *'not found'* ]]; then
  echo "$dependencies" >&2
  exit 1
fi
packages=(ffmpeg)
while read -r library source; do
  case "$library" in
    libc.so.*|libm.so.*|libpthread.so.*|libdl.so.*|librt.so.*|libresolv.so.*|libutil.so.*|ld-linux*) continue ;;
  esac
  install -m 644 "$source" "$target/lib/$library"
  resolved=$(readlink -f "$source")
  owner=$(dpkg-query -S "$resolved" 2>/dev/null ||
    dpkg-query -S "${resolved#/usr}" 2>/dev/null ||
    dpkg-query -S "$source" 2>/dev/null) || {
    echo "无法查到共享库的 Ubuntu 源包：$library ($source)" >&2
    exit 1
  }
  packages+=("${owner%%: *}")
done < <(awk '$2 == "=>" && $3 ~ /^\// {print $1, $3}' <<< "$dependencies" | sort -u)

dpkg-query -W -f='${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n' "${packages[@]}" | sort -u > "$notices/ubuntu-sources.tsv"
while IFS=$'\t' read -r package _; do
  name=${package%%:*}
  file="/usr/share/doc/$name/copyright"
  if [[ -f "$file" ]]; then install -m 644 "$file" "$notices/$name.txt"; fi
done < "$notices/ubuntu-sources.tsv"
