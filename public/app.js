import { initialTour, visibleTour, participantTotal, searchFAQ, overviewBlocks, redactOverview, faqCategories, faqCategoryColor, filterFAQCategory, orderedProperties, RecentCache, displayedMaterialRows, fetchJSON, contentMaterials, troubleSections, receiveDownload, speakingHighlights, answerLinks } from './lib.mjs';
const $ = id => document.getElementById(id);
const apiBase='https://tour-playbook-api.furuta-ideas.workers.dev';
let accessToken='';
// Private content is cached only in this authenticated page's memory.
try{for(const key of ['tour-recent-v1','tour-recent-v2','tour-roles-v1'])localStorage.removeItem(key);}catch{}
const recent=new RecentCache(10);
let rolesCache=null,authExpires=0,sessionExpires=0,sessionBusy=false,authBusy=false;
const controllers=new Set();
const pending=new Map();
const state = { tours:[], selected:-1, detailCache:new Map(), lang:'ja', faq:[], matches:[], limit:4, faqSequence:0, detailSequence:0, category:null };
function el(tag, text, className) { const n=document.createElement(tag); if(text!=null)n.textContent=text; if(className)n.className=className; return n; }
function safeLink(url) { try { const u=new URL(url); return ['https:','http:','mailto:','tel:'].includes(u.protocol) ? u.href : null; } catch { return null; } }
function link(url,text,className) { const a=el('a',text,className); const safe=safeLink(url); if(safe){a.href=safe;a.target='_blank';a.rel='noopener noreferrer';} return a; }
function rich(target,node) {
  if(!node.rich?.length) {target.textContent=node.text || '';return;}
  for(const r of node.rich){const item=r.href?link(r.href,r.text):el(r.bold?'strong':'span',r.text);if(r.bold)item.classList.add('notion-bold');if(r.italic)item.classList.add('notion-italic');if(r.underline)item.classList.add('notion-underline');if(r.strike)item.classList.add('notion-strike');if(/^(gray|brown|orange|yellow|green|blue|purple|pink|red)(_background)?$/.test(r.color))item.classList.add('notion-'+r.color);target.append(item);}
}
function renderBlocks(nodes,target) {
  for(const n of nodes || []) {
    let block;
    switch(n.type) {
      case 'toggle': block=el('details'); const summary=el('summary');rich(summary,n);block.append(summary);break;
      case 'table': block=el('div',null,'table-wrap'); const table=el('table');renderBlocks(n.children,table);block.append(table);target.append(block);continue;
      case 'table_row':block=el('tr');for(const cell of n.cells || [])block.append(el('td',cell));break;
      case 'image':block=el('figure');if(safeLink(n.url)){const img=el('img');img.src=n.url;img.alt=n.caption || 'Playbookの案内画像';img.loading='lazy';block.append(img);}if(n.caption)block.append(el('figcaption',n.caption));break;
      case 'file':case 'video':case 'audio':case 'pdf':block=link(n.url,n.name || n.caption || decodeURIComponent((n.url || '').split('/').pop()?.split('?')[0] || '') || 'ファイルを開く','file');break;
      case 'bookmark':case 'link_preview':case 'embed':block=link(n.url,n.text || n.url || 'リンクを開く','file');break;
      case 'heading_1':case 'heading_2':case 'heading_3':block=el('h3');rich(block,n);break;
      case 'bulleted_list_item':case 'numbered_list_item':block=el(n.type==='bulleted_list_item'?'ul':'ol');const li=el('li');rich(li,n);renderBlocks(n.children,li);block.append(li);target.append(block);continue;
      case 'to_do':block=el('p');block.append(el('span',n.checked?'☑ ':'☐ '));const text=el('span');rich(text,n);block.append(text);break;
      case 'divider':block=el('hr');break;
      case 'callout':block=el('div',null,'callout');if(n.text){const p=el('p');rich(p,n);block.append(p);}break;
      case 'synced_block':case 'column_list':case 'column':block=el('div');break;
      case 'child_page':block=link(`https://www.notion.so/${n.id.replaceAll('-','')}`,n.name || n.text || 'Notionで開く','file');break;
      default:block=el('p');rich(block,n);
    }
    if(/^(gray|brown|orange|yellow|green|blue|purple|pink|red)(_background)?$/.test(n.color))block.classList.add('notion-'+n.color);if(n.type==='callout' && n.icon)block.prepend(el('span',n.icon,'callout-icon'));renderBlocks(n.children,block);target.append(block);
  }
}
function errorAt(target,error) { target.replaceChildren(el('p',error.message || String(error),'error')); }
async function api(path,options) {
 const requestToken=accessToken;const key=(!options || !options.method || options.method==='GET')?requestToken+':'+path:null;
 if(key && pending.has(key))return pending.get(key);
 const job=(async()=>{const headers={...options?.headers,...(requestToken?{Authorization:'Bearer '+requestToken}:{})};
 const controller=new AbortController();controllers.add(controller);
 let result;try{result=await fetchJSON(apiBase+path,{cache:'no-store',...options,headers,signal:controller.signal});}finally{controllers.delete(controller);}
 const {response:r,data}=result;
 if(requestToken!==accessToken)throw new Error('ログイン状態が変更されました。');
 if(!r.ok){if([401,403,503].includes(r.status) && requestToken)endSession(data.error || '再度ログインしてください。');throw new Error(data.error || '情報を取得できませんでした。');}return data;})();
 if(key)pending.set(key,job);try{return await job;}finally{if(key)pending.delete(key);}
}
function today() {return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function tab(name) {
  $('app').dataset.tab=name;
  document.querySelectorAll('[role=tab]').forEach(b=>{const active=b.dataset.tab===name;b.setAttribute('aria-selected',active);b.tabIndex=active?0:-1;});
  document.querySelectorAll('[role=tabpanel]').forEach(p=>p.hidden=p.id!==`panel-${name}`);
  if(name==='prep' && state.selected>=0)requestAnimationFrame(()=>positionTour(state.selected));
}
document.querySelectorAll('[role=tab]').forEach((b,index,buttons)=>{
  b.addEventListener('click',()=>tab(b.dataset.tab));
  b.addEventListener('keydown',e=>{let i;if(e.key==='ArrowRight')i=(index+1)%buttons.length;if(e.key==='ArrowLeft')i=(index+buttons.length-1)%buttons.length;if(e.key==='Home')i=0;if(e.key==='End')i=buttons.length-1;if(i!=null){e.preventDefault();buttons[i].focus();tab(buttons[i].dataset.tab);}});
});
const image=$('opening').querySelector('img');
async function opening() {
  await Promise.race([image.decode().catch(()=>{}),new Promise(r=>setTimeout(r,3000))]);
  await new Promise(r=>setTimeout(r,3000));$('opening').classList.add('fade');
  await new Promise(r=>setTimeout(r,800));$('opening').hidden=true;
}
function clearPrivateData(){
 for(const c of controllers)c.abort();controllers.clear();pending.clear();
 recent.entries.clear();rolesCache=null;materialNode=null;state.detailCache.clear();state.tours=[];state.faq=[];state.matches=[];state.selected=-1;state.detailSequence++;state.faqSequence++;
 activeDownload?.abort();releaseDownload();
 for(const id of ['tour-list','tour-properties','tour-detail','materials','roles','faq-results','faq-categories','troubles','contacts','trouble-guides'])$(id).replaceChildren();
 $('tour-title').textContent='案件を選択';$('tour-count').textContent='';$('tour-link').removeAttribute('href');$('tour-link').hidden=true;
 $('faq-query').value='';$('download-filename').textContent='';
 $('signed-in-email').textContent='';$('tour-badge').textContent='';$('tour-badge').hidden=true;
 document.querySelectorAll('dialog[open]').forEach(d=>d.close());
}
function endSession(message){accessToken='';authExpires=0;sessionExpires=0;clearPrivateData();$('app').hidden=true;$('login').hidden=false;$('login-error').textContent=message;$('login-button').disabled=false;}
function randomAuth(){const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
async function startLogin(){
 if(authBusy)return;authBusy=true;$('login-button').disabled=true;$('login-error').textContent='';$('login-status').textContent='本人確認画面を開きます…';
 try{
  const verifier=randomAuth(),state=randomAuth();
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
  const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  sessionStorage.setItem('playbook-auth-flow',JSON.stringify({verifier,state,created:Date.now()}));
  const url=new URL(apiBase+'/auth/start');url.search=new URLSearchParams({challenge,state});location.assign(url.href);
 }catch{authBusy=false;$('login-button').disabled=false;$('login-error').textContent='本人確認を開始できません。ブラウザの保存設定を確認して再度お試しください。';}
}
async function resumeLogin(){
 const params=new URLSearchParams(location.hash.slice(1));
 if(!params.has('auth_code'))return false;
 history.replaceState(null,'',location.pathname+location.search);
 try{
  const flow=JSON.parse(sessionStorage.getItem('playbook-auth-flow') || 'null');sessionStorage.removeItem('playbook-auth-flow');
  if(!flow || flow.state!==params.get('state') || Date.now()-flow.created>600000)throw new Error('ログイン操作の有効期限が切れました。再度ログインしてください。');
  const {response,data}=await fetchJSON(apiBase+'/auth/exchange',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:params.get('auth_code'),verifier:flow.verifier})});
  if(!response.ok)throw new Error(data.error || '本人確認を完了できません。');
  if(!data.token || data.expires<=Date.now())throw new Error('本人確認を完了できません。');
  accessToken=data.token;authExpires=data.expires;sessionExpires=data.sessionExpires;
  try{localStorage.setItem('playbook-personal','1');}catch{}
  $('signed-in-email').textContent=data.email;$('login').hidden=true;$('app').hidden=false;tab('prep');load();return true;
 }catch(e){endSession(e.message);return true;}
}
$('login-form').addEventListener('submit',e=>{e.preventDefault();startLogin();});
async function logout(all=false){
 const token=accessToken;endSession('ログアウトしました。');try{localStorage.removeItem('playbook-personal');}catch{}
 try{const r=await fetch(apiBase+'/auth/logout',{method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({all})});if(!r.ok)throw new Error();location.assign(apiBase+'/auth/clear');}
 catch{$('login-error').textContent='端末の表示データは削除しましたが、サーバーのログアウトを確認できません。再接続後に再度お試しください。';}
}
$('logout-button').addEventListener('click',()=>logout());$('logout-all').addEventListener('click',()=>logout(true));
async function sessionCheck(){
 if(!accessToken || sessionBusy || document.hidden)return;sessionBusy=true;
 try{
  if(sessionExpires<=Date.now())return endSession('ログインの有効期限が切れました。再度ログインしてください。');
  if(authExpires-Date.now()<30000){endSession('ログイン状態を確認しています…');await startLogin();return;}
  await api('/auth/session');
 }catch(e){if(accessToken)endSession(e.message);}
 finally{sessionBusy=false;}
}
setInterval(sessionCheck,30000);document.addEventListener('visibilitychange',sessionCheck);
// Safari may restore the entire page from its back/forward cache. Hide private UI before freezing.
addEventListener('pagehide',()=>{accessToken='';clearPrivateData();$('app').hidden=true;});
addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
(async()=>{
 if(location.hash.includes('auth_code=')){$('opening').hidden=true;await resumeLogin();return;}
 await opening();$('login').hidden=false;
 try{if(localStorage.getItem('playbook-personal')==='1')await startLogin();}catch{}
})();
function positionTour(index) {
  const item=$('tour-list').children[index];if(item)$('tour-list').scrollTop=item.offsetTop-($('tour-list').clientHeight-item.offsetHeight)/2;
}
new ResizeObserver(()=>{const list=$('tour-list');if(list.clientHeight){list.style.setProperty('--row',list.clientHeight/3+'px');if(state.selected>=0)positionTour(state.selected);}}).observe($('tour-list'));
async function selectTour(index) {
  let t=state.tours[index];if(!t || state.selected===index)return;let cached=recent.get(t.id);if(!cached?.overview)cached=null;if(t.cached && cached)t=cached.tour;recent.set(t.id,cached || {tour:t,overview:null});
  state.selected=index;const seq=++state.detailSequence;
  Array.from($('tour-list').children).forEach((b,i)=>b.setAttribute('aria-current',String(i===index)));
  $('tour-title').textContent=t.title;$('tour-badge').hidden=false;$('tour-badge').textContent=t.date===today()?'本日のツアー':t.date>today()?'今後のツアー':'過去のツアー';
  $('tour-link').href=t.url;$('tour-link').hidden=false;
  const dl=el('dl',null,'properties');
  for(const [k,v] of orderedProperties(t.properties)){const cell=el('div',null,'property');cell.title=`${k}：${v}`;cell.append(el('dt',k),el('dd',v));dl.append(cell);}
  const overview=el('div',null,'notion-content');const draw=nodes=>{overview.replaceChildren();if(nodes?.length){const safe=redactOverview(nodes);renderBlocks(safe,overview);if(JSON.stringify(safe).includes("（非表示）"))overview.append(el("p","※非表示情報は「詳細を開く」で確認できます。","hint"));}else overview.append(el('p','実施概要の記載はありません。','hint'));};if(cached)draw(cached.overview);else overview.append(el('p','実施概要を取得しています…','loading'));
  $('tour-properties').replaceChildren(dl);$('tour-detail').replaceChildren(overview);
  try{const data=await api('/api/tour/'+t.id+(cached?.version && Date.now()-(cached.savedAt || 0)<45*60*1000?'?version='+encodeURIComponent(cached.version):''));
    if(data.notModified){if(recent.entries.has(t.id)){recent.entries.set(t.id,cached);}return;}
    const selected=redactOverview(data.overview || overviewBlocks(data.blocks || []));const updated={tour:data.tour || t,overview:selected,version:data.version,savedAt:Date.now()};if(recent.entries.has(t.id)){recent.entries.set(t.id,updated);}
    if(seq!==state.detailSequence)return;
    if(JSON.stringify(cached?.overview)!==JSON.stringify(selected))draw(selected);
    if(data.tour){const dl=el('dl',null,'properties');for(const [k,v] of orderedProperties(data.tour.properties)){const cell=el('div',null,'property');cell.title=k+'：'+v;cell.append(el('dt',k),el('dd',v));dl.append(cell);}$('tour-properties').replaceChildren(dl);}
  }catch(error){if(seq===state.detailSequence){if(cached){overview.append(el('p','最新情報を確認できませんでした。キャッシュを表示中です。','hint'));}else errorAt(overview,error);}}
}
let scrollTimer;
$('tour-list').addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{const list=$('tour-list');const center=list.scrollTop+list.clientHeight/2;let best=0;let dist=Infinity;Array.from(list.children).forEach((n,i)=>{const d=Math.abs(n.offsetTop+n.offsetHeight/2-center);if(d<dist){best=i;dist=d;}});selectTour(best);},130);});
async function loadTours() {
 const previous=recent.serialize().map(([,v])=>({...v.tour,cached:true})).filter(visibleTour);
 if(previous.length){state.tours=previous.sort((a,b)=>a.date.localeCompare(b.date)||a.minute-b.minute);renderTours();}
 try{const data=await api('/api/tours');const selectedId=state.tours[state.selected]?.id;state.tours=data.tours;renderTours(selectedId);
 }catch(error){if(!previous.length){$('tour-count').textContent='取得できません';errorAt($('tour-list'),error);}}
}
function renderTours(selectedId){state.tours=state.tours.filter(visibleTour);state.selected=-1;const people=participantTotal(state.tours);$('tour-count').textContent=`${state.tours.length}件 ／ 合計${people.total.toLocaleString('ja-JP')}人`;$('tour-count').title=people.unknown?`人数が未入力・未確定の${people.unknown}件は人数合計に含みません。`:'表示中のツアーの人数合計';$('tour-list').replaceChildren();
    if(!state.tours.length){$('tour-list').append(el('p','日付付きのツアー案件はありません。','hint'));$('tour-detail').replaceChildren(el('p','ツアー一覧に案件を追加すると表示されます。','hint'));return;}
    state.tours.reverse();
    state.tours.forEach((t,i)=>{const b=el('button',null,'tour-item');b.type='button';b.title=`${t.title} ${t.properties['時間枠'] || ''}`;b.setAttribute('aria-label',b.title);b.append(el('time',t.date.replaceAll('-','')),el('strong',t.title.replace(/^\s*\d{8}[\s_　-]*/,'')));b.addEventListener('click',()=>{positionTour(i);selectTour(i);});$('tour-list').append(b);});
    const ascending=[...state.tours].reverse();const existing=state.tours.findIndex(t=>t.id===selectedId);const index=existing>=0?existing:state.tours.length-1-initialTour(ascending,today());requestAnimationFrame(()=>{positionTour(index);selectTour(index);});

}
function flatten(nodes){return (nodes || []).flatMap(n=>[n,...flatten(n.children)]);}
function section(nodes,pattern){return flatten(nodes).find(n=>n.type==='toggle' && pattern.test(n.text));}
function copyRow(text,value=text) {
  const row=el('div',null,'copy-row');const button=el('button','コピー');button.type='button';
  button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(value);button.textContent='コピー済み';setTimeout(()=>button.textContent='コピー',1800);}catch{const selection=window.getSelection();const range=document.createRange();range.selectNodeContents(row.querySelector('p'));selection.removeAllRanges();selection.addRange(range);button.textContent='選択しました';}});
  row.append(el('p',text),button);return row;
}
function displaySection(target,node) {target.replaceChildren();if(node)renderBlocks(node.children,target);else target.append(el('p','Playbookに該当する情報が見つかりません。','hint'));}
let materialNode=null,contentLanguage='ja',mentimeterUrl='https://www.mentimeter.com/';
function materialIcon(type){
 const icon=el('span',null,'material-icon '+type);icon.setAttribute('aria-hidden','true');
 if(type==='youtube')icon.append(el('span','▶'));
 else if(type==='pdf')icon.append(el('span','PDF'));
 else{const img=el('img');img.src=`./logos/${type}.png`;img.alt='';icon.classList.add('supplied-logo');icon.append(img);}
 return icon;
}
let activeDownload=null,downloadUrl=null;
function releaseDownload(){if(downloadUrl){URL.revokeObjectURL(downloadUrl);downloadUrl=null;}$('download-save').removeAttribute('href');}
$('download-close').addEventListener('click',()=>{$('download-dialog').close();releaseDownload();});
$('download-cancel').addEventListener('click',()=>activeDownload?.abort());
$('download-dialog').addEventListener('cancel',e=>{if(activeDownload){e.preventDefault();activeDownload.abort();}else releaseDownload();});
async function downloadMaterial(item,button){
 const en=contentLanguage==='en',dialog=$('download-dialog'),bar=$('download-progress'),text=$('download-state');
 if(activeDownload){if(!dialog.open)dialog.showModal();return;}
 if(!accessToken){$('material-status').textContent=en?'Please log in again.':'再度ログインしてください。';return;}
 releaseDownload();const controller=new AbortController();activeDownload=controller;button.disabled=true;
 $('download-heading').textContent=en?'Starting download':'ダウンロードを開始します';$('download-filename').textContent=item.name;
 bar.removeAttribute('value');text.textContent=en?'Preparing file…':'ファイルを準備しています…';
 $('download-cancel').hidden=false;$('download-close').hidden=true;$('download-save').hidden=true;
 $('download-cancel').textContent=en?'Cancel':'中止';$('download-close').textContent=en?'Close':'閉じる';$('download-save').textContent=en?'Save file':'保存する';
 if(!dialog.open)dialog.showModal();
 let sourceUrl=null;
 try{
  const metadata=await fetch(apiBase+'/api/material/'+encodeURIComponent(item.id)+'?metadata=1',{headers:{Authorization:'Bearer '+accessToken},cache:'no-store',signal:controller.signal});
  const source=await metadata.json();if(!metadata.ok)throw new Error(source.error || 'File unavailable');
  const parsed=new URL(source.url);if(parsed.protocol!=='https:')throw new Error('Invalid file URL');sourceUrl=parsed.href;
  const response=await fetch(sourceUrl,{cache:'no-store',signal:controller.signal});
  if(!response.ok){const data=await response.json();throw new Error(data.error || 'Download failed');}
  let lastPaint=0;
  const blob=await receiveDownload(response,(received,total)=>{
   const now=performance.now();if(received && received!==total && now-lastPaint<100)return;lastPaint=now;
   const mb=n=>(n/1024/1024).toFixed(1)+' MB';
   if(total){const percent=Math.min(100,received/total*100);bar.value=percent;text.textContent=Math.floor(percent)+'%  ('+mb(received)+' / '+mb(total)+')';}
   else{bar.removeAttribute('value');text.textContent=(en?'Receiving: ':'受信中：')+mb(received);}
  });
  downloadUrl=URL.createObjectURL(blob);const save=$('download-save');save.href=downloadUrl;save.download=item.name || 'download';save.hidden=false;save.click();bar.value=100;
  $('download-heading').textContent=en?'File received':'ファイルを受信しました';text.textContent=en?'Check browser downloads. If saving did not start, choose Save file.':'ブラウザのダウンロード一覧をご確認ください。保存が始まらない場合は「保存する」を押してください。';
  $('material-status').textContent=en?'File received.':'ファイルを受信しました。';
 }catch(error){if(sourceUrl && !controller.signal.aborted && error instanceof TypeError){const save=$('download-save');save.href=sourceUrl;save.target='_blank';save.rel='noopener noreferrer';save.download=item.name || 'download';save.hidden=false;save.textContent=en?'Download from source':'配布元からダウンロード';$('download-heading').textContent=en?'Download from source':'配布元からダウンロード';text.textContent=en?'Use this link to download directly. Progress appears in your browser downloads.':'配布元から直接取得します。下のボタンを押してください。進捗はブラウザのダウンロード一覧で確認できます。';bar.removeAttribute('value');return;}$('download-heading').textContent=controller.signal.aborted?(en?'Download cancelled':'ダウンロードを中止しました'):(en?'Download failed':'ダウンロードできませんでした');text.textContent=controller.signal.aborted?'':error.message;bar.removeAttribute('value');}
 finally{activeDownload=null;button.disabled=false;$('download-cancel').hidden=true;$('download-close').hidden=false;}
}

