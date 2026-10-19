export const plain = (items = []) => items.map(x => x.plain_text ?? x.text?.content ?? '').join('');
export async function fetchJSON(url,options={},settings={}) {
 const {timeoutMs=120000,retries=0,onRetry=()=>{}}=settings;
 for(let attempt=0;;attempt++){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetch(url,{...options,signal:options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal});
   const data=await response.json().catch(()=>null);
   if([502,503,504].includes(response.status) && attempt<retries){onRetry();continue;}
   if(!data)throw new Error('サーバーに接続できません。少し待って再度お試しください。');
   return {response,data};
  }catch(error){
   if(options.signal?.aborted)throw new Error('ログイン状態が変更されました。');
   if((controller.signal.aborted || error instanceof TypeError) && attempt<retries){onRetry();continue;}
   if(controller.signal.aborted)throw new Error('接続に時間がかかっています。再度ログインしてください。');
   if(error instanceof TypeError)throw new Error('通信できません。ネットワーク接続を確認して再度お試しください。');
   throw error;
  }finally{clearTimeout(timer);}
 }
}
export function property(p) {
  const v = p[p.type];
  if (['title', 'rich_text'].includes(p.type)) return plain(v);
  if (Array.isArray(v)) return v.map(x => x.name ?? x.id ?? '').join('、');
  if (p.type === 'date') return v ? [v.start, v.end].filter(Boolean).join(' ～ ') : '';
  if (p.type === 'formula') return v ? property(v) : '';
  if (p.type === 'relation') return v.map(x => x.id).join('、');
  if (typeof v === 'object') return v?.name ?? '';
  return v == null ? '' : String(v);
}
export function tour(page) {
  const properties = Object.fromEntries(Object.entries(page.properties).map(([k,v]) => [k, property(v)]));
  const title = properties['案件'] || Object.values(page.properties).filter(p => p.type === 'title').map(property).join('');
  const match = title.normalize('NFKC').match(/(20\d{2})[\/\-.年]?(\d{2})[\/\-.月]?(\d{2})/);
  const date = match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  const time = (properties['時間枠'] || '').normalize('NFKC').match(/(\d{1,2})[:時](\d{2})?/);
  return { id: page.id, url: page.url, title, date, minute: time ? +time[1] * 60 + +(time[2] || 0) : 1440, properties };
}
export function visibleTour(t) {
  const category=(t.properties?.Select ?? '').normalize('NFKC').trim();
  const status=(t.properties?.Status ?? t.properties?.['ステータス'] ?? '').normalize('NFKC').trim();
  return ['公式ツアー','+Onツアー'].includes(category) && !/^(?:X\s*[.．]\s*)?キャンセル$/i.test(status);
}
export const orderTours = tours => tours.filter(t => t.date && visibleTour(t)).sort((a,b) => a.date.localeCompare(b.date) || a.minute - b.minute || a.title.localeCompare(b.title));
export function initialTour(tours, today) {
  const index = tours.findIndex(t => t.date >= today);
  return index < 0 ? Math.max(0, tours.length - 1) : index;
}
export function parseFAQ(html) {
  const match = html.match(/(?:const|let|var)\s+FAQ_DB\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error('FAQマスターのデータ形式が変わっています。管理者に連絡してください。');
  const result = JSON.parse(match[1]);
  if (!Array.isArray(result) || !result.every(x => typeof x.question === 'string' && Array.isArray(x.answers))) throw new Error('FAQデータを確認できません。');
  return result;
}
export const normalize = s => s.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0)-96));
export function searchFAQ(rows, query) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return rows.map(rec => {
    const fields = [rec.question, rec.question_en, ...(rec.keywords || []), ...(rec.tags || []), ...(rec.tags_en || []), ...rec.answers, ...(rec.answers_en || [])].filter(Boolean).map(normalize);
    const score = terms.every(t => fields.some(f => f.includes(t))) ? terms.reduce((s,t) => s + fields.reduce((v,f,i) => v + (f.includes(t) ? i < 2 ? 6 : 1 : 0), 0),0) : 0;
    return { rec, score };
  }).filter(x => x.score).sort((a,b) => b.score-a.score).map(x => x.rec);
}

