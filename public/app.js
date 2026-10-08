import { initialTour, searchFAQ, overviewBlocks, faqCategories, filterFAQCategory } from '/lib.mjs';
const $ = id => document.getElementById(id);
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
  const r=await fetch(path,{cache:'no-store',...options}); const data=await r.json();
  if(!r.ok) { if(r.status===401 && path!='/api/login'){ $('app').hidden=true;$('login').hidden=false;$('password').focus(); } throw new Error(data.error || '情報を取得できませんでした。'); }
  return data;
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
  await new Promise(r=>setTimeout(r,800));$('opening').hidden=true;$('login').hidden=false;$('password').focus();
}
opening();
$('login-form').addEventListener('submit',async e=>{
  e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;$('login-error').textContent='';
  try{await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('password').value})});$('password').value='';$('login').hidden=true;$('app').hidden=false;tab('prep');load();}catch(error){$('login-error').textContent=error.message;}finally{b.disabled=false;}
});
function positionTour(index) {
  const item=$('tour-list').children[index];if(item)$('tour-list').scrollTop=item.offsetTop-($('tour-list').clientHeight-item.offsetHeight)/2;
}
async function selectTour(index) {
  const t=state.tours[index];if(!t || state.selected===index)return;
  state.selected=index;const seq=++state.detailSequence;
  Array.from($('tour-list').children).forEach((b,i)=>b.setAttribute('aria-current',String(i===index)));
  $('tour-title').textContent=t.title;$('tour-badge').hidden=false;$('tour-badge').textContent=t.date===today()?'本日のツアー':t.date>today()?'今後のツアー':'過去のツアー';
  $('tour-link').href=t.url;$('tour-link').hidden=false;
  const dl=el('dl',null,'properties');
  for(const [k,v] of Object.entries(t.properties)){if(k==='案件' || !v)continue;const cell=el('div',null,'property');cell.append(el('dt',k),el('dd',v));dl.append(cell);}
  const overview=el('div',null,'notion-content');overview.append(el('p','実施概要を取得しています…','loading'));
  $('tour-detail').replaceChildren(dl,el('h3','実施概要'),overview);
  try{const blocks=(await api(`/api/tour/${t.id}`)).blocks;if(seq!==state.detailSequence)return;
    overview.replaceChildren();const selected=overviewBlocks(blocks);if(selected.length)renderBlocks(selected,overview);else overview.append(el('p','実施概要の記載はありません。詳細はNotionで確認してください。','hint'));
  }catch(error){if(seq===state.detailSequence)errorAt(overview,error);}
}
let scrollTimer;
$('tour-list').addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{const list=$('tour-list');const center=list.scrollTop+list.clientHeight/2;let best=0;let dist=Infinity;Array.from(list.children).forEach((n,i)=>{const d=Math.abs(n.offsetTop+n.offsetHeight/2-center);if(d<dist){best=i;dist=d;}});selectTour(best);},130);});
async function loadTours() {
  try{state.tours=(await api('/api/tours')).tours;state.selected=-1;state.detailCache.clear();$('tour-count').textContent=`${state.tours.length}件`;$('tour-list').replaceChildren();
    if(!state.tours.length){$('tour-list').append(el('p','日付付きのツアー案件はありません。','hint'));$('tour-detail').replaceChildren(el('p','ツアー一覧に案件を追加すると表示されます。','hint'));return;}
    state.tours.reverse();
    state.tours.forEach((t,i)=>{const b=el('button',null,'tour-item');b.type='button';b.append(el('time',`${t.date.replaceAll('-','')}  ${t.properties['時間枠'] || ''}`),el('strong',t.title.replace(/^\s*\d{8}[\s_　-]*/,'')));b.addEventListener('click',()=>{positionTour(i);selectTour(i);});$('tour-list').append(b);});
    const ascending=[...state.tours].reverse();const index=state.tours.length-1-initialTour(ascending,today());requestAnimationFrame(()=>{positionTour(index);selectTour(index);});
  }catch(error){$('tour-count').textContent='取得できません';errorAt($('tour-list'),error);}
}
function flatten(nodes){return (nodes || []).flatMap(n=>[n,...flatten(n.children)]);}
function section(nodes,pattern){return flatten(nodes).find(n=>n.type==='toggle' && pattern.test(n.text));}
function copyRow(text,value=text) {
  const row=el('div',null,'copy-row');const button=el('button','コピー');button.type='button';
  button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(value);button.textContent='コピー済み';setTimeout(()=>button.textContent='コピー',1800);}catch{const selection=window.getSelection();const range=document.createRange();range.selectNodeContents(row.querySelector('p'));selection.removeAllRanges();selection.addRange(range);button.textContent='選択しました';}});
  row.append(el('p',text),button);return row;
}
function displaySection(target,node) {target.replaceChildren();if(node)renderBlocks(node.children,target);else target.append(el('p','Playbookに該当する情報が見つかりません。','hint'));}
async function loadPlaybook(){
  try{
    const nodes=(await api('/api/playbook')).sections;
    displaySection($('roles'),section(nodes,/役割分担/));displaySection($('materials'),section(nodes,/コンテンツ/));displaySection($('troubles'),section(nodes,/トラブル/));displaySection($('contacts'),section(nodes,/緊急連絡先/));
    const menti=section(nodes,/Mentimeter/i);$('menti-info').replaceChildren();
    if(menti){const texts=flatten(menti.children).map(n=>n.text).filter(Boolean);const all=texts.join('\n');const mail=all.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];const pwd=all.match(/(?:Pwd|Password|パスワード|PWD)\s*[：:]\s*([^\s]+)/i)?.[1];if(mail)$('menti-info').append(copyRow(`ID：${mail}`,mail));if(pwd)$('menti-info').append(copyRow(`パスワード：${pwd}`,pwd));
      if(!mail || !pwd)$('menti-info').append(el('p','ログイン情報を確認してください。','hint'));const d=el('details');d.append(el('summary','使い方'));renderBlocks(menti.children,d);$('menti-info').append(d);
      const u=flatten(menti.children).flatMap(n=>n.rich || []).find(r=>r.href?.startsWith('https://www.mentimeter.com'));if(u)$('menti-launch').href=u.href;
    }else $('menti-info').append(el('p','PlaybookにMentimeterの情報が見つかりません。','hint'));
    const faq=section(nodes,/ＦＡＱアプリ|FAQアプリ/);$('faq-credentials').replaceChildren();
    if(faq){const text=flatten(faq.children).map(n=>n.text).join('\n');const pwd=text.match(/パスワード\s*[：:]\s*(\S+)/)?.[1];if(pwd)$('faq-credentials').append(copyRow(`FAQパスワード：${pwd}`,pwd));const url=flatten(faq.children).flatMap(n=>n.rich || []).find(r=>r.href?.startsWith('https://'));if(url)$('faq-master').href=url.href;}
    $('faq-master').href||= 'https://furuta-ideas.github.io/kashiwanoha-tour-guide-faq/';
  }catch(error){for(const id of ['roles','materials','troubles','contacts','menti-info','faq-credentials'])errorAt($(id),error);}
}
function load(){ $('today').textContent=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date());loadTours();loadPlaybook();loadCategories(); }
$('roles-button').addEventListener('click',async()=>{const target=$('roles');target.replaceChildren(el('p','最新の役割分担と事前準備をNotionから取得しています…','loading'));$('roles-dialog').showModal();try{const data=await api('/api/roles');displaySection(target,section(data.sections,/役割分担/));}catch(error){errorAt(target,error);}});$('roles-close').addEventListener('click',()=>$('roles-dialog').close());
let faqTimer;
async function faqSearch() {
  const query=$('faq-query').value.trim();const category=state.category;const seq=++state.faqSequence;state.limit=4;
  if(!query && !category){state.matches=[];drawFAQ();$('faq-status').textContent='FAQマスターの最新データから検索します。';return;}
  $('faq-status').textContent='最新のFAQから検索しています…';
  try{const data=await api('/api/faq');if(seq!==state.faqSequence)return;state.faq=data.rows;state.matches=category?filterFAQCategory(state.faq,category):searchFAQ(state.faq,query);renderCategories();$('faq-master').href=data.source;drawFAQ();}catch(error){if(seq===state.faqSequence){$('faq-status').textContent=error.message;$('faq-results').replaceChildren();$('faq-more').hidden=true;}}
}
$('faq-form').addEventListener('submit',e=>{e.preventDefault();clearTimeout(faqTimer);state.category=null;renderCategories();faqSearch();});
$('faq-query').addEventListener('input',()=>{clearTimeout(faqTimer);state.category=null;renderCategories();++state.faqSequence;faqTimer=setTimeout(faqSearch,450);});
function drawFAQ(){ $('faq-results').replaceChildren();for(const r of state.matches.slice(0,state.limit)){
  const en=state.lang==='en';const card=el('article',null,'faq-card');card.append(el('p',(en?r.tags_en:r.tags)?.join(' / ') || '', 'tag'),el('h3',en?r.question_en || r.question:r.question));for(const answer of (en?r.answers_en || r.answers:r.answers))card.append(el('p',answer));$('faq-results').append(card);
  }$('faq-more').hidden=state.matches.length<=state.limit;$('faq-status').textContent=state.matches.length?`${state.category?'カテゴリー：'+state.category+'　':''}${state.matches.length}件中 ${Math.min(state.limit,state.matches.length)}件を表示`:$('faq-query').value.trim()?'一致するFAQがありません。別のキーワードで検索してください。':'FAQマスターの最新データから検索します。';
}
for(const lang of ['ja','en'])$(`lang-${lang}`).addEventListener('click',()=>{state.lang=lang;$('lang-ja').setAttribute('aria-pressed',String(lang==='ja'));$('lang-en').setAttribute('aria-pressed',String(lang==='en'));renderCategories();drawFAQ();});
$('faq-more').addEventListener('click',()=>{state.limit+=4;drawFAQ();});

function renderCategories(){const target=$('faq-categories');target.replaceChildren();for(const c of faqCategories(state.faq)){const b=el('button',state.lang==='en'?c.en:c.name,'category-chip');b.type='button';b.setAttribute('aria-pressed',String(state.category===c.name));b.addEventListener('click',()=>{clearTimeout(faqTimer);state.category=c.name;$('faq-query').value='';renderCategories();faqSearch();});target.append(b);}}
async function loadCategories(){try{const data=await api('/api/faq');state.faq=data.rows;renderCategories();}catch(error){errorAt($('faq-categories'),error);}}
