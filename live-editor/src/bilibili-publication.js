import { ui } from '../shared/ui-copy.js';

const copy = ui.autoPost;
export const publicationModes = [
  { id: 'danmaku', label: copy.仅弹幕版 },
  { id: 'clean', label: copy.仅纯净版 },
  { id: 'dual', label: copy.双版本分P },
];

export function publicationTags(text) {
  return [...new Set(text.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean))];
}

export function publicationAccountLabel(account) {
  if (!account?.uid) return '';
  return account.name ? `${account.name}（UID ${account.uid}）` : `UID ${account.uid}`;
}

export function preventImplicitPublication(event) {
  if (event.target instanceof HTMLInputElement) event.preventDefault();
}

export function publicationValidation({ title, tags, categoryId, copyright, source }, required = true) {
  if (tags.length > 10) return copy.标签过多;
  if (!required) return '';
  if ([...title].length > 80) return copy.标题过长;
  if (!tags.length) return copy.请填标签;
  if (!/^[1-9]\d{0,8}$/.test(String(categoryId))) return copy.请选择投稿分区;
  if (![1, 2].includes(copyright)) return copy.选择投稿类型;
  if (copyright === 2 && !source.trim()) return copy.请填转载来源;
  if (copyright === 2 && source.trim().length > 200) return copy.转载来源过长;
  return '';
}

export function publicationStatus(status) {
  return ({
    queued: copy.等待导出,
    exporting: copy.正在导出,
    simulated: copy.还未提交,
    submitting: copy.正在提交,
    uploading: copy.上传中,
    submitted: copy.已提交,
    uncertain: copy.结果待确认,
    failed: copy.失败,
    blocked: copy.已暂停,
    cancelled: copy.已取消,
  })[status] || copy.还未提交;
}
