import fs from 'node:fs/promises';
import { renderAutoPostTitle } from '../shared/auto-post-title.js';
import { clipFile } from './output-names.js';

const MODES = ['danmaku', 'clean', 'dual'];
const anchorPattern = /^bilibili:(\d{1,20})$/;
const settingsKey = id => `bilibili-auto-post:${id}`;
const defaults = { enabled: false, titleTemplate: '', description: '', homepage: '', tags: [], categoryId: '', mode: 'danmaku' };

function normalize(input) {
  if (!input || typeof input.enabled !== 'boolean' || !MODES.includes(input.mode) ||
    !Array.isArray(input.tags) || input.tags.length > 100 || input.tags.some(tag => typeof tag !== 'string')) {
    throw new Error('自动投稿设置无效。');
  }
  const tags = [...new Set(input.tags.map(tag => tag.trim()).filter(Boolean))];
  if (tags.join(',').length > 200) throw new Error('投稿标签内容过长。');
  const text = (key, limit) => {
    if (typeof input[key] !== 'string' || input[key].length > limit) throw new Error('自动投稿设置超出长度限制。');
    return input[key].trim();
  };
  const titleTemplate = text('titleTemplate', 160), description = text('description', 2000), homepage = text('homepage', 500);
  if (input.enabled && !titleTemplate) throw new Error('请填写标题格式。');
  if (homepage) {
    const url = URL.parse(homepage);
    if (url?.protocol !== 'https:' || url.hostname !== 'space.bilibili.com' || url.username || url.password || url.port) throw new Error('请填写 B站主播主页链接。');
  }
  const categoryId = String(input.categoryId ?? '');
  if (categoryId && !/^\d{1,9}$/.test(categoryId)) throw new Error('投稿分区无效。');
  return { enabled: input.enabled, titleTemplate, description, homepage, tags, categoryId, mode: input.mode };
}

// This test channel deliberately has no uploader dependency or transport.
// An outcome describes the files that would be sent in one multi-part submission.
export class AutoPost {
  constructor(store, credentials, media, anchors, busy) {
    Object.assign(this, { store, credentials, media, anchors, busy, active: null });
    store.db.exec(`CREATE TABLE IF NOT EXISTS auto_post_jobs(
      session TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      room TEXT NOT NULL, config TEXT NOT NULL, status TEXT NOT NULL,
      export_job TEXT, result TEXT, error TEXT NOT NULL DEFAULT ''
    )`);
  }

  get configured() { return this.credentials.snapshot().platforms.bilibili.configured; }
  get uid() { return this.credentials.get('bilibili').match(/(?:^|;\s*)DedeUserID=(\d+)/)?.[1] || ''; }

  settings(key, input) {
    const room = anchorPattern.exec(key)?.[1];
    if (!room || !this.anchors().some(item => item.key === key)) throw new Error('找不到这个 B站监控主播。');
    if (!this.configured) throw new Error('请先填写 B站 Cookie。');
    let stored = this.store.setting(settingsKey(room)) || defaults;
    if (input !== undefined) {
      const next = normalize(input);
      if (next.enabled && !this.uid) throw new Error('B站 Cookie 当前不可用。');
      stored = { ...next, uid: this.uid, enabledAt: next.enabled && stored.enabled ? stored.enabledAt : Date.now() };
      this.store.setting(settingsKey(room), stored);
    }
    const { uid, enabledAt, ...visible } = stored;
    return { ...visible, account: this.uid ? { uid: this.uid } : null };
  }

  capture(session) {
    const room = String(session.room), config = this.store.setting(settingsKey(room));
    const start = Date.parse(session.created);
    if (!config?.enabled || !config.uid || !this.configured || !Number.isFinite(start) || start < config.enabledAt) return;
    if (!this.anchors().some(item => item.key === `bilibili:${room}`)) return;
    const title = renderAutoPostTitle(config.titleTemplate, new Date(start));
    this.store.run(`INSERT OR IGNORE INTO auto_post_jobs(session,room,config,status) VALUES(?,?,?,'queued')`,
      session.id, room, JSON.stringify({ ...config, title }));
  }

