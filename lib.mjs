export const plain = (items = []) => items.map(x => x.plain_text ?? x.text?.content ?? '').join('');
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
export const visibleTour = t => (t.properties?.Status ?? t.properties?.['ステータス'] ?? '').normalize('NFKC').trim() !== 'キャンセル';
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
export function faqCategories(rows) {
  const seen=new Set();return rows.flatMap(r=>{const name=r.tags?.[0]?.trim();if(!name || seen.has(name))return [];seen.add(name);return [{name,en:r.tags_en?.[0] || name}];});
}
export function filterFAQCategory(rows,name){return rows.filter(r=>(r.tags || []).some(t=>normalize(t)===normalize(name))).sort((a,b)=>(a.id || 0)-(b.id || 0));}

export function orderedProperties(properties){const first=['Select','Status','会場','時間枠','人数','主担当','副担当'];return [...first,...Object.keys(properties).filter(k=>!first.includes(k))].filter(k=>!['案件','調整進捗'].includes(k) && properties[k]).map(k=>[k,properties[k]]);}
export class RecentCache {
 constructor(limit=10,entries=[]){this.limit=limit;this.entries=new Map(entries.slice(-limit));}
 get(key){const value=this.entries.get(key);if(value!==undefined){this.entries.delete(key);this.entries.set(key,value);}return value;}
 set(key,value){this.entries.delete(key);this.entries.set(key,value);while(this.entries.size>this.limit)this.entries.delete(this.entries.keys().next().value);return value;}
 serialize(){return [...this.entries];}
}
