#!/usr/bin/env bash
set -euo pipefail
mirror=${1%/}
[[ "$mirror" =~ ^https://[a-zA-Z0-9.-]+(/[a-zA-Z0-9._/-]+)?$ ]]
sed -Ei '/^mirrorlist=/s/^/#/; s|^[#[:blank:]]*baseurl=https?://repo\.almalinux\.org/almalinux|baseurl='"$mirror"'|' \
  /etc/yum.repos.d/almalinux*.repo
