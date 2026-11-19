import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp, fetch } from './helpers/authenticated-app.js';
import { ui } from '../shared/ui-copy.js';
import { WORKBENCH_THEMES, WORKBENCH_THEME_SETTING } from '../shared/workbench-theme.js';

test('workbench themes preserve the classic default and survive a backend restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caibo-workbench-theme-'));
  let app;
  const start = () => createApp({data: root, port: 0, noRecorder: true, preparation: false, compact: false, ffmpeg: "not-launched", ffprobe: "not-launched"});
  const change = theme => fetch(app.runtime.origin + '/api/workbench-theme', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({theme})
  });
  try {
    app = await start();
    const recordingStyle = app.snapshot().recordingStyle;
    const danmakuStyle = app.snapshot().danmakuStyle;
    assert.equal(app.snapshot().workbenchTheme, 'classic');
    for (const theme of WORKBENCH_THEMES) {
      const response = await change(theme);
      assert.equal(response.status, 200, theme);
      assert.deepEqual(await response.json(), {theme});
      assert.equal(app.snapshot().workbenchTheme, theme);
    }
    const savedTheme = WORKBENCH_THEMES.at(-1);
    assert.equal((await change('unknown')).status, 400);
    assert.equal(app.snapshot().workbenchTheme, savedTheme);
    await app.close();
    app = null;

    app = await start();
    assert.equal(app.snapshot().workbenchTheme, savedTheme);
    assert.deepEqual(app.snapshot().recordingStyle, recordingStyle);
    assert.deepEqual(app.snapshot().danmakuStyle, danmakuStyle);
    assert.equal((await change('classic')).status, 200);
    assert.equal(app.snapshot().workbenchTheme, 'classic');
    app.store.setting(WORKBENCH_THEME_SETTING, 'a-theme-from-a-newer-version');
    assert.equal(app.snapshot().workbenchTheme, 'classic');
  } finally {
    await app?.close();
    await fs.rm(root, {recursive: true, force: true});
  }
});

test('every workbench theme has a palette, menu label, and frame swatch', async () => {
  const css=await fs.readFile(new URL('../src/theme.css',import.meta.url),'utf8');
  for(const id of WORKBENCH_THEMES){
    assert.ok(ui.workbench.theme[id], `Missing menu label for ${id}`);
    const selector=`[data-workbench-theme="${id}"]`;
    const palette=css.split(selector+' {')[1]?.split('}')[0]||'';
    assert.match(palette,/--panel:\s*#[0-9a-f]{6}\s*;/i);
  }
});
