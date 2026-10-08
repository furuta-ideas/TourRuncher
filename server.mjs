import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { plain, tour, orderTours, parseFAQ } from './lib.mjs';

const env = process.env;
const secret = env.SESSION_SECRET || randomBytes(32).toString('hex');
const master = env.FAQ_MASTER_URL || 'https://furuta-ideas.github.io/kashiwanoha-tour-guide-faq/';
const pageId = env.PLAYBOOK_ID || '2d2cbc412aed8006b7bbf5b2a26b018a';
const sourceId = env.TOUR_SOURCE_ID || '284cbc41-2aed-8052-84c5-000b8c68d91c';
const attempts = new Map();
const sign = text => createHmac('sha256', secret).update(text).digest('base64url');
const equal = (a,b) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
function authenticated(req) {
  const token = (req.headers.cookie || '').match(/(?:^|;\s*)tour_session=([^;]+)/)?.[1] || '';
  const [expiry, nonce, signature] = token.split('.');
  return !!signature && +expiry > Date.now() && equal(sign(`${expiry}.${nonce}`), signature);
}
const delay = ms => new Promise(r => setTimeout(r, ms));
let queue = Promise.resolve();
function notion(path, body) {
  const job = queue.then(async () => {
    if (!env.NOTION_TOKEN) throw new Error('Notion連携が未設定です。管理者がNOTION_TOKENを設定し、Playbookとツアー一覧を接続してください。');
    for (let retry = 0; retry < 4; retry++) {
      const response = await fetch(`https://api.notion.com/v1/${path}`, {
        method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type':'application/json' },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000)
      });
      if (response.status === 429) { await delay(Math.max(1, Number(response.headers.get('retry-after')) || 1) * 1000); continue; }
      if (!response.ok) throw new Error(`Notionの情報を取得できません（${response.status}）。接続権限を確認してください。`);
      const data = await response.json(); await delay(340); return data;
    }
    throw new Error('Notionが混み合っています。しばらくしてからアプリを開き直してください。');
  });
  queue = job.catch(() => {}); return job;
}
async function children(id) {
  const all = []; let cursor;
  do { const data = await notion(`blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`); all.push(...data.results); cursor = data.has_more ? data.next_cursor : null; } while (cursor);
  return all;
}
function compact(b) {
  const data = b[b.type] || {};
  const file = data.file || data.external;
  return { id: b.id, type: b.type, text: plain(data.rich_text || []), rich: (data.rich_text || []).map(x => ({text:x.plain_text ?? x.text?.content ?? '', href:x.href ?? x.text?.link?.url ?? null, bold:!!x.annotations?.bold})),
    url: file?.url || data.url || null, caption: plain(data.caption || []), name:data.name || '', cells: data.cells?.map(plain), checked: data.checked, children: [] };
}
async function tree(blocks, depth=0) {
  const nodes = [];
  for (const b of blocks) {
    const n = compact(b);
    if (b.type === 'synced_block') {
      const target = b.synced_block.synced_from?.block_id || b.id;
      n.children = await tree(await children(target), depth+1);
    } else if (b.has_children && depth < 14 && !['child_database','child_page'].includes(b.type)) n.children = await tree(await children(b.id), depth+1);
    nodes.push(n);
  }
  return nodes;
}
const wanted = /役割分担|コンテンツ|ＦＡＱアプリ|FAQアプリ|IDとパスワード|トラブル|緊急連絡先/;
async function sections() {
  const found = [];
  async function walk(blocks, depth=0) {
    for (const b of blocks) {
      const text = plain(b[b.type]?.rich_text || []);
      if (b.type === 'toggle' && wanted.test(text)) found.push(...await tree([b]));
      else if (b.has_children && depth < 8 && !['child_database','child_page'].includes(b.type)) await walk(await children(b.id),depth+1);
    }
  }
  await walk(await children(pageId)); return found;
}
async function tours() {
  const all=[]; let cursor;
  do { const data=await notion(`data_sources/${sourceId}/query`,{page_size:100, ...(cursor ? {start_cursor:cursor} : {})}); all.push(...data.results.map(tour)); cursor=data.has_more ? data.next_cursor:null; } while(cursor);
  return orderTours(all);
}
function json(res,status,data) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
async function body(req) { let text=''; for await(const chunk of req) { text+=chunk; if(text.length>2048) throw new Error('入力が長すぎます。'); } return JSON.parse(text || '{}'); }
const publicFiles = { '/':'index.html', '/app.js':'app.js', '/style.css':'style.css', '/lib.mjs':'../lib.mjs', '/opening.png':'opening.png', '/favicon.svg':'favicon.svg' };
const types={ html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',png:'image/png',svg:'image/svg+xml' };
export const server = http.createServer(async(req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const url = new URL(req.url,'http://localhost');
  try {
    if(url.pathname==='/health') return json(res,200,{ok:true});
    if(url.pathname==='/api/login' && req.method==='POST') {
      if (req.headers.origin && req.headers.origin !== `${req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https':'http')}://${req.headers.host}`) return json(res,403,{error:'アクセス元を確認できません。'});
      const key=req.socket.remoteAddress;
      const now=Date.now();
      for (const [ip,value] of attempts) if(value.until<now) attempts.delete(ip);
      const entry=attempts.get(key) || {count:0,until:now+60000};
      if(entry.count>=5) return json(res,429,{error:'入力回数を超えました。1分後にお試しください。'});
      const input=await body(req);
      if(typeof input.password!=='string' || !equal(input.password,env.APP_PASSWORD || '2026')) { entry.count++; attempts.set(key,entry); return json(res,401,{error:'パスワードが違います。'}); }
      attempts.delete(key);
      const value=`${now+12*60*60*1000}.${randomBytes(16).toString('hex')}`;
      res.setHeader('Set-Cookie',`tour_session=${value}.${sign(value)}; HttpOnly; SameSite=Strict; Path=/${env.NODE_ENV==='production' ? '; Secure':''}`);
      return json(res,200,{ok:true});
    }
    if(url.pathname.startsWith('/api/')) {
      if(!authenticated(req)) return json(res,401,{error:'パスワードを入力してください。'});
      if(req.method!=='GET') return json(res,405,{error:'この操作は使用できません。'});
      if(url.pathname==='/api/playbook') return json(res,200,{sections:await sections()});
      if(url.pathname==='/api/tours') return json(res,200,{tours:await tours()});
      if(url.pathname==='/api/faq') {
        const response=await fetch(master,{cache:'no-store',signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache'}});
        if(!response.ok) throw new Error('FAQマスターに接続できません。');
        return json(res,200,{rows:parseFAQ(await response.text()),source:master});
      }
      const id=url.pathname.match(/^\/api\/tour\/([0-9a-f-]{32,36})$/i)?.[1];
      if(id) { const p=await notion(`pages/${id}`); if(p.parent?.data_source_id!==sourceId && p.parent?.database_id!=='284cbc412aed8076a429fe54198f6444') return json(res,403,{error:'ツアー一覧の案件を選択してください。'}); return json(res,200,{blocks:await tree(await children(id))}); }
      return json(res,404,{error:'ページが見つかりません。'});
    }
    const file=publicFiles[url.pathname];
    if(!file || !['GET','HEAD'].includes(req.method)) { res.writeHead(404); return res.end('Not found'); }
    const bytes=await readFile(new URL(`./public/${file}`,import.meta.url));
    res.writeHead(200,{'Content-Type':types[file.split('.').pop()],'Cache-Control':file==='opening.png'?'public, max-age=86400':'no-cache'});
    res.end(req.method==='HEAD' ? undefined:bytes);
  } catch(error) { json(res,502,{error:error.name==='TimeoutError'?'接続がタイムアウトしました。アプリを開き直してください。':error.message}); }
});
if(process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\','/').split('/').pop())) server.listen(Number(env.PORT)||3000,'0.0.0.0',()=>console.log(`TourRuncher listening on ${Number(env.PORT)||3000}`));