// Match section titles, never incidental mentions inside instructions or logs.
export function overviewBlocks(nodes) {
  for(let i=0;i<nodes.length;i++) {
    const n=nodes[i];
    if((n.type.startsWith('heading_') || n.type==='toggle') && /^[^\p{L}\p{N}]*実施概要\s*$/u.test(n.text || '')) {
      if(n.children?.length)return n.children;
      const out=[];const level=Number(n.type.split('_')[1]) || 3;
      for(let j=i+1;j<nodes.length;j++) {
        const next=nodes[j];
        if(next.type.startsWith('heading_') && Number(next.type.split('_')[1])<=level)break;
        if(next.type==='divider')break;
        out.push(next);
      }
      return out;
    }
  }
  for(const n of nodes){const nested=overviewBlocks(n.children || []);if(nested.length)return nested;}
  return [];
}
export function redactOverview(nodes=[]) {
  const label=/^\s*(?:[•・*-]\s*)?(申し込み担当者名|申込担当者名|申込み担当者名|緊急連絡先|連絡先Eメール|連絡先Ｅメール)\s*[:：]/u;
  return nodes.map(node=>{
    const source=node.text || (node.rich || []).map(r=>r.text).join('');
    let hidden=false;
    const text=source.split('\n').map(line=>{const match=line.match(label);if(!match)return line;hidden=true;return `${match[1]}：（非表示）`;}).join('\n');
    if(hidden)return {id:node.id,type:node.type,text,rich:[],children:[]};
    return {...node,children:redactOverview(node.children || [])};
  });
}
export function faqCategories(rows) {
  const names=new Set(),translations=new Map();
  const add=tag=>{const name=tag?.trim();if(name)names.add(name);};
  for(const r of rows)add(r.tags?.[0]);
  for(const r of rows)(r.tags || []).forEach((tag,i)=>{add(tag);const name=tag?.trim(),en=r.tags_en?.[i]?.trim();if(name && en && !translations.has(name))translations.set(name,en);});
  return [...names].map(name=>({name,en:translations.get(name) || name}));
}
export function filterFAQCategory(rows,name){return rows.filter(r=>(r.tags || []).some(t=>normalize(t)===normalize(name))).sort((a,b)=>(a.id || 0)-(b.id || 0));}
export function faqCategoryColor(name='') {
 const value=name.normalize('NFKC').trim();
 if(/^(住民の声|UDCK)$/.test(value))return 'green';
 if(/^(KOIL|健康長寿|環境共生|エネルギー|モビリティ|都市OS|防災|かけだし横丁)/.test(value))return 'blue';
 if(/^(ポートランド|他のスマートシティ)/.test(value))return 'silver';
 if(value==='ツアー運営')return 'brown';
 if(/^(1st Stage|2nd Stage)$/.test(value))return 'orange';
 return 'gold';
}
export function speakingHighlights(text,terms=[]) {
 const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const generic=new Set(['現在','概要','理由','背景','目的','特徴','内容','その他','紹介','説明']);
 const words=[...new Set(terms.map(t=>String(t).trim()).filter(t=>t.length>1 && !generic.has(t)))].sort((a,b)=>b.length-a.length).map(t=>/^[\x20-\x7e]+$/.test(t)?`(?<![A-Za-z])${escape(t)}(?![A-Za-z])`:escape(t));
 const number='[0-9０-９]+(?:[,，.．][0-9０-９]+)*(?:(?:〜|～|–|－|-)[0-9０-９]+(?:[,，.．][0-9０-９]+)*)?(?:兆|億|万)?(?:％|%|人|名|世帯|年|月|日|歳|分|秒|時間|件|社|駅|棟|階|円|倍|ヘクタール|平方メートル|km²|m²|km|cm|ha|㎡|㎢|m)?';
 const pattern=new RegExp([...words,number].join('|'),'giu');const result=[];let offset=0;
 for(const match of text.matchAll(pattern)){if(match.index>offset)result.push({text:text.slice(offset,match.index),highlight:false});result.push({text:match[0],highlight:true});offset=match.index+match[0].length;}
 if(offset<text.length)result.push({text:text.slice(offset),highlight:false});return result;
}
export function answerLinks(text){
 const parts=[];let offset=0;
 for(const match of text.matchAll(/https?:\/\/[^\s<>"'「」『』（）【】、。]+/giu)){
  let url=match[0].replace(/[.,;!?]+$/,'');
  while(url.endsWith(')') && (url.match(/\)/g)||[]).length>(url.match(/\(/g)||[]).length)url=url.slice(0,-1);
  if(match.index>offset)parts.push({text:text.slice(offset,match.index)});
  parts.push({text:url,href:url});offset=match.index+url.length;
 }
 if(offset<text.length)parts.push({text:text.slice(offset)});return parts;
}

export function orderedProperties(properties){const first=['Select','Status','会場','時間枠','人数','主担当','副担当'];return [...first,...Object.keys(properties).filter(k=>!first.includes(k))].filter(k=>!['案件','調整進捗'].includes(k) && properties[k]).map(k=>[k,properties[k]]);}
export function participantTotal(tours){
 let total=0,unknown=0;
 for(const tour of tours){const text=String(tour.properties?.['人数'] ?? '').normalize('NFKC').trim().replaceAll(',','');const match=text.match(/^(\d+(?:\.0+)?)\s*(?:人|名)?$/);const value=match?Number(match[1]):NaN;if(Number.isSafeInteger(value))total+=value;else unknown++;}
 return {total,unknown};
}
export const materialRows=[['lecture','座学','Presentation'],['walk','街歩き','Walking tour'],['full','フルパッケージ','Full package'],['handout','配布用','Handouts'],['menti','Mentimeter','Mentimeter'],['video','動画','Videos'],['script','スクリプト','Script'],['faq','FAQ','FAQ']];
export const displayedMaterialRows=materialRows.filter(([id])=>!['lecture','walk','video'].includes(id));
export async function receiveDownload(response,onProgress){
 if(!response.body)throw new Error('ファイルを受信できません。');
 const total=Number(response.headers.get('content-length')) || 0;
 const reader=response.body.getReader(),chunks=[];let received=0;onProgress(0,total);
 try{while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.byteLength;onProgress(received,total);}}
 finally{reader.releaseLock();}
 if(total && received!==total)throw new Error('ファイルの受信が途中で終了しました。再度お試しください。');
 return new Blob(chunks,{type:response.headers.get('content-type') || 'application/octet-stream'});
}
export function contentMaterials(nodes=[]) {
 const result=Object.fromEntries(materialRows.map(([id])=>[id,{ja:[],en:[]}]));
 function walk(items,language='ja',context='') {
  for(const n of items){
   const lang=/英語|English/i.test(n.text || '')?'en':/日本語|Japanese/i.test(n.text || '')?'ja':language;
   let filename=n.name || n.caption || '';try{filename ||= decodeURIComponent(new URL(n.url).pathname.split('/').pop());}catch{}
   const name=(filename || n.text || '').normalize('NFKC');
   if(n.url && ['file','video','audio','pdf','bookmark','embed','link_preview'].includes(n.type)) {
    const row=/配布|handout|distributable/i.test(name)?'handout':/スクリプト|script/i.test(name)?'script':/FAQ/i.test(name)?'faq':/座学|lecture|presentation/i.test(name)?'lecture':/街歩き|walking/i.test(name)?'walk':/フルパッケージ|full.package|Tours_Pack_[EJ](?:_|[（(])/i.test(name)?'full':n.type==='video' || /\.(mp4|mov|webm)$/i.test(name) || /youtu(?:\.be|be\.com)/i.test(n.url)?'video':null;
    const actual=/英語|English|Tours_Pack_E(?:_|[（(])/i.test(name)?'en':/日本語|Japanese|柏の葉スマートシティツアー|Tours_Pack_J(?:_|[（(])/i.test(name)?'ja':lang;
    if(row)result[row][actual].push({...n,name:filename || n.text || row,reference:/参考/.test(context)});
   }
   walk(n.children || [],lang,context+' '+(n.text || ''));
  }
 }
 walk(nodes);return result;
}
export function troubleSections(nodes=[]) {
 const main=[],guides=[];let card=null,afterDivider=false;
 const split=()=>{card=null;afterDivider=guides.length>0;};
 function visit(n){
  if(['synced_block','column_list','column'].includes(n.type)){for(const c of n.children || [])visit(c);return;}
  if(n.type==='divider'){split();return;}
  const descendants=n.children || [];
  const containsImage=x=>x.type==='image' || (x.children || []).some(containsImage);
  if(n.type==='table' && !card){main.push(n);return;}
  if(containsImage(n) || card || afterDivider){
   if(!card){card=[];guides.push(card);afterDivider=false;}
   if(descendants.some(x=>x.type==='divider')){card.push({...n,children:[]});for(const c of descendants)visit(c);}
   else card.push(n);
  }else main.push(n);
 }
 nodes.forEach(visit);return {main,guides};
}
export class RecentCache {
 constructor(limit=10,entries=[]){this.limit=limit;this.entries=new Map(entries.slice(-limit));}
 get(key){const value=this.entries.get(key);if(value!==undefined){this.entries.delete(key);this.entries.set(key,value);}return value;}
 set(key,value){this.entries.delete(key);this.entries.set(key,value);while(this.entries.size>this.limit)this.entries.delete(this.entries.keys().next().value);return value;}
 serialize(){return [...this.entries];}
}
