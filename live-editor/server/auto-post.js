import { renderAutoPostDescription, renderAutoPostTitle } from '../shared/auto-post-template.js';
import { normalizePublicationTags } from '../shared/publication-tags.js';
import { publicationFiles } from './publication-files.js';

const MODES = ['danmaku', 'clean', 'dual'];
const anchorPattern = /^bilibili:(\d{1,20})$/;
const settingsKey = id => `bilibili-auto-post:${id}`;
const defaults = { enabled: false, titleTemplate: '', description: '', homepage: '', tags: [], categoryId: '', mode: 'danmaku', copyright: '', source: '' };
const unknownSubmission = '无法确认稿件是否已提交，请在 B站创作中心核对。';
const pausedBeforeSubmission = Symbol('paused before submission');
const unfinishedSource = "EXISTS(SELECT 1 FROM sources WHERE session=s.id AND closed<>2)";

function normalize(input) {
  if (!input || typeof input.enabled !== 'boolean' || !MODES.includes(input.mode)) {
    throw new Error('自动投稿设置无效。');
  }
  const tags = normalizePublicationTags(input.tags, { required: input.enabled, legacy: !input.enabled });
  const text = (key, limit) => {
    if (typeof input[key] !== 'string' || input[key].length > limit) throw new Error('自动投稿设置超出长度限制。');
    return input[key].trim();
  };
  const titleTemplate = text('titleTemplate', 160), description = text('description', 2000), homepage = text('homepage', 500);
  if (input.enabled && !titleTemplate) throw new Error('请填写标题格式。');
  if (input.enabled && renderAutoPostTitle(titleTemplate, new Date()).length > 80) throw new Error('投稿标题最多 80 个字符。');
  if (homepage) {
    const url = URL.parse(homepage);
    if (url?.protocol !== 'https:' || url.hostname !== 'space.bilibili.com' || url.username || url.password || url.port) throw new Error('请填写 B站主播主页链接。');
  }
  if (input.enabled && renderAutoPostDescription(description, homepage).length > 2000) throw new Error('简介与主播主页合计最多 2000 个字符。');
  const categoryId = String(input.categoryId ?? '');
  if ((categoryId || input.enabled) && !/^[1-9]\d{0,8}$/.test(categoryId)) throw new Error('请选择 B站投稿分区。');
  const copyright = input.copyright === '' || input.copyright == null ? '' : Number(input.copyright);
  if (![1, 2].includes(copyright) && (input.enabled || copyright !== '')) throw new Error('请选择自制或转载。');
  const source = input.source === undefined ? '' : text('source', 200);
  if (input.enabled && copyright === 2 && (!source || /[\x00-\x1f\x7f]/.test(source))) throw new Error('转载稿件请填写有效来源。');
  return { enabled: input.enabled, titleTemplate, description, homepage, tags, categoryId, copyright, source: copyright === 2 ? source : '', mode: input.mode };
}

export class AutoPost {
  constructor(store, credentials, media, anchors, busy, publisher) {
    Object.assign(this, { store, credentials, media, anchors, busy, publisher, active: null });
    store.db.exec(`CREATE TABLE IF NOT EXISTS auto_post_jobs(
      session TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      room TEXT NOT NULL, config TEXT NOT NULL, status TEXT NOT NULL,
      export_job TEXT, result TEXT, error TEXT NOT NULL DEFAULT ''
    )`);
  }

  get configured() { return this.credentials.snapshot().platforms.bilibili.configured; }
  get uid() { return this.credentials.get('bilibili').match(/(?:^|;\s*)DedeUserID=(\d+)/)?.[1] || ''; }

