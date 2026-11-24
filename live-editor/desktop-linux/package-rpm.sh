#!/usr/bin/env bash
set -euo pipefail
linux=/source/live-editor/desktop-linux
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

layout="$work/payload"
mkdir "$layout"
tar -xf /output/rpm-payload.tar -C "$layout"
read -r version revision < "$layout/.package-version"
rm "$layout/.package-version"
rpm_version="${version/-beta./~beta.}"
rpm="caibo-recorder-$rpm_version-$revision.el9.x86_64.rpm"
mv "$layout/usr/lib" "$layout/usr/lib64"
ln -sfn ../lib64/caibo-recorder/caibo-recorder "$layout/usr/bin/caibo-recorder"
app="$layout/usr/lib64/caibo-recorder"
doc="$layout/usr/share/doc/caibo-recorder"
bash "$linux/rpm-media-bundle.sh" "$app/runtime/ffmpeg" "$doc/ffmpeg"
cmp /source/LINUX-NOTICE.md "$doc/LINUX-NOTICE.md"
dpkg-deb -x /source/.tools/linux/nfpm_2.48.0_amd64.deb "$work/nfpm"
cat > "$work/nfpm.yaml" <<CONFIG
name: caibo-recorder
arch: amd64
platform: linux
version: "$rpm_version"
version_schema: none
release: "$revision.el9"
maintainer: Caibo Recorder contributors
description: Caibo live recorder and video workbench
homepage: https://github.com/cairenbin/Caibaoliverecorder
license: GPL-3.0-only
depends:
  - bash
  - /usr/bin/dirname
  - /usr/bin/readlink
  - /usr/bin/realpath
  - glibc
  - libgcc
  - libstdc++
  - libatomic
  - ca-certificates
  - openssl-libs
  - libicu
  - tzdata
  - krb5-libs
  - zlib
  - fontconfig
  - xdg-utils
recommends:
  - google-noto-sans-cjk-ttc-fonts
contents:
  - src: "$app"
    dst: /usr/lib64/caibo-recorder
    type: tree
  - src: ../lib64/caibo-recorder/caibo-recorder
    dst: /usr/bin/caibo-recorder
    type: symlink
  - src: "$doc"
    dst: /usr/share/doc/caibo-recorder
    type: tree
  - src: "$layout/usr/share/applications/caibo-recorder.desktop"
    dst: /usr/share/applications/caibo-recorder.desktop
  - src: "$layout/usr/share/icons/hicolor/256x256/apps/caibo-recorder.png"
    dst: /usr/share/icons/hicolor/256x256/apps/caibo-recorder.png
rpm:
  compression: zstd
CONFIG
"$work/nfpm/usr/bin/nfpm" package --packager rpm --config "$work/nfpm.yaml" --target "/output/$rpm"
cp "$doc/ffmpeg/rpm-media-sources.tsv" /output/
(cd /output && sha256sum "$rpm" rpm-media-sources.tsv) > "/output/SHA256SUMS-$version-r$revision-rpm.txt"
