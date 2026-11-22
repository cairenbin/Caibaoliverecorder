import path from 'node:path';
import { exportedJobFile } from './output-names.js';
import { checkedFile, fingerprint, inside, pathKey } from './storage-files.js';

const modeTitles = { clean: '纯净版', danmaku: '弹幕版' };

export async function publicationFiles(store, row, data) {
  if (data.recoveryInvalid || !['clean', 'danmaku', 'dual'].includes(row.mode)) return new Map();
  const candidates = row.mode === 'dual' ? ['danmaku', 'clean'] : [row.mode];
  const files = new Map();
  for (const mode of candidates) {
    const file = exportedJobFile(row, mode === 'clean' ? 'video' : 'danmaku');
    if (!file || !path.isAbsolute(file) || !/\.mp4$/i.test(file) || /[\x00-\x1f\x7f]/.test(file) ||
      (process.platform === 'win32' && /^[\\/]{2}[.?][\\/]/.test(file))) continue;
    const directory = path.dirname(file);
    if (data.output?.dir && pathKey(directory) !== pathKey(data.output.dir)) continue;
    if (['originals', 'archives', 'chunks', 'temp', 'profile', 'runtime'].some(folder =>
      inside(path.join(store.root, folder), file))) continue;
    const stat = await checkedFile(data.outputRoot || directory, file).catch(() => null);
    if (!stat || stat.size === 0n) continue;
    // New exports carry a receipt. Old completed exports can still use their recorded video paths.
    if (data.publishedFiles !== undefined) {
      const receipt = Array.isArray(data.publishedFiles) && data.publishedFiles.find(value =>
        typeof value?.path === 'string' && pathKey(value.path) === pathKey(file));
      if (!receipt || ['dev', 'ino', 'size', 'mtimeNs'].some(field => String(stat[field]) !== receipt[field])) continue;
    }
    files.set(mode, { path: path.resolve(file), title: modeTitles[mode], identity: fingerprint(stat) });
  }
  if (files.size === 2 && pathKey(files.get('clean').path) === pathKey(files.get('danmaku').path)) {
    throw new Error('双版本成片路径冲突，请重新导出后再投稿。');
  }
  return files;
}