  async settings(key, input) {
    const room = anchorPattern.exec(key)?.[1];
    if (!room || !this.anchors().some(item => item.key === key)) throw new Error('找不到这个 B站监控主播。');
    if (!this.configured) throw new Error('请先填写 B站 Cookie。');
    const publication = this.publisher.snapshot();
    const uid = publication.accountUid || '';
    let stored = this.store.setting(settingsKey(room)) || defaults;
    if (input !== undefined) {
      const next = normalize(input);
      if (next.enabled) {
        if (!publication.configured || !uid) throw new Error(publication.accountError || 'B站 Cookie 当前不可用。');
        if (String(input.accountUid) !== uid) throw new Error('投稿账号已改变，请重新打开设置。');
        await this.publisher.assertCategory(next.categoryId, uid);
        if (!this.anchors().some(item => item.key === key)) throw new Error('找不到这个 B站监控主播。');
        stored = this.store.setting(settingsKey(room)) || defaults;
      }
      const retainTime = next.enabled && stored.live && stored.enabled && stored.uid === uid;
      const enabledAt = retainTime ? stored.enabledAt : Math.max(Date.now(), (stored.enabledAt || 0) + 1);
      stored = { ...next, uid, live: next.enabled, enabledAt };
      this.store.transaction(() => {
        this.store.setting(settingsKey(room), stored);
        if (!stored.enabled) this.cancelUnsubmitted(room);
        // A user may opt in after FileOpening. An open source marked by the
        // Bilibili recorder identifies this session without looking back at imports.
        if (stored.enabled) {
          const session = this.store.get(`SELECT s.id,s.created FROM sessions s
            WHERE s.room=? AND s.status='recording' AND s.deleted_at=''
            AND EXISTS (SELECT 1 FROM sources src JOIN source_storage ss ON ss.source=src.id
              WHERE src.session=s.id AND src.closed=0 AND ss.eligible=1)
            ORDER BY s.created DESC LIMIT 1`, Number(room));
          if (session) this.queue(session, room, stored);
        }
      });
    }
    const { uid: savedUid, enabledAt, live, ...visible } = stored;
    return { ...defaults, ...visible, enabled: stored.enabled === true && live === true && (!uid || uid === savedUid),
      account: uid ? { uid } : null, accountError: publication.accountError };
  }

  capture(session) {
    const room = String(session.room), config = this.store.setting(settingsKey(room));
    const start = Date.parse(session.created);
    if (!config?.live || !config.enabled || !config.uid || !this.configured || !Number.isFinite(start) || start < config.enabledAt) return;
    if (!this.anchors().some(item => item.key === `bilibili:${room}`)) return;
    this.queue(session, room, config);
  }

  queue(session, room, config) {
    const date = new Date(session.created);
    if (!Number.isFinite(date.getTime())) return;
    const title = renderAutoPostTitle(config.titleTemplate, date);
    const result = this.store.run(`INSERT INTO auto_post_jobs(session,room,config,status) VALUES(?,?,?,'queued')
      ON CONFLICT(session) DO UPDATE SET config=excluded.config,status='queued',export_job=NULL,error='',result=NULL
      WHERE auto_post_jobs.status='cancelled'`,
      session.id, room, JSON.stringify({ ...config, title }));
    if (result.changes) this.store.diagnostics?.record('自动投稿', `房间 ${room}：已登记，等待录像收尾。`);
  }

  remove(key) {
    const room = anchorPattern.exec(key)?.[1];
    if (!room) return;
    this.store.run('DELETE FROM settings WHERE key=?', settingsKey(room));
    this.cancelUnsubmitted(room);
  }

  cancelUnsubmitted(room) {
    this.store.run(`UPDATE auto_post_jobs SET status='cancelled',error='' WHERE room=?
      AND (status IN ('queued','exporting','blocked') OR (status='failed' AND json_extract(result,'$.taskId') IS NULL))`, room);
  }

  retry(session) {
    const row = this.store.get("SELECT * FROM auto_post_jobs WHERE session=? AND status='failed'", session);
    if (!this.store.session(session) || !row || !JSON.parse(row.config).live || (row.result && JSON.parse(row.result).taskId)) {
      throw new Error('这项投稿现在无法重试，请在 B站创作中心核对。');
    }
    this.status(session, 'queued');
    return { ok: true };
  }

  isUploadingExport(jobId) {
    return !!this.store.get("SELECT 1 FROM auto_post_jobs WHERE export_job=? AND status IN ('submitting','uploading')", jobId);
  }

  hasPendingExport() {
    return !!this.store.get(`SELECT 1 FROM auto_post_jobs p JOIN sessions s ON s.id=p.session
      WHERE s.deleted_at='' AND p.status IN ('queued','exporting') LIMIT 1`);
  }

  authorizes(session, uid, taskId) {
    const job = this.store.get("SELECT room,config,result FROM auto_post_jobs WHERE session=? AND status='uploading'", session);
    if (!job || !this.store.session(session)) return false;
    const config = JSON.parse(job.config);
    const current = this.store.setting(settingsKey(job.room));
    return current?.live === true && current.enabled && config.live === true && config.uid === uid && current.uid === uid &&
      current.enabledAt === config.enabledAt && JSON.parse(job.result || '{}').taskId === taskId &&
      this.anchors().some(item => item.key === `bilibili:${job.room}`);
  }

