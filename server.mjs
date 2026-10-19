import http from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { plain, tour, orderTours, overviewBlocks, redactOverview } from './lib.mjs';

const env = process.env;
let secret = env.SESSION_SECRET;
const faqDataPath = env.FAQ_DATA_PATH;
const pageId = env.PLAYBOOK_ID || '2d2cbc412aed8006b7bbf5b2a26b018a';
const sourceId = env.TOUR_SOURCE_ID || '284cbc41-2aed-8052-84c5-000b8c68d91c';
const materialFiles=new Map();
function registerMaterials(nodes){
 function scan(items,inContent=false){for(const n of items){const allowed=inContent || (n.type==='toggle' && /コンテンツ/.test(n.text || ''));if(allowed && ['file','video','audio','pdf'].includes(n.type) && n.url)materialFiles.set(n.id,n);scan(n.children || [],allowed);}}
 scan(nodes);
}
async function downloadMaterial(id,res,metadata=false){
 if(!materialFiles.has(id))registerMaterials(await sections(/コンテンツ/));
 const item=materialFiles.get(id);
 if(!item)return json(res,404,{error:'コンテンツが見つかりません。アプリを開き直してください。'});
 const latest=Date.parse(item.expiresAt)>Date.now()+60000?item:compact(await notion('blocks/'+id));
 const url=new URL(latest.url || item.url);
 if(url.protocol!=='https:' || !/(^|\.)amazonaws\.com$|(^|\.)notion-static\.com$/.test(url.hostname))return json(res,400,{error:'このファイルはダウンロードに対応していません。'});
 if(metadata)return json(res,200,{url:url.href,name:latest.name || item.name || decodeURIComponent(url.pathname.split('/').pop()),direct:true});
 if(env.DIRECT_DOWNLOADS==='1')return json(res,400,{error:'配布元から直接ダウンロードしてください。'});
 const response=await fetch(url,{signal:AbortSignal.timeout(3600000),redirect:'error'});
 if(!response.ok || !response.body)return json(res,502,{error:'ファイルを取得できません。しばらくしてから再度お試しください。'});
 const filename=latest.name || item.name || decodeURIComponent(url.pathname.split('/').pop()) || 'download';
 const extension=filename.match(/\.[a-z0-9]{1,8}$/i)?.[0] || '';
 res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="download${extension}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,'Cache-Control':'no-store',...(response.headers.get('content-length')?{'Content-Length':response.headers.get('content-length')}:{})});
 await pipeline(Readable.fromWeb(response.body),res);
}
const equal = (a,b) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
function authenticated(req) {
  const [issued,nonce,signature]=(req.headers['x-playbook-internal-proof'] || '').split('.');
  if(!signature || !/^[A-Za-z0-9_-]{43}$/.test(nonce || '') || !Number.isFinite(+issued) || Math.abs(Date.now()-Number(issued))>10000)return false;
  const expected=createHmac('sha256',secret).update(`playbook-internal-v2\n${req.method}\n${req.url}\n${issued}.${nonce}`).digest('base64url');
  return equal(expected,signature);
}
const delay = ms => new Promise(r => setTimeout(r, ms));
let queue = Promise.resolve();
function notion(path, body) {
  const job = (env.CLOUDFLARE_WORKER==='1'?Promise.resolve():queue).then(async () => {
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
  return { id: b.id, type: b.type, text: plain(data.rich_text || []), rich: (data.rich_text || []).map(x => ({text:x.plain_text ?? x.text?.content ?? '', href:x.href ?? x.text?.link?.url ?? null, bold:!!x.annotations?.bold, color:x.annotations?.color || 'default', italic:!!x.annotations?.italic, underline:!!x.annotations?.underline, strike:!!x.annotations?.strikethrough})),
    color:data.color || 'default', icon:data.icon?.emoji || '', url: file?.url || data.url || null, expiresAt:file?.expiry_time || null, caption: plain(data.caption || []), name:data.name || '', cells: data.cells?.map(plain), checked: data.checked, children: [] };
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
async function sections(pattern=wanted) {
  const found = [];
  async function walk(blocks, depth=0) {
    for (const b of blocks) {
      if(pattern!==wanted && found.length)return;
      const text = plain(b[b.type]?.rich_text || []);
      if(pattern===wanted && /役割分担/.test(text))continue;
      if (b.type === 'toggle' && pattern.test(text)) found.push(...await tree([b]));
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
export const server = http.createServer(async(req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const url = new URL(req.url,'http://localhost');
  const pagesOrigin='https://furuta-ideas.github.io';
  const pagesRequest=req.headers.origin===pagesOrigin;
  if(pagesRequest && url.pathname.startsWith('/api/')){res.setHeader('Access-Control-Allow-Origin',pagesOrigin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');}
  if(req.method==='OPTIONS' && url.pathname.startsWith('/api/')){res.writeHead(pagesRequest?204:403);return res.end();}
  try {
    secret ||= env.SESSION_SECRET || randomBytes(32).toString('hex');
    if(url.pathname==='/health') return json(res,200,{ok:true});
    if(req.headers.origin && !pagesRequest && url.pathname.startsWith('/api/'))return json(res,403,{error:'アクセス元を確認できません。'});
    if(url.pathname==='/api/login')return json(res,410,{error:'パスワードによるログインは終了しました。'});
    if(url.pathname.startsWith('/api/')) {
      if(!authenticated(req)) return json(res,401,{error:'本人確認が必要です。'});
      if(req.method!=='GET') return json(res,405,{error:'この操作は使用できません。'});
      if(url.pathname==='/api/roles') return json(res,200,{sections:await sections(/役割分担.*事前準備/)});
      if(url.pathname==='/api/playbook'){
        const patterns={content:/コンテンツ/,ids:/IDとパスワード/,trouble:/トラブル/,contacts:/緊急連絡先/,faq:/ＦＡＱアプリ|FAQアプリ/};
        const key=url.searchParams.get('section');
        if(key && !patterns[key])return json(res,400,{error:'指定した項目を確認してください。'});
        if(env.CLOUDFLARE_WORKER==='1' && !key)return json(res,400,{error:'取得する項目を指定してください。'});
        const nodes=await sections(key?patterns[key]:wanted);registerMaterials(nodes);return json(res,200,{sections:nodes});
      }
      const materialId=url.pathname.match(/^\/api\/material\/([0-9a-f-]{32,36})$/i)?.[1];
      if(materialId)return await downloadMaterial(materialId,res,url.searchParams.get('metadata')==='1');
      if(url.pathname==='/api/tours') return json(res,200,{tours:await tours()});
      if(url.pathname==='/api/faq') {
        if(!faqDataPath)return json(res,503,{error:'FAQデータベースが設定されていません。'});
        const {readFile}=await import('node:fs/promises');
        const data=JSON.parse(await readFile(faqDataPath,'utf8'));
        if(!Array.isArray(data.records))throw new Error('FAQデータベースの形式が不正です。');
        return json(res,200,{rows:data.records,meta:{version:data.version,updatedAt:data.updatedAt,count:data.records.length}});
      }
      const id=url.pathname.match(/^\/api\/tour\/([0-9a-f-]{32,36})$/i)?.[1];
      if(id) {
        const p=await notion('pages/'+id);
        if(p.parent?.data_source_id!==sourceId && p.parent?.database_id!=='284cbc412aed8076a429fe54198f6444')return json(res,403,{error:'ツアー一覧の案件を選択してください。'});
        const version=p.last_edited_time+'-privacy-v2';
        if(version && url.searchParams.get('version')===version)return json(res,200,{notModified:true,version});
        const root=await children(id);const selected=overviewBlocks(root.map(compact));
        let overview;
        if(selected.length){const ids=new Set(selected.map(n=>n.id));overview=await tree(root.filter(n=>ids.has(n.id)));}
        else overview=overviewBlocks(await tree(root));
        return json(res,200,{tour:tour(p),overview:redactOverview(overview),version});
      }
      return json(res,404,{error:'ページが見つかりません。'});
    }
    return json(res,404,{error:'Not found'});
  } catch(error) { if(res.headersSent){res.destroy(error);return;}json(res,502,{error:error.name==='TimeoutError'?'接続がタイムアウトしました。アプリを開き直してください。':error.message}); }
});
if(process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\','/').split('/').pop())) server.listen(Number(env.PORT)||3000,'0.0.0.0',()=>console.log(`Tour PlayBook API listening on ${Number(env.PORT)||3000}`));
