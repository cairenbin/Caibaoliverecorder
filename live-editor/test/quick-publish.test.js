import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { QuickPublish } from '../server/quick-publish.js';
import { Store } from '../server/store.js';

const exportJobId = 'manual-export';
const form = { accountUid: '12345', title: '本地测试选段', description: '选段简介', tags: ['直播选段'],
  categoryId: '171', copyright: 2, source: 'https://live.bilibili.com/1', mode: 'dual' };

async function setup(t, { autoPost = false, status = 'done', mode = 'dual' } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'quick-publish-')));
  const store = new Store(path.join(root, 'data'));
  t.after(async () => { store.close(); await fs.rm(root, { recursive: true, force: true }); });
  const session = store.createSession({ title: '待投稿素材', room: 999, status: 'finished' });
  const directory = path.join(root, 'exports');
  await fs.mkdir(directory);
  const clean = path.join(directory, '202611230800-0801.mp4'), danmaku = path.join(directory, '【弹幕版】202611230800-0801.mp4');
  const rows = await Promise.all([[clean, 'clean'], [danmaku, 'danmaku']].map(async ([file, text]) => {
    await fs.writeFile(file, text);
    const stat = await fs.lstat(file, { bigint: true });
    return { path: file, ...Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs'].map(key => [key, String(stat[key])])) };
  }));
  const data = { outputRoot: directory, output: { dir: directory, file: clean, danmakuFile: danmaku },
    publishedFiles: rows, ...(autoPost ? { autoPost: session.id } : {}) };
  store.run('INSERT INTO jobs(id,session,created,status,data,file,mode) VALUES(?,?,?,?,?,?,?)',
    exportJobId, session.id, new Date().toISOString(), status, JSON.stringify(data), mode === 'danmaku' ? danmaku : clean, mode);
  const calls = [];
  const uploader = {
    cookieConfigured: true, configured: true, uid: '12345', taskStatus: { status: 'queued' },
    snapshot() { return { cookieConfigured: this.cookieConfigured, configured: this.configured, accountUid: this.uid,
      accountError: this.configured ? undefined : 'B站 Cookie 缺少 bili_jct。' }; },
    async submit(input) { calls.push(input); return { taskId: 'publisher-task-1' }; },
    async task(taskId) {
      assert.equal(taskId, 'publisher-task-1');
      return this.taskStatus;
    },
  };
  return { store, session, clean, danmaku, uploader, calls, service: new QuickPublish(store, uploader) };
}

test('已完成的双版本导出可快速发布为一份投稿，顺序与本地文件名各自保留', async t => {
  const { store, clean, danmaku, service, uploader, session, calls } = await setup(t);
  const details = await service.details(exportJobId);
  assert.deepEqual(details.availableModes, ['danmaku', 'clean', 'dual']);
  assert.equal(details.mode, 'dual');
  assert.equal(details.title, '待投稿素材');
  assert.equal(details.source, '', '不要从未知平台的数字房间号推测来源链接');
  assert.equal(details.account.uid, '12345');
  assert.ok(!JSON.stringify(details).includes(clean));

  const { publication } = await service.submit(exportJobId, { ...form, paths: ['untrusted.mp4'] });
  assert.equal(publication.status, 'uploading');
  assert(calls[0].parts.every(part => typeof part.identity === 'string'));
  assert.deepEqual({ ...calls[0], parts: calls[0].parts.map(({ path, title }) => ({ path, title })) }, {
    uid: '12345', owner: { kind: 'quick', id: exportJobId }, parts: [{ title: '弹幕版', path: danmaku }, { title: '纯净版', path: clean }],
    config: { title: form.title, desc: form.description, tag: form.tags, tid: 171, copyright: 2, source: form.source, dolby: 0, hires: 0 },
  });
  assert.equal(service.isBusy(exportJobId), true);
  assert.equal(service.authorizes(exportJobId, '12345', 'publisher-task-1'), true);
  assert.equal(service.authorizes(exportJobId, '54321', 'publisher-task-1'), false);
  await assert.rejects(service.submit(exportJobId, form), { status: 409 });
  await service.tick();
  assert.equal(service.snapshot()[0].status, 'uploading');
  uploader.taskStatus = { status: 'submitted', bvid: 'BV1234567890', aid: '100' };
  await service.close();
  const restarted = new QuickPublish(store, uploader);
  await restarted.tick();
  assert.equal(restarted.snapshot()[0].status, 'submitted');
  assert.equal(restarted.snapshot()[0].session, session.id);
  assert.equal(restarted.snapshot()[0].bvid, 'BV1234567890');
  assert.equal(restarted.isBusy(exportJobId), false);
  store.run('DELETE FROM jobs WHERE id=?', exportJobId);
  assert.equal(restarted.snapshot()[0].status, 'submitted', '保留投稿结果历史');
  assert.equal(await fs.readFile(clean, 'utf8'), 'clean');
  assert.equal(await fs.readFile(danmaku, 'utf8'), 'danmaku');
});