  snapshot() {
    const busy = this.busy();
    const preparation = this.media.preparation;
    const jobs = this.store.all(`SELECT p.*,s.status AS recording_status,${unfinishedSource} AS source_pending
      FROM auto_post_jobs p JOIN sessions s ON s.id=p.session
      WHERE s.deleted_at='' ORDER BY s.created DESC LIMIT 200`).map(row => {
      const { title, mode, live } = JSON.parse(row.config);
      const result = row.result && JSON.parse(row.result);
      let stage;
      if (row.status === 'queued') {
        if (row.recording_status !== 'finished' || row.source_pending) stage = 'waiting-source';
        else if (busy) stage = 'waiting-idle';
        else if (preparation?.automaticExportPriority === row.session) {
          stage = preparation.active?.id === row.session ? 'preparing' : 'waiting-preparation';
        }
      }
      return { id: row.session, session: row.session, title, mode, status: row.status, stage, error: row.error,
        parts: result?.parts?.map(part => ({ title: part.title })), progress: result?.progress,
        aid: result?.aid, bvid: result?.bvid, canRetry: live === true && row.status === 'failed' && !result?.taskId };
    });
    return { cookieConfigured: this.configured, simulation: false, jobs };
  }

  tick() {
    if (this.closed || this.active) return;
    this.active = this.process().finally(() => { this.active = null; });
    return this.active;
  }

  async process() {
    await this.refreshUploads();
    const preparation = this.media.preparation;
    preparation?.prioritizeAutomaticExport();
    const busy = this.busy();
    const rows = this.store.all(`SELECT p.*,s.duration,s.status AS recording_status,${unfinishedSource} AS source_pending,
      (SELECT error FROM sources WHERE session=s.id AND closed<>2 AND error<>'' LIMIT 1) AS source_error
      FROM auto_post_jobs p JOIN sessions s ON s.id=p.session
      WHERE s.deleted_at='' AND p.status IN ('queued','exporting','blocked')
      ORDER BY s.created ASC`);
    for (const row of rows) {
      const config = JSON.parse(row.config), current = this.store.setting(settingsKey(row.room));
      if (!config.live || !current?.live || !current.enabled || config.enabledAt !== current.enabledAt ||
          !this.anchors().some(item => item.key === `bilibili:${row.room}`)) {
        this.status(row.session, 'cancelled');
        continue;
      }
      if (row.source_error && ['finished', 'finishing'].includes(row.recording_status)) {
        this.status(row.session, 'failed', row.source_error);
        continue;
      }
      if (busy || row.recording_status !== 'finished' || row.source_pending || this.store.deletions?.has(row.session)) continue;
      if (!this.uid || this.uid !== config.uid || this.uid !== current.uid) {
        this.status(row.session, 'blocked', 'B站 Cookie 当前不可用或投稿账号已改变。');
        continue;
      }
      try {
        const publication = this.publisher.snapshot();
        if (!publication.configured) {
          this.status(row.session, 'blocked', publication.accountError || 'B站 Cookie 当前不可用。');
          continue;
        }
        if (!row.duration || !config.title || config.title.length > 80) throw new Error('请检查录像时长和投稿标题。');
        const existing = this.store.get("SELECT * FROM jobs WHERE session=? AND json_valid(data) AND json_extract(data,'$.autoPost')=? ORDER BY rowid DESC LIMIT 1", row.session, row.session);
        if (!existing) {
          if (preparation?.prioritizeAutomaticExport(row.session)) {
            this.status(row.session, 'queued');
            return;
          }
          await this.media.enqueue(row.session, { scope: 'full', mode: config.mode }, { autoPost: row.session });
          this.status(row.session, 'exporting');
          this.store.diagnostics?.record('自动投稿', `房间 ${row.room}：已加入导出队列。`);
          return;
        }
        if (existing.status === 'done') {
          const files = await publicationFiles(this.store, existing, this.store.jobDetails(existing));
          if (existing.mode !== config.mode || files.size !== (config.mode === 'dual' ? 2 : 1)) {
            throw new Error('自动导出的成片已移动、修改或删除。');
          }
          await this.submit(row, config, existing, [...files.values()]);
          return;
        } else if (['queued', 'running', 'saving', 'finalizing', 'cancelling'].includes(existing.status)) {
          this.status(row.session, 'exporting');
        } else {
          this.store.run(`UPDATE auto_post_jobs SET export_job=? WHERE session=?`, existing.id, row.session);
          this.status(row.session, 'blocked', '请在导出任务中继续处理。');
        }
      } catch (error) {
        this.status(row.session, 'failed', error.message);
        this.store.diagnostics?.record('自动投稿', error, { level: '警告' });
      }
    }
  }

