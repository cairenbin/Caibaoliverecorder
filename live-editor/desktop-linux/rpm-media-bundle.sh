#!/usr/bin/env bash
set -euo pipefail
target=$1
notices=$2
root=$(cd "$(dirname "$0")" && pwd)

# Use the same FFmpeg build as AppImage. Its glibc loader and libraries stay
# private to ffmpeg and ffprobe so the rest of the app uses the EL9 system ABI.
bash "$root/bundle-media.sh" "$target" "$notices"
glibc=/lib/x86_64-linux-gnu
mkdir -p "$target/glibc"
install -m 755 /lib64/ld-linux-x86-64.so.2 "$target/glibc/"
for library in libc.so.6 libm.so.6 libdl.so.2 libpthread.so.0 librt.so.1 \
  libresolv.so.2 libutil.so.1 libnss_files.so.2 libnss_dns.so.2; do
  install -m 644 "$glibc/$library" "$target/glibc/"
done
for tool in ffmpeg ffprobe; do
  install -m 755 "$root/rpm-media-tool.sh" "$target/$tool"
done

dpkg-query -W -f='${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n' libc6 \
  >> "$notices/ubuntu-sources.tsv"
install -m 644 /usr/share/doc/libc6/copyright "$notices/libc6.txt"
while IFS=$'\t' read -r binary version source source_version; do
  printf '%s\t%s\t%s\t%s\tUbuntu\thttps://launchpad.net/ubuntu/+source/%s/%s\n' \
    "$binary" "$version" "$source" "${binary%%:*}.txt" "$source" "${source_version//:/%3A}"
done < "$notices/ubuntu-sources.tsv" > "$notices/rpm-media-sources.tsv"