test('快速发布核对 Cookie、投稿账号、成片身份和已完成状态', async t => {
  const { service, uploader, calls, store, danmaku } = await setup(t);
  uploader.cookieConfigured = false;
  await assert.rejects(service.details(exportJobId), /Cookie/);
  await assert.rejects(service.submit(exportJobId, form), /账号/);
  uploader.cookieConfigured = true;
  uploader.uid = '56789';
  await assert.rejects(service.submit(exportJobId, form), /账号/);
  uploader.uid = '12345';
  uploader.configured = false;
  assert.match((await service.details(exportJobId)).accountError, /bili_jct/);
  assert.equal((await service.details(exportJobId)).account.uid, '12345');
  await assert.rejects(service.submit(exportJobId, form), /bili_jct/);
  uploader.configured = true;
  await fs.writeFile(danmaku, 'same-name replacement');
  assert.deepEqual((await service.details(exportJobId)).availableModes, ['clean']);
  await assert.rejects(service.submit(exportJobId, form), /成片/);
  assert.equal(calls.length, 0);
  store.run("UPDATE jobs SET status='running' WHERE id=?", exportJobId);
  await assert.rejects(service.details(exportJobId), /导出完成/);
  store.run("UPDATE jobs SET status='done',data=json_set(data,'$.autoPost','automated') WHERE id=?", exportJobId);
  await assert.rejects(service.details(exportJobId), /无法使用快速发布/);
});

test('并发发布和手动删除竞争时不会误发，提交结果不明时禁止重复发稿', async t => {
  const { service, store, uploader, calls } = await setup(t);
  const submitting = service.submit(exportJobId, form);
  const concurrent = service.submit(exportJobId, form);
  store.deletingJobs = new Set([exportJobId]);
  await assert.rejects(concurrent, { status: 409 });
  await assert.rejects(submitting, /导出完成/);
  assert.equal(calls.length, 0);

  store.deletingJobs.clear();
  uploader.submit = async input => {
    calls.push(input);
    throw Object.assign(new Error('lost response'), { submissionUncertain: true });
  };
  const { publication } = await service.submit(exportJobId, { ...form, mode: 'clean' });
  assert.equal(publication.status, 'uncertain');
  assert.equal(publication.canRetry, false);
  await assert.rejects(service.submit(exportJobId, form), { status: 409 });
  assert.equal(calls.length, 1);
  assert.equal(service.isBusy(exportJobId), false);
});

test('快速发布校验 B站标签和转载来源长度，提交时允许上限值', async t => {
  const { service, calls } = await setup(t);
  await assert.rejects(service.submit(exportJobId, { ...form, tags: [' '] }), /1 至 10/);
  const tooManyTags = Array.from({ length: 11 }, (_, index) => `标签${index}`);
  await assert.rejects(service.submit(exportJobId, { ...form, tags: tooManyTags }), /1 至 10/);
  await assert.rejects(service.submit(exportJobId, { ...form, tags: ['a'.repeat(201)] }), /200 个字符/);
  await assert.rejects(service.submit(exportJobId, { ...form, source: 'x'.repeat(201) }), /200 个字符/);
  assert.equal(calls.length, 0);
  const source = 'x'.repeat(200);
  const { publication } = await service.submit(exportJobId, { ...form, source, tags: tooManyTags.slice(1) });
  assert.equal(publication.status, 'uploading');
  assert.equal(calls[0].config.source, source);
  assert.equal(calls[0].config.tag.length, 10);
});

test('只有明确未提交稿件的失败可重新提交', async t => {
  const { store, service, uploader, calls } = await setup(t);
  const submit = uploader.submit;
  uploader.submit = async () => { throw new Error('local request rejected'); };
  const { publication } = await service.submit(exportJobId, form);
  assert.equal(publication.status, 'failed');
  assert.equal(publication.canRetry, true);
  uploader.submit = submit;
  await service.submit(exportJobId, form);
  uploader.taskStatus = { status: 'failed', canRetry: true, error: '成片上传失败' };
  await service.tick();
  assert.equal(service.snapshot()[0].canRetry, true);
  await service.submit(exportJobId, form);
  uploader.taskStatus = { status: 'failed' };
  const restarted = new QuickPublish(store, uploader);
  await restarted.tick();
  assert.equal(restarted.snapshot()[0].status, 'failed');
  assert.equal(restarted.snapshot()[0].canRetry, false);
  await assert.rejects(restarted.submit(exportJobId, form), { status: 409 });
  assert.equal(calls.length, 2);
});

test('找不到旧任务的提交结果时，不自动重投', async t => {
  const { store, service, uploader, calls } = await setup(t);
  await service.submit(exportJobId, form);
  await service.close();
  uploader.task = async () => {
    throw Object.assign(new Error('missing previous submission'), { taskMissing: true });
  };
  const restarted = new QuickPublish(store, uploader);
  await restarted.tick();
  assert.equal(restarted.snapshot()[0].status, 'uncertain');
  assert.equal(restarted.isBusy(exportJobId), false);
  await assert.rejects(restarted.submit(exportJobId, form), { status: 409 });
  assert.equal(calls.length, 1);
});
