import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFAQ } from '../lib.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'..');
const source=resolve(process.argv[2] || resolve(root,'..','index.html'));
const output=resolve(root,'private-data','faq-db.json');
const raw=await readFile(source,'utf8');
let records;
if(source.toLowerCase().endsWith('.json')){
  const parsed=JSON.parse(raw);records=Array.isArray(parsed)?parsed:parsed.records;
}else records=parseFAQ(raw);
if(!Array.isArray(records) || !records.length)throw new Error('FAQデータが空です。');
const ids=new Set();
for(const [index,row] of records.entries()){
  if(typeof row.question!=='string' || !row.question.trim())throw new Error(`FAQ ${index+1}: 質問がありません。`);
  if(!Array.isArray(row.answers) || !row.answers.length)throw new Error(`FAQ ${index+1}: 回答がありません。`);
  const id=String(row.id ?? '');if(!id || ids.has(id))throw new Error(`FAQ ${index+1}: IDが空または重複しています。`);ids.add(id);
  if(row.tags!==undefined && !Array.isArray(row.tags))throw new Error(`FAQ ${id}: カテゴリー形式が不正です。`);
}
const now=new Date();
const version=process.argv[3] || now.toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
const payload={schemaVersion:1,version,updatedAt:now.toISOString(),records};
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(payload),{encoding:'utf8',mode:0o600});
console.log(`FAQ DB ${version}: ${records.length}件 -> ${output}`);