function drawMaterials(){
 const en=contentLanguage==='en',target=$('materials');target.replaceChildren();
 $('content-heading').textContent=en?'Tour content':'ツアーコンテンツ';
 for(const lang of ['ja','en'])$('content-lang-'+lang).setAttribute('aria-pressed',String(contentLanguage===lang));
 if(!materialNode){target.append(el('p',en?'Loading content…':'コンテンツを取得しています…','loading'));return;}
 const matrix=contentMaterials(materialNode.children),table=el('table',null,'materials-table');table.setAttribute('aria-label',en?'Tour downloads':'ツアーコンテンツ一覧');
 const head=el('thead'),hr=el('tr');for(const title of [en?'Content':'内容',en?'Japanese tour':'日本語ツアー',en?'English tour':'英語ツアー']){const th=el('th',title);th.scope='col';hr.append(th);}head.append(hr);table.append(head);const body=el('tbody');
 for(const [id,ja,english] of displayedMaterialRows){const row=el('tr'),heading=el('th',en?english:ja);heading.scope='row';row.append(heading);
  for(const lang of ['ja','en']){const cell=el('td');
   if(id==='menti' && lang==='ja'){const a=link(mentimeterUrl,en?'Open':'開く','material-control');a.replaceChildren(materialIcon('mentimeter'),el('span',en?'Open':'開く'));a.setAttribute('aria-label',en?'Open Mentimeter':'Mentimeterを開く');cell.append(a);}
   else{const items=matrix[id][lang];if(!items.length)cell.append(el('span','ー','material-empty'));
    for(const item of items){const button=el('button',null,'material-control');button.type='button';button.title=item.name;button.setAttribute('aria-label',`${item.name} ${en?'Download':'ダウンロード'}`);const type=id==='video'?'youtube':/\.pdf$/i.test(item.name)?'pdf':/\.(xlsx?|csv)$/i.test(item.name)?'excel':'ppt';button.append(materialIcon(type),el('span',item.name,'material-filename'));button.addEventListener('click',()=>downloadMaterial(item,button));cell.append(button);}
   }row.append(cell);
  }body.append(row);
 }table.append(body);const wrap=el('div',null,'materials-wrap');wrap.append(table);target.append(wrap);
 const note=el('p',en?'English scripts are in the PowerPoint speaker notes.':'英語版のスクリプトはPPTのメモ欄にあります。','hint');target.append(note);
 const advice=materialNode.text?.split('\n').slice(1).join('\n');if(advice)target.append(el('p',en?'Use the customized files for each tour when provided.':advice,'hint'));
}
for(const lang of ['ja','en'])$('content-lang-'+lang).addEventListener('click',()=>{contentLanguage=lang;$('material-status').textContent='';drawMaterials();});
async function loadPlaybook(){
  try{
    const nodes=[];if(apiBase.includes('.workers.dev')){for(const key of ['content','ids','trouble','contacts','faq'])nodes.push(...(await api('/api/playbook?section='+key)).sections);}else nodes.push(...(await api('/api/playbook')).sections);
    materialNode=section(nodes,/コンテンツ/);renderTroubles(section(nodes,/トラブル/));displaySection($('contacts'),section(nodes,/緊急連絡先/));
    const menti=section(nodes,/Mentimeter/i);const mentiLink=flatten(menti?.children || []).flatMap(n=>n.rich || []).find(r=>r.href?.startsWith('https://www.mentimeter.com'));mentimeterUrl=mentiLink?.href || 'https://www.mentimeter.com/';
    drawMaterials();
  }catch(error){for(const id of ['materials','troubles','contacts','trouble-guides'])errorAt($(id),error);}
}
function load(){ $('today').textContent=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date());loadTours();loadPlaybook();loadCategories(); }
$('roles-button').addEventListener('click',async()=>{const target=$('roles');if(rolesCache)displaySection(target,rolesCache);else target.replaceChildren(el('p','読み込み中…','loading'));$('roles-dialog').showModal();try{const data=await api('/api/roles');const latest=section(data.sections,/役割分担/);if(JSON.stringify(latest)!==JSON.stringify(rolesCache)){rolesCache=latest;displaySection(target,latest);}}catch(error){if(rolesCache)target.append(el('p','最新情報を確認できませんでした。キャッシュを表示中です。','hint'));else errorAt(target,error);}});$('roles-close').addEventListener('click',()=>$('roles-dialog').close());
let faqTimer;
async function faqSearch() {
  const query=$('faq-query').value.trim();const category=state.category;const seq=++state.faqSequence;state.limit=4;
  if(!query && !category){state.matches=[];drawFAQ();$('faq-status').textContent='FAQデータベースの最新データから検索します。';return;}
  $('faq-status').textContent='最新のFAQから検索しています…';
  try{const data=await api('/api/faq');if(seq!==state.faqSequence)return;state.faq=data.rows;state.matches=category?filterFAQCategory(state.faq,category):searchFAQ(state.faq,query);renderCategories();drawFAQ();}catch(error){if(seq===state.faqSequence){$('faq-status').textContent=error.message;$('faq-results').replaceChildren();$('faq-more').hidden=true;}}
}
$('faq-form').addEventListener('submit',e=>{e.preventDefault();clearTimeout(faqTimer);state.category=null;renderCategories();faqSearch();});
$('faq-query').addEventListener('input',()=>{clearTimeout(faqTimer);state.category=null;renderCategories();++state.faqSequence;faqTimer=setTimeout(faqSearch,450);});
function drawFAQ(){ $('faq-results').replaceChildren();for(const r of state.matches.slice(0,state.limit)){
  const en=state.lang==='en';const card=el('article',null,'faq-card');const tags=el('div',null,'faq-tag-list');for(const [i,name] of (r.tags || []).entries()){const chip=el('span',en?r.tags_en?.[i] || name:name,'category-chip faq-tag');chip.dataset.color=faqCategoryColor(name);tags.append(chip);}card.append(tags,el('h3',en?r.question_en || r.question:r.question));for(const answer of (en?r.answers_en || r.answers:r.answers)){const p=el('p');const terms=state.faq.flatMap(rec=>[...(rec.keywords || []),...(rec.tags || []),...(rec.tags_en || [])]);for(const segment of answerLinks(answer)){if(segment.href)p.append(link(segment.href,segment.text,'faq-answer-link'));else for(const part of speakingHighlights(segment.text,terms))p.append(el(part.highlight?'strong':'span',part.text,part.highlight?'speaking-keyword':''));}card.append(p);}$('faq-results').append(card);
  }$('faq-more').hidden=state.matches.length<=state.limit;$('faq-status').textContent=state.matches.length?`${state.category?'カテゴリー：'+state.category+'　':''}${state.matches.length}件中 ${Math.min(state.limit,state.matches.length)}件を表示`:$('faq-query').value.trim()?'一致するFAQがありません。別のキーワードで検索してください。':'FAQマスターの最新データから検索します。';
}
for(const lang of ['ja','en'])$(`lang-${lang}`).addEventListener('click',()=>{state.lang=lang;$('lang-ja').setAttribute('aria-pressed',String(lang==='ja'));$('lang-en').setAttribute('aria-pressed',String(lang==='en'));renderCategories();drawFAQ();});
$('faq-more').addEventListener('click',()=>{state.limit+=4;drawFAQ();});

