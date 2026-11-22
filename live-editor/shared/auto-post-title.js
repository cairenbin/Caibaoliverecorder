export const POST_DATE_TOKEN = '{录制日期}';

const formatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric',
});

export function renderAutoPostTitle(template, date) {
  return String(template ?? '').trim().replaceAll(POST_DATE_TOKEN, () => formatter.format(date));
}
