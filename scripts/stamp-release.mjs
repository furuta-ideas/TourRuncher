import { readFile, writeFile } from 'node:fs/promises';

const path = process.argv[2] || '_site/index.html';
const now = new Date();
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).formatToParts(now).map(p => [p.type, p.value]));
const label = `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}（日本時間）`;
const html = await readFile(path, 'utf8');
const pattern = /(<p class="updated-at">更新日時：)<time\b[^>]*>[\s\S]*?<\/time>/;
if (!pattern.test(html)) throw new Error('更新日時の表示箇所が見つかりません。');
await writeFile(path, html.replace(pattern, `$1<time datetime="${now.toISOString()}">${label}</time>`));
console.log(`Release timestamp: ${label}`);
