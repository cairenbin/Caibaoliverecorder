#!/usr/bin/env bash
set -euo pipefail
launcher=$1
media=${2:-/usr/bin}
work=$(mktemp -d)
pid=
cleanup() {
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then kill -TERM "$pid" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT
export EDITOR_DATA="$work/data" EDITOR_EXPORT_ROOT="$work/export"
unset NO_RECORDER EDITOR_PORT RECORDER_PORT FFMPEG_PATH FFPROBE_PATH

cat > "$work/test.srt" <<'SRT'
1
00:00:00,000 --> 00:00:01,000
测试
SRT
(cd "$work" && "$media/ffmpeg" -nostdin -hide_banner -loglevel error \
  -f lavfi -i color=size=160x90:duration=0.5 -vf 'subtitles=test.srt:force_style=FontName=Noto Sans CJK SC' \
  -c:v libx264 -threads 1 -pix_fmt yuv420p smoke.mp4)
[[ $("$media/ffprobe" -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$work/smoke.mp4") == h264 ]]

"$launcher" --no-browser >"$work/launch.log" 2>&1 &
pid=$!
if ! node --input-type=module - "$EDITOR_DATA" <<'JS'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const descriptor = path.join(process.argv[2], 'desktop-service.json');
const deadline = Date.now() + 45000;
let ready = false;
let lastError;
while (Date.now() < deadline) {
  try {
    const service = JSON.parse(await readFile(descriptor, 'utf8'));
    const options = { signal: AbortSignal.timeout(2000) };
    assert.equal((await fetch(service.origin, options)).status, 401);
    const headers = { authorization: 'Basic ' + Buffer.from('caibao:' + service.uiToken).toString('base64') };
    const page = await fetch(service.origin, { ...options, headers });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<script[^>]+assets\//);
    const snapshot = await fetch(service.origin + '/api/state', { ...options, headers });
    assert.equal(snapshot.status, 200);
    const state = await snapshot.json();
    assert.equal(state.recorder?.biliOnline, true);
    ready = true;
    break;
  } catch (error) {
    lastError = error;
    await delay(250);
  }
}
if (!ready) throw lastError;
JS
then
  sed '/^密码：/d' "$work/launch.log" >&2
  exit 1
fi

"$launcher" --status >/dev/null
"$launcher" --stop
for ((attempt=0; attempt<100; attempt++)); do
  if ! kill -0 "$pid" 2>/dev/null; then
    wait "$pid"
    [[ ! -e "$EDITOR_DATA/desktop-service.json" ]]
    printf 'Linux package smoke passed: %s\n' "$launcher"
    exit 0
  fi
  sleep 0.2
done
echo '后台未在预期时间内退出。' >&2
exit 1