  canSubmit(row, config, exportJob) {
    const current = this.store.setting(settingsKey(row.room));
    if (this.closed || this.busy() || !current?.live || !current.enabled || config.uid !== this.uid ||
        config.uid !== current.uid || config.enabledAt !== current.enabledAt ||
        !this.anchors().some(item => item.key === `bilibili:${row.room}`)) return false;
    if (!this.store.session(row.session) || this.store.deletingJobs?.has(exportJob.id)) return false;
    const output = this.store.get("SELECT file,mode,data FROM jobs WHERE id=? AND status='done'", exportJob.id);
    return !!output && output.file === exportJob.file && output.mode === exportJob.mode && output.data === exportJob.data;
  }

  async submit(row, config, exportJob, parts) {
    if (!this.canSubmit(row, config, exportJob)) return;
    const result = { parts: parts.map(({ title, path }) => ({ title, path })) };
    const uploaderConfig = {
      title: config.title,
      desc: renderAutoPostDescription(config.description, config.homepage),
      tag: config.tags, tid: Number(config.categoryId), copyright: config.copyright,
      ...(config.copyright === 2 ? { source: config.source } : {}), dolby: 0, hires: 0,
    };
    const claimed = this.store.run(`UPDATE auto_post_jobs SET status='submitting',export_job=?,error='',result=?
      WHERE session=? AND status IN ('queued','exporting','blocked')`, exportJob.id, JSON.stringify(result), row.session);
    if (!claimed.changes) return;
    try {
      const { taskId } = await this.publisher.submit({ uid: config.uid, config: uploaderConfig, parts,
        owner: { kind: 'auto', id: row.session },
        beforeSend: () => {
          if (!this.canSubmit(row, config, exportJob)) throw pausedBeforeSubmission;
        },
      });
      this.saveResult(row.session, 'uploading', { ...result, taskId });
      this.store.diagnostics?.record('自动投稿', `房间 ${row.room}：已加入投稿队列，共 ${parts.length} P。`);
    } catch (error) {
      if (error === pausedBeforeSubmission) {
        this.saveResult(row.session, 'exporting', result);
        return;
      }
      const uncertain = error.submissionUncertain === true;
      this.saveResult(row.session, uncertain ? 'uncertain' : 'failed', result, uncertain ? unknownSubmission : error.message);
    }
  }

  async refreshUploads() {
    // Preserve submissions interrupted while creating the local task record.
    this.store.run("UPDATE auto_post_jobs SET status='uncertain',error=? WHERE status='submitting'", unknownSubmission);
    const pending = this.store.all("SELECT session,result FROM auto_post_jobs WHERE status='uploading'");
    for (const row of pending) {
      if (this.closed) break;
      const result = JSON.parse(row.result);
      try {
        const current = await this.publisher.task(result.taskId);
        const status = ['queued', 'submitting'].includes(current.status) ? 'uploading' : current.status;
        const error = current.error || (status === 'uncertain' ? unknownSubmission : '');
        const taskId = status === 'failed' && current.canRetry === true ? undefined : result.taskId;
        this.saveResult(row.session, status, { ...result, taskId, progress: current.progress, aid: current.aid, bvid: current.bvid }, error);
      } catch (error) {
        this.saveResult(row.session, error.taskMissing ? 'uncertain' : 'uploading', result,
          error.taskMissing ? unknownSubmission : error.message);
      }
    }
  }

  saveResult(session, status, result, error = '') {
    const data = JSON.stringify(result);
    this.store.run(`UPDATE auto_post_jobs SET status=?,result=?,error=? WHERE session=? AND status<>'cancelled'
      AND (status<>? OR result IS NOT ? OR error<>?)`, status, data, error, session, status, data, error);
  }

  status(id, status, error = '') {
    this.store.run("UPDATE auto_post_jobs SET status=?,error=? WHERE session=? AND status<>'cancelled' AND (status<>? OR error<>?)", status, error, id, status, error);
  }

  async close() {
    this.closed = true;
    await this.active?.catch(() => {});
  }
}