  remove(key) {
    const room = anchorPattern.exec(key)?.[1];
    if (!room) return;
    this.store.run('DELETE FROM settings WHERE key=?', settingsKey(room));
    this.store.run(`UPDATE auto_post_jobs SET status='cancelled',error='' WHERE room=? AND status NOT IN ('simulated','cancelled')`, room);
  }

  retry(session) {
    const row = this.store.get("SELECT * FROM auto_post_jobs WHERE session=? AND status='failed'", session);
    if (!this.store.session(session) || !row) throw new Error('这项模拟投稿当前无法重试。');
    this.status(session, 'queued');
    return { ok: true };
  }

  snapshot() {
    const jobs = this.store.all(`SELECT p.* FROM auto_post_jobs p JOIN sessions s ON s.id=p.session
      WHERE s.deleted_at='' ORDER BY s.created DESC LIMIT 200`).map(row => {
      const { title, mode } = JSON.parse(row.config);
      return { id: row.session, session: row.session, title, mode, status: row.status, error: row.error,
        ...(row.result ? { parts: JSON.parse(row.result).parts.map(part => ({ title: part.title })) } : {}) };
    });
    return { cookieConfigured: this.configured, simulation: true, jobs };
  }

  tick() {
    if (this.closed || this.active || this.busy()) return;
    this.active = this.process().finally(() => { this.active = null; });
    return this.active;
  }

  async process() {
    const rows = this.store.all(`SELECT p.*,s.duration FROM auto_post_jobs p JOIN sessions s ON s.id=p.session
      WHERE s.deleted_at='' AND s.status='finished' AND p.status IN ('queued','exporting','blocked')
      AND NOT EXISTS(SELECT 1 FROM sources WHERE session=s.id AND closed<>2)
      ORDER BY s.created ASC`);
    for (const row of rows) {
      const config = JSON.parse(row.config), current = this.store.setting(settingsKey(row.room));
      if (!current?.enabled || !this.anchors().some(item => item.key === `bilibili:${row.room}`)) {
        this.status(row.session, 'cancelled');
        continue;
      }
      if (!this.uid || this.uid !== config.uid || this.uid !== current.uid) {
        this.status(row.session, 'blocked', 'B站 Cookie 当前不可用或投稿账号已改变。');
        continue;
      }
      try {
        if (!row.duration || !config.title || [...config.title].length > 80) throw new Error('请检查录像时长和投稿标题。');
        const existing = this.store.get("SELECT * FROM jobs WHERE session=? AND json_valid(data) AND json_extract(data,'$.autoPost')=? ORDER BY rowid DESC LIMIT 1", row.session, row.session);
        if (!existing) {
          await this.media.enqueue(row.session, { scope: 'full', mode: config.mode }, { autoPost: row.session });
          this.status(row.session, 'exporting');
          return;
        }
        if (existing.status === 'done') {
          const files = config.mode === 'dual'
            ? [{ title: '弹幕版', path: clipFile(existing.file, 'danmaku') }, { title: '纯净版', path: existing.file }]
            : [{ title: config.mode === 'clean' ? '纯净版' : '弹幕版', path: existing.file }];
          for (const part of files) if (!(await fs.stat(part.path)).isFile()) throw new Error('自动导出的成片已不可用。');
          this.store.run(`UPDATE auto_post_jobs SET status='simulated',export_job=?,error='',result=? WHERE session=? AND status<>'cancelled'`,
            existing.id, JSON.stringify({ title: config.title, description: [config.description, config.homepage ? `主播主页：${config.homepage}` : ''].filter(Boolean).join('\n'), tags: config.tags, parts: files }), row.session);
        } else if (['queued', 'running', 'saving', 'finalizing', 'cancelling'].includes(existing.status)) {
          this.status(row.session, 'exporting');
        } else {
          this.store.run(`UPDATE auto_post_jobs SET export_job=? WHERE session=?`, existing.id, row.session);
          this.status(row.session, 'blocked', '请在导出任务中继续处理。');
        }
      } catch (error) { this.status(row.session, 'failed', error.message); }
    }
  }

  status(id, status, error = '') {
    this.store.run("UPDATE auto_post_jobs SET status=?,error=? WHERE session=? AND status<>'cancelled' AND (status<>? OR error<>?)", status, error, id, status, error);
  }

  async close() {
    this.closed = true;
    await this.active?.catch(() => {});
  }
}
