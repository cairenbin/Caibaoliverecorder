#!/usr/bin/env bash
set -euo pipefail
format=$1
work=$(mktemp -d)
staging=
cleanup() {
  rm -rf "$work"
  if [[ -n "$staging" ]]; then rm -rf "$staging"; fi
}
trap cleanup EXIT
export DOTNET_ROLL_FORWARD=Major HOME="$work/home" DOTNET_CLI_HOME="$work/home" NUGET_PACKAGES="$work/nuget"
# Docker may run under a numeric UID with no passwd entry. .NET uses
# XDG_RUNTIME_DIR for its per-user NuGet and runtime mutex files.
export XDG_RUNTIME_DIR="$work/xdg-runtime"
mkdir -p "$HOME"
install -d -m 700 "$XDG_RUNTIME_DIR"
git -c safe.directory=/source clone --quiet --no-hardlinks /source "$work/src"
cd "$work/src"
# Build the current checkout in an isolated tree, including local edits to
# the application sources. Ignore recordings, runtime caches and build output.
git -C /source -c safe.directory=/source ls-files -z -- \
  BililiveRecorder.Cli BililiveRecorder.Core BililiveRecorder.Flv \
  BililiveRecorder.ToolBox BililiveRecorder.Web Directory.Build.props BannedSymbols.txt \
  GitVersion.yml global.json LICENSE THIRD_PARTY_NOTICES.md \
  live-editor/server live-editor/shared live-editor/src live-editor/docs/licenses \
  live-editor/index.html live-editor/package.json live-editor/package-lock.json live-editor/vite.config.js |
  tar -cf - -C /source --null -T - | tar -xf -
linux=/source/live-editor/desktop-linux

node -e 'const p=require("./live-editor/package.json"); if(!/^\d+\.\d+\.\d+(?:-beta\.[1-9]\d*)?$/.test(p.version)||!Number.isSafeInteger(p.buildRevision)||p.buildRevision<1) process.exit(1);'
version=$(node -p 'require("./live-editor/package.json").version')
revision=$(node -p 'require("./live-editor/package.json").buildRevision')
deb_version="${version/-beta./~beta.}-$revision"
deb="caibo-recorder_${deb_version}_amd64.deb"
appimage="Caibo-$version-r$revision-linux-x86_64.AppImage"
manifest="SHA256SUMS-$version-r$revision-$format.txt"
case "$format" in
  all) names=("$deb" "$appimage") ;;
  deb) names=("$deb") ;;
  appimage) names=("$appimage") ;;
  rpm-payload) names=() ;;
  *) exit 2 ;;
esac
for item in "${names[@]}" "$manifest"; do
  [[ ! -e "/output/$item" ]] || { echo "输出文件已存在：/output/$item" >&2; exit 1; }
done

(cd live-editor && npm ci --no-audit --no-fund && npm run build)
dotnet publish BililiveRecorder.Cli/BililiveRecorder.Cli.csproj -c Release -r linux-x64 \
  -p:RuntimeIdentifiers=linux-x64 --self-contained true -o "$work/recorder"
find "$work/recorder" -name '*.pdb' -type f -delete

layout="$work/AppDir"
app="$layout/usr/lib/caibo-recorder"
doc="$layout/usr/share/doc/caibo-recorder"
mkdir -p "$app/live-editor" "$app/runtime/node" "$doc"
cp -R live-editor/{dist,server,shared,package.json} "$app/live-editor/"
cp -R "$work/recorder" "$app/runtime/"
install -m 755 /opt/caibo-node/bin/node "$app/runtime/node/node"
install -m 755 "$linux/launcher.sh" "$app/caibo-recorder"
install -m 644 "$linux/launcher.mjs" "$app/launcher.mjs"
install -D -m 644 "$linux/caibo-recorder.desktop" "$layout/usr/share/applications/caibo-recorder.desktop"
mkdir -p "$layout/usr/share/icons/hicolor/256x256/apps"
icon="$layout/usr/share/icons/hicolor/256x256/apps/caibo-recorder.png"
ffmpeg -hide_banner -loglevel error -i /source/live-editor/desktop/assets/app-original.png -vf scale=256:256 -frames:v 1 -threads 1 -update 1 "$icon"
cp LICENSE "$doc/copyright"
install -m 644 /source/LINUX-NOTICE.md "$doc/LINUX-NOTICE.md"
cp THIRD_PARTY_NOTICES.md live-editor/package-lock.json "$doc/"
cp -R live-editor/docs/licenses "$doc/product-notices"
cp /opt/caibo-node/LICENSE "$doc/Node-LICENSE.txt"
for package in vue lucide-vue-next; do
  license=$(find "live-editor/node_modules/$package" -maxdepth 1 -iname '*license*' -type f -print -quit)
  [[ -z "$license" ]] || cp "$license" "$doc/$package-LICENSE.txt"