function renderCategories(){const target=$('faq-categories');target.replaceChildren();for(const c of faqCategories(state.faq)){const b=el('button',state.lang==='en'?c.en:c.name,'category-chip');b.type='button';b.dataset.color=faqCategoryColor(c.name);b.setAttribute('aria-pressed',String(state.category===c.name));b.addEventListener('click',()=>{clearTimeout(faqTimer);state.category=c.name;$('faq-query').value='';renderCategories();faqSearch();});target.append(b);}}
async function loadCategories(){try{const data=await api('/api/faq');state.faq=data.rows;renderCategories();}catch(error){errorAt($('faq-categories'),error);}}

function renderTroubles(node){
 const target=$('troubles');target.replaceChildren();$('trouble-guides').replaceChildren();if(!node){displaySection(target,null);return;}
 const {main,guides}=troubleSections(node.children || []);renderBlocks(main,target);
 if(guides.length){const grid=el('div',null,'trouble-guides');for(const group of guides){const card=el('article',null,'trouble-guide');renderBlocks(group,card);grid.append(card);}const gap=(3-grid.children.length%3)%3;for(let i=0;i<gap;i++){const reserve=el('div',null,'trouble-reserve');reserve.setAttribute('aria-hidden','true');grid.append(reserve);}$('trouble-guides').append(grid);}
}
