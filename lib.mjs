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
export const orderTours = tours => tours.filter(t => t.date).sort((a,b) => a.date.localeCompare(b.date) || a.minute - b.minute || a.title.localeCompare(b.title));
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
