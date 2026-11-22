import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AutoPost } from '../server/auto-post.js';
import { clipFile } from '../server/output-names.js';
import { Store } from '../server/store.js';

const key = 'bilibili:123';
const settings = { enabled: true, titleTemplate: '直播回放｜{录制日期}', description: '示例简介',
  homepage: 'https://space.bilibili.com/123', tags: ['直播回放'], categoryId: '', mode: 'dual' };

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caibo-auto-post-'));
  const store = new Store(root);
  t.after(async () => { store.close(); await fs.rm(root, { recursive: true, force: true }); });
  const credentials = {
    cookie: '', configured: false,
    snapshot() { return { platforms: { bilibili: { configured: this.configured } } }; },
    get() { return this.cookie; },
  };
  const history = [];
  const media = { async enqueue(id, input, marker) {
    history.push({ id, ...input });
    store.run('INSERT INTO jobs(id,session,created,status,data,file,mode) VALUES(?,?,?,?,?,?,?)',
      'job:' + id, id, new Date().toISOString(), 'queued', JSON.stringify(marker), '', input.mode);
  } };
  const service = () => new AutoPost(store, credentials, media, () => [{ key }], () => false);
  return { root, store, credentials, history, service };
}

test('只在已有 B站 Cookie 的 B站主播上开启，旧素材不加入模拟投稿', async t => {
  const { store, credentials, service } = await setup(t);
  const autoPost = service();
  assert.equal(autoPost.snapshot().cookieConfigured, false);
  assert.throws(() => autoPost.settings(key, settings), /Cookie/);
  credentials.configured = true;
  credentials.cookie = 'SESSDATA=synthetic; DedeUserID=123';
  assert.throws(() => autoPost.settings('douyin:123', settings), /B站监控主播/);
  assert.equal(autoPost.settings(key).enabled, false);
  const earlier = store.createSession({ room: 123, created: '2000-01-01T12:00:00Z' });
  autoPost.settings(key, settings);
  autoPost.capture(earlier);
  assert.equal(autoPost.snapshot().jobs.length, 0);
  assert.doesNotMatch(JSON.stringify(autoPost.settings(key)), /SESSDATA|synthetic/);
});

test('封口后只建一个导出任务，恢复后继续同一任务并按指定顺序模拟双版本投稿', async t => {
  const { root, store, credentials, service, history } = await setup(t);
  credentials.configured = true;
  credentials.cookie = 'SESSDATA=synthetic; DedeUserID=123';
  const autoPost = service();
  autoPost.settings(key, settings);
  const date = new Date(Date.now() + 1000);
  const session = store.createSession({ room: 123, created: date.toISOString() });
  const source = store.addSource(session.id, path.join(root, 'original.flv'), 0, session.created, false);
  autoPost.capture(session);
  autoPost.capture(session);
  await autoPost.tick();
  assert.equal(history.length, 0);
  store.run("UPDATE sessions SET duration=3,status='finished' WHERE id=?", session.id);
  await autoPost.tick();
  assert.equal(history.length, 0);
  store.run('UPDATE sources SET closed=2 WHERE id=?', source.id);
  await autoPost.tick();
  assert.deepEqual(history, [{ id: session.id, scope: 'full', mode: 'dual' }]);
  const recovered = service();
  await recovered.tick();
  assert.equal(history.length, 1);
  const clean = path.join(root, '202611221530-202611221531.mp4'), danmaku = clipFile(clean, 'danmaku');
  await fs.writeFile(clean, 'fixture');
  await fs.writeFile(danmaku, 'fixture');
  store.run("UPDATE jobs SET status='done',file=? WHERE session=?", clean, session.id);
  credentials.cookie = 'SESSDATA=other-synthetic; DedeUserID=456';
  await recovered.tick();
  assert.equal(recovered.snapshot().jobs[0].status, 'blocked');
  credentials.cookie = 'SESSDATA=synthetic; DedeUserID=123';
  await recovered.tick();
  assert.deepEqual(recovered.snapshot().jobs[0].parts, [{ title: '弹幕版' }, { title: '纯净版' }]);
  assert.equal(recovered.snapshot().jobs[0].status, 'simulated');
  const { result } = store.get('SELECT result FROM auto_post_jobs WHERE session=?', session.id);
  assert.deepEqual(JSON.parse(result).parts.map(part => part.path), [danmaku, clean]);
  assert.equal(JSON.parse(result).description, '示例简介\n主播主页：https://space.bilibili.com/123');
  assert.equal(history.length, 1);
});
