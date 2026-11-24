#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd -P)
upstream=https://github.com/kk12091209/Caibaoliverecorder.git
fork=cairenbin/Caibaoliverecorder
state="$root/.tools/upstream-linux"
output="$root/release/linux/upstream"
mode=${1:---build}
requested_tag=${2:-}
case "$mode" in --check|--build|--publish) ;; *) echo '用法：follow-upstream-linux.sh [--check|--build|--publish] [vX.Y.Z]' >&2; exit 2;; esac
if [[ -n "$requested_tag" && ! "$requested_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo '请选择形如 v0.4.7 的稳定标签。' >&2
  exit 2
fi

mkdir -p "$state"
exec 9<"$state"
flock -n 9 || { echo '已有上游检查或构建在运行。'; exit 0; }
work=$(mktemp -d "$state/run.XXXXXX")
staging=
cleanup() {
  rm -rf "$work"
  if [[ -n "$staging" ]]; then rm -rf "$staging"; fi
}
trap cleanup EXIT

git ls-remote --refs "$upstream" 'refs/heads/*' 'refs/tags/v*' |
  LC_ALL=C sort -k2 > "$work/refs"
if ! read -r object ref < <(
  awk -v tag="$requested_tag" '$2 ~ /^refs\/tags\/v[0-9]+\.[0-9]+\.[0-9]+$/ && (tag == "" || $2 == "refs/tags/" tag)' "$work/refs" |
    sort -k2,2V | tail -n 1
); then
  echo "上游没有可用的稳定版本标签：${requested_tag:-latest}" >&2
  exit 1
fi
tag=${ref#refs/tags/}
if [[ ! -f "$state/refs.tsv" ]] || ! cmp -s "$state/refs.tsv" "$work/refs"; then
  if [[ -f "$state/refs.tsv" ]]; then diff -u "$state/refs.tsv" "$work/refs" || [[ $? == 1 ]]; fi
  mv "$work/refs" "$state/refs.tsv"
fi
printf '上游稳定标签 %s (%s)\n' "$tag" "$object"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then printf 'tag=%s\n' "$tag" >> "$GITHUB_OUTPUT"; fi
if [[ "$mode" == --check ]]; then exit 0; fi

mkdir -p "$output"
release="$output/$tag"
if [[ ! -d "$release" ]]; then
  staging=$(mktemp -d "$output/.building-$tag.XXXXXX")
  candidate="$work/source"
  git clone --quiet --no-hardlinks --no-checkout "$root" "$candidate"
  git -C "$candidate" fetch --no-tags "$upstream" "$ref:refs/caibo/release"
  [[ $(git -C "$candidate" rev-parse refs/caibo/release) == "$object" ]] || {
    echo '上游标签在查询后发生变化，请重试。' >&2
    exit 1
  }
  commit=$(git -C "$candidate" rev-parse 'refs/caibo/release^{commit}')
  # The Linux builder clones this checkout. A named branch lets GitVersion
  # compute version information from the release's upstream history.
  git -C "$candidate" switch -q -c caibo-linux-build "$commit"
  grep -Fq "\"version\": \"${tag#v}\"" "$candidate/live-editor/package.json" || {
    echo "上游标签 $tag 与 package.json 版本不一致。" >&2
    exit 1
  }

  cp -R "$root/live-editor/desktop-linux" "$candidate/live-editor/"
  cp "$root/live-editor/scripts/build-linux.sh" "$candidate/live-editor/scripts/"
  cp "$root/live-editor/docs/LINUX.md" "$candidate/live-editor/docs/"
  directory_patch="$root/live-editor/desktop-linux/open-directory.patch"
  if ! git -C "$candidate" apply --reverse --check "$directory_patch" 2>/dev/null; then
    git -C "$candidate" apply "$directory_patch"
  fi
  mkdir -p "$candidate/.tools/linux" "$root/.tools/linux"
  for tool in appimagetool-x86_64.AppImage runtime-20251108-x86_64; do
    if [[ -f "$root/.tools/linux/$tool" ]]; then
      cp -p "$root/.tools/linux/$tool" "$candidate/.tools/linux/"
    fi
  done
  "$candidate/live-editor/scripts/build-linux.sh" "$staging" all 2>&1 | tee "$state/$tag-build.log"

  # Include the exact application source and the Linux overlay in the release.
  mkdir "$work/overlay"
  git -C "$candidate" archive --format=tar "$commit" | tar -C "$work/overlay" -xf -
  tar -C "$candidate" -cf - live-editor/desktop-linux live-editor/scripts/build-linux.sh \
    live-editor/docs/LINUX.md live-editor/server/directories.js | tar -C "$work/overlay" -xf -
  tar -C "$work/overlay" -czf "$staging/Caibo-$tag-linux-source.tar.gz" .
  printf '%s\t%s\t%s\n' "$tag" "$object" "$commit" > "$staging/upstream.tsv"

  appimages=("$staging/"*.AppImage)
  (cd "$work" && "${appimages[0]}" --appimage-extract 'usr/share/doc/caibo-recorder/ffmpeg/ubuntu-sources.tsv' >/dev/null)
  media_sources="$work/squashfs-root/usr/share/doc/caibo-recorder/ffmpeg/ubuntu-sources.tsv"
  {
    printf 'FFmpeg and bundled Ubuntu library sources\n\n'
    cut -f3,4 "$media_sources" | sort -u |
      while IFS=$'\t' read -r name version; do
        printf '%s %s https://launchpad.net/ubuntu/+source/%s/%s\n' "$name" "$version" "$name" "${version//:/%3A}"
      done
    printf '\nNode.js source: https://nodejs.org/dist/v24.12.0/node-v24.12.0.tar.xz\n'
    printf 'AppImage runtime source: https://github.com/AppImage/type2-runtime/tree/20251108\n'
    printf 'Application source: Caibo-%s-linux-source.tar.gz\n' "$tag"
    printf 'Git history for GitVersion: https://github.com/kk12091209/Caibaoliverecorder/commit/%s\n' "$commit"
  } > "$staging/SOURCES.txt"
  (cd "$staging" && sha256sum -- ./*.deb ./*.AppImage ./*.tar.gz SOURCES.txt upstream.tsv > SHA256SUMS.txt)
  mv -T "$staging" "$release"
  staging=
else
  read -r saved_tag saved_object commit < "$release/upstream.tsv"
  [[ "$saved_tag" == "$tag" && "$saved_object" == "$object" ]] || {
    echo '本地产物与当前上游标签不匹配，已保留原产物。' >&2
    exit 1
  }
fi
(cd "$release" && sha256sum --check SHA256SUMS.txt)
printf '本地 Release 已就绪：%s\n' "$release"
if [[ "$mode" != --publish ]]; then exit 0; fi

export PATH="$state/bin:$PATH"
export GH_PROMPT_DISABLED=1 GIT_TERMINAL_PROMPT=0
if ! command -v gh >/dev/null || ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "Release 已在本机生成。公开发布到 $fork 需要在本机安装并登录 GitHub CLI，或为 GitHub CLI 配置 GH_TOKEN。" >&2
  exit 1
fi
release_tag="linux-$tag"
title="菜播·录包机 Linux $tag"
fork_url="https://github.com/$fork.git"
remote_tag=$(git ls-remote --refs "$fork_url" "refs/tags/$release_tag" | cut -f1)
if [[ -z "$remote_tag" ]]; then
  publish_repo="$root"
  if ! git -C "$root" cat-file -e "$commit^{commit}" 2>/dev/null; then
    publish_repo="$work/publish"
    git init --quiet "$publish_repo"
    git -C "$publish_repo" fetch --no-tags "$upstream" "$ref:refs/caibo/release"
    [[ $(git -C "$publish_repo" rev-parse refs/caibo/release) == "$object" ]]
  fi
  git -C "$publish_repo" -c credential.helper= -c 'credential.helper=!gh auth git-credential' \
    push "$fork_url" "$commit:refs/tags/$release_tag"
elif [[ "$remote_tag" != "$commit" ]]; then
  echo "fork 的 $release_tag 已指向其他提交。" >&2
  exit 1
fi

if gh release view "$release_tag" --repo "$fork" --json isDraft,name > "$work/remote.json" 2>/dev/null; then
  if [[ $(jq -r .isDraft "$work/remote.json") == false ]]; then
    gh release download "$release_tag" --repo "$fork" --pattern SHA256SUMS.txt --dir "$work"
    cmp "$work/SHA256SUMS.txt" "$release/SHA256SUMS.txt"
    printf '%s 已公开发布。\n' "$release_tag"
    exit 0
  fi
  [[ $(jq -r .name "$work/remote.json") == "$title" ]] || { echo '现有草稿名称不匹配。' >&2; exit 1; }
else
  printf '上游版本 %s\n\n%s\n\n包含 Linux x86_64 DEB、AppImage、校验文件及对应应用源码。FFmpeg 和运行时源码地址见 SOURCES.txt。\n' \
    "$tag" "https://github.com/kk12091209/Caibaoliverecorder/tree/$commit" > "$work/notes"
  gh release create "$release_tag" --repo "$fork" --verify-tag --draft \
    --title "$title" --notes-file "$work/notes"
fi
gh release upload "$release_tag" --repo "$fork" --clobber \
  "$release/"*.deb "$release/"*.AppImage "$release/"*.tar.gz \
  "$release/SOURCES.txt" "$release/upstream.tsv" "$release/SHA256SUMS.txt"
gh release edit "$release_tag" --repo "$fork" --draft=false --latest
gh release view "$release_tag" --repo "$fork" --json url --jq .url
