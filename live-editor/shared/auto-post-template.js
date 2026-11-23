import { ui } from './ui-copy.js';

export const POST_DATE_TOKEN = '{录制日期}';

const formatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric',
});

export function renderAutoPostTitle(template, date) {
  return String(template ?? '').trim().replaceAll(POST_DATE_TOKEN, () => formatter.format(date));
}

export function renderAutoPostDescription(description, homepage) {
  const intro = (description ?? '').trim();
  const link = (homepage ?? '').trim();
  return [intro, link ? ui.autoPost.简介主页链接(link) : ''].filter(Boolean).join('\n');
}