done

mkdir -p "$layout/usr/bin"
ln -s ../lib/caibo-recorder/caibo-recorder "$layout/usr/bin/caibo-recorder"
"$app/runtime/recorder/BililiveRecorder.Cli" --help >/dev/null
if [[ "$format" == all || "$format" == rpm-payload ]]; then
  printf '%s %s\n' "$version" "$revision" > "$layout/.package-version"
  tar -C "$layout" -cf /output/rpm-payload.tar .
  rm "$layout/.package-version"
fi
if [[ "$format" == rpm-payload ]]; then exit 0; fi

if [[ "$format" == all || "$format" == deb ]]; then
  mkdir "$layout/DEBIAN"
  cat > "$layout/DEBIAN/control" <<CONTROL
Package: caibo-recorder
Version: $deb_version
Architecture: amd64
Section: video
Priority: optional
Maintainer: Caibo Recorder contributors
Depends: libc6 (>= 2.38), libgcc-s1, libstdc++6, zlib1g, libssl3t64 | libssl3, libicu74 | libicu76 | libicu77 | libicu78, ffmpeg, fonts-noto-cjk, xdg-utils, ca-certificates
Description: Caibo live recorder and video workbench
 Records live streams and provides a local browser-based video workbench.
CONTROL
  dpkg-deb --root-owner-group --build "$layout" "$work/$deb"
  rm -r "$layout/DEBIAN"
  dpkg-deb -x "$work/$deb" "$work/deb-extracted"
  cmp /source/LINUX-NOTICE.md "$work/deb-extracted/usr/share/doc/caibo-recorder/LINUX-NOTICE.md"
  bash "$linux/smoke.sh" "$work/deb-extracted/usr/bin/caibo-recorder"
fi

if [[ "$format" == all || "$format" == appimage ]]; then
  bash "$linux/bundle-media.sh" "$app/runtime/ffmpeg" "$doc/ffmpeg"
  install -m 755 "$linux/AppRun" "$layout/AppRun"
  ln -s usr/share/applications/caibo-recorder.desktop "$layout/caibo-recorder.desktop"
  ln -s usr/share/icons/hicolor/256x256/apps/caibo-recorder.png "$layout/caibo-recorder.png"
  bash "$linux/make-appimage.sh" "$layout" "$work/$appimage" /source/.tools/linux
  (cd "$work" && "./$appimage" --appimage-extract >/dev/null)
  cmp /source/LINUX-NOTICE.md "$work/squashfs-root/usr/share/doc/caibo-recorder/LINUX-NOTICE.md"
  APPIMAGE_EXTRACT_AND_RUN=1 bash "$linux/smoke.sh" "$work/$appimage" "$work/squashfs-root/usr/lib/caibo-recorder/runtime/ffmpeg"
fi

(cd "$work" && sha256sum "${names[@]}") > "$work/$manifest"
staging=$(mktemp -d /output/.caibo-build.XXXXXX)
for item in "${names[@]}" "$manifest"; do
  cp "$work/$item" "$staging/$item"
done
for item in "${names[@]}" "$manifest"; do
  mv -T "$staging/$item" "/output/$item"
done
printf '已生成 /output/%s\n' "${names[@]}" "$manifest"
