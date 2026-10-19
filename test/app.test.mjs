import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { orderTours, initialTour, visibleTour, tour, parseFAQ, searchFAQ, overviewBlocks, redactOverview, faqCategories, filterFAQCategory, orderedProperties, RecentCache, contentMaterials, materialRows, troubleSections, receiveDownload } from '../lib.mjs';
import { server } from '../server.mjs';
import { internalProof } from '../auth-router.mjs';
import { runInNewContext } from 'node:vm';
import { fetchJSON, displayedMaterialRows } from '../lib.mjs';
import { speakingHighlights } from '../lib.mjs';
import { faqCategoryColor } from '../lib.mjs';
import { answerLinks } from '../lib.mjs';
import { participantTotal } from '../lib.mjs';

test('表示対象の人数を合計し、空欄・未定・範囲は推測して加算しない',()=>{
 const values=['15','２０人','1,000名','0','','未定','10～20','-2'];
 assert.deepEqual(participantTotal(values.map(value=>({properties:{人数:value}}))),{total:1035,unknown:4});
 assert.deepEqual(participantTotal([]),{total:0,unknown:0});
});

test('回答のURLをリンク化し、周囲の句読点と本文を保持する',()=>{
 for(const text of ['資料（https://example.com/a/）です。','See https://example.com/info.html).','https://example.com/page_(test).']){
  const parts=answerLinks(text);assert.equal(parts.map(p=>p.text).join(''),text);assert.equal(parts.filter(p=>p.href).length,1);assert.ok(!parts.find(p=>p.href).href.endsWith('.'));
 }
 assert.deepEqual(answerLinks('javascript:alert(1)'),[{text:'javascript:alert(1)'}]);
 assert.equal(answerLinks('See https://example.com/a).')[1].href,'https://example.com/a');
});

test('カテゴリーの正式名称を指定の6色に分類',()=>{
 const groups={gold:['柏の葉スマートシティ概要','歴史','街の運営','街のデータ','これからの街づくり','経営数字'],green:['住民の声','UDCK'],blue:['KOIL','健康長寿・あ・し・た','環境共生','エネルギー・AEMS','モビリティ','都市OS','防災・レジリエンス','かけだし横丁'],silver:['ポートランド','他のスマートシティとの比較'],brown:['ツアー運営'],orange:['1st Stage','2nd Stage']};
 for(const [color,names]of Object.entries(groups))for(const name of names)assert.equal(faqCategoryColor(name),color,name);
});

test('話す際のキーワードと数字を強調し、本文と数字の単位を保持',()=>{
 const text='現在の就業人口は約14,000人。AEMSで20％削減。AI is useful, unlike train.';
 const parts=speakingHighlights(text,['現在','人口','就業人口','AEMS','AI']);
 assert.equal(parts.map(p=>p.text).join(''),text);
 assert.deepEqual(parts.filter(p=>p.highlight).map(p=>p.text),['就業人口','14,000人','AEMS','20％','AI']);
 const unsafe='<script>alert(1)</script>';assert.equal(speakingHighlights(unsafe).map(p=>p.text).join(''),unsafe);
 assert.equal(speakingHighlights('面積２７３ha。',['C++']).filter(p=>p.highlight)[0].text,'２７３ha');
});

test('Rev24の英語Pack・distributableと日本語配布版を正しく分類',()=>{
 const names=['20261022_kashiwanoha_Tours_Pack_E_Rev24.pptx','20261022_kashiwanoha_Tours_Pack_E（distributable）_Rev24.pdf','20261022_柏の葉スマートシティツアー（配布版）_Rev24.pdf'];
 const result=contentMaterials(names.map(name=>({type:'file',name,url:'https://files.example/'+encodeURIComponent(name)})));
 assert.deepEqual(result.full.en.map(x=>x.name),[names[0]]);assert.deepEqual(result.handout.en.map(x=>x.name),[names[1]]);assert.deepEqual(result.handout.ja.map(x=>x.name),[names[2]]);
 assert.equal(result.full.ja.length,0);
});

test('古いセッションの遅延401で再ログイン後の画面を戻さない',async()=>{
 const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');const code=source.slice(source.indexOf('async function api('),source.indexOf('function today()'));
 let resolve;const nodes={app:{hidden:false},login:{hidden:true},password:{focus(){}},'login-error':{}};
 const ctx={apiBase:'https://test.invalid',pending:new Map(),controllers:new Set(),AbortController,accessToken:'old-session',$:id=>nodes[id],fetchJSON:()=>new Promise(r=>resolve=r),endSession(){ctx.accessToken='';nodes.app.hidden=true;nodes.login.hidden=false;}};
 runInNewContext(code+';this.call=api;',ctx);const old=ctx.call('/api/tours').catch(()=>{});ctx.accessToken='new-session';resolve({response:{ok:false,status:401},data:{error:'expired'}});await old;assert.equal(nodes.app.hidden,false);assert.equal(nodes.login.hidden,true);
 const current=ctx.call('/api/tours').catch(()=>{});resolve({response:{ok:false,status:401},data:{error:'expired'}});await current;assert.equal(nodes.login.hidden,false);assert.equal(ctx.accessToken,'');
});
test('起動中503は自動再接続し、無応答はタイムアウト後に再試行できる',async()=>{
 const original=globalThis.fetch;let calls=0,retries=0;
 try{globalThis.fetch=async()=>++calls===1?new Response('<html>Starting</html>',{status:503}):Response.json({token:'ok'});const result=await fetchJSON('https://test.invalid',{}, {retries:1,onRetry(){retries++;}});assert.equal(result.data.token,'ok');assert.equal(retries,1);
 calls=0;globalThis.fetch=(_,options)=>{calls++;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));};await assert.rejects(fetchJSON('https://test.invalid',{}, {timeoutMs:10,retries:1}),/再度ログイン/);assert.equal(calls,2);
 }finally{globalThis.fetch=original;}
});
test('表示行を削減し、トラブル表・緊急連絡先・案内図の順で配置',async()=>{
 assert.deepEqual(displayedMaterialRows.map(([id])=>id),['full','handout','menti','script','faq']);const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 assert.ok(html.indexOf('id="troubles"')<html.indexOf('id="contacts"'));assert.ok(html.indexOf('id="contacts"')<html.indexOf('id="trouble-guides"'));assert.equal(html.includes('id="menti-launch"'),false);assert.match(html,/class="opening-title">柏の葉スマートシティツアー　PlayBook<\/p>/);
});

test('ダウンロード進捗は実受信量を示し、途中終了は完了扱いにしない',async()=>{
 const bytes=new TextEncoder();const updates=[];
 const stream=new ReadableStream({start(c){c.enqueue(bytes.encode('abc'));c.enqueue(bytes.encode('def'));c.close();}});
 const result=await receiveDownload(new Response(stream,{headers:{'Content-Length':'6'}}),(received,total)=>updates.push([received,total]));
 assert.equal(await result.text(),'abcdef');assert.deepEqual(updates,[[0,6],[3,6],[6,6]]);
 await assert.rejects(receiveDownload(new Response('short',{headers:{'Content-Length':'10'}}),()=>{}),/途中/);
 const unknown=[];await receiveDownload(new Response('abc'),(received,total)=>unknown.push([received,total]));assert.deepEqual(unknown.at(-1),[3,0]);
});

test('コンテンツを指定順の日本語・英語表へ分類し、英語スクリプト等は空欄',()=>{
 const file=name=>({type:'file',name,url:'https://files.example/'+encodeURIComponent(name)});
 const rows=contentMaterials([{type:'callout',text:'日本語ツアー',children:[file('座学_日本語版.pptx'),file('街歩き_日本語版.pptx'),file('フルパッケージ_日本語版.pptx'),file('スクリプト_日本語版.xlsx'),file('ＦＡＱ_日本語版.xlsx'),{type:'video',url:'https://files.example/concept.mp4'},{type:'toggle',text:'参考動画',children:[{type:'video',url:'https://files.example/reference.mp4'}]}]},{type:'callout',text:'英語ツアー',children:[file('座学_英語版.pptx'),file('紹介_英語版.mp4'),{type:'paragraph',text:'英語版のスクリプト・FAQのEXCELはありません。'}]}]);
 assert.deepEqual(materialRows.map(x=>x[0]),['lecture','walk','full','handout','menti','video','script','faq']);
 assert.equal(rows.lecture.ja.length,1);assert.equal(rows.lecture.en.length,1);
 assert.equal(rows.video.ja.length,2);assert.equal(rows.video.ja[1].reference,true);assert.equal(rows.video.en.length,1);
 assert.equal(rows.script.en.length,0);assert.equal(rows.faq.en.length,0);assert.equal(rows.handout.ja.length,0);assert.equal(rows.faq.ja.length,1);
});
test('ネストした区切り線で集合場所とバス停車位置を別カードにする',()=>{
 const image=id=>({type:'image',id});const table={type:'table',children:[]};
 const result=troubleSections([table,{type:'paragraph',text:'（集合場所　案内図）',children:[image('meeting'),{type:'divider'},{type:'paragraph',text:'（運転手向け　バス停車位置）'},image('bus')]}]);
 assert.deepEqual(result.main,[table]);assert.equal(result.guides.length,2);
 assert.equal(result.guides[0][0].text,'（集合場所　案内図）');assert.equal(result.guides[0][1].id,'meeting');
 assert.equal(result.guides[1][0].text,'（運転手向け　バス停車位置）');assert.equal(result.guides[1][1].id,'bus');
});
test('ファイル本体は中継せず、本人確認後に配布元URLだけを返す',async()=>{
 const originalFetch=globalThis.fetch,oldToken=process.env.NOTION_TOKEN;process.env.NOTION_TOKEN='test-only';process.env.SESSION_SECRET='test-internal-proof-only';process.env.DIRECT_DOWNLOADS='1';
 const id='11111111-1111-1111-1111-111111111111',toggleId='22222222-2222-2222-2222-222222222222';
 const file={id,type:'file',file:{name:'script.xlsx',file:{url:'https://prod-files-secure.s3.us-west-2.amazonaws.com/test.xlsx'}}};
 globalThis.fetch=async(url,options)=>{const value=String(url);if(value.startsWith('https://api.notion.com/')){if(value.includes('/blocks/'+id))return Response.json(file);return Response.json({results:value.includes(toggleId)?[file]:[{id:toggleId,type:'toggle',has_children:true,toggle:{rich_text:[{plain_text:'コンテンツ'}]}}],has_more:false});}return originalFetch(url,options);};
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;const origin='https://furuta-ideas.github.io';
 const request=path=>{const req=new Request(url+path);return fetch(req,{headers:{Origin:origin,'X-Playbook-Internal-Proof':internalProof(req,process.env.SESSION_SECRET)}});};
 try{
  assert.equal((await fetch(url+'/api/material/'+id)).status,401);
  const r=await request('/api/material/'+id+'?metadata=1');assert.equal(r.status,200);const details=await r.json();assert.equal(details.direct,true);assert.equal(details.name,'script.xlsx');assert.match(details.url,/amazonaws/);
  assert.equal((await request('/api/material/'+id)).status,400);
  assert.equal((await fetch(url+'/api/material/'+id,{method:'POST',headers:{Origin:origin},body:'token=legacy'})).status,401);
 }finally{await new Promise(r=>server.close(r));globalThis.fetch=originalFetch;if(oldToken===undefined)delete process.env.NOTION_TOKEN;else process.env.NOTION_TOKEN=oldToken;delete process.env.DIRECT_DOWNLOADS;}
});

test('実施概要の個人情報は本文・リンク・子要素から除去し、他の色文字を保持',()=>{
 const normal={type:'bulleted_list_item',text:'所要時間：120分',rich:[{text:'120分',color:'pink',bold:true}]};
 const nodes=[{type:'callout',children:['申し込み担当者名：テスト太郎','緊急連絡先：09012345678','連絡先Eメール：private@example.com'].map(text=>({type:'bulleted_list_item',text,rich:[{text,href:'mailto:private@example.com'}],children:[{type:'paragraph',text:'secret-child'}]})).concat(normal)}];
 const result=redactOverview(nodes);const json=JSON.stringify(result);
 for(const secret of ['テスト太郎','09012345678','private@example.com','secret-child'])assert.equal(json.includes(secret),false);
 assert.equal(result[0].children.filter(n=>n.text.endsWith('：（非表示）')).length,3);
 assert.deepEqual(result[0].children[3].rich,normal.rich);
 assert.equal(nodes[0].children[0].text,'申し込み担当者名：テスト太郎');
 assert.deepEqual(redactOverview(result),result);
});

test('キャンセル案件をAPI一覧とキャッシュ表示・中央選択から除外',()=>{
  const make=(id,date,status,category='公式ツアー')=>({id,date,minute:600,title:id,properties:{Status:status,Select:category}});
  const rows=[make('cancelled','2026-10-09','X.キャンセル'),make('active','2026-10-10','A.実施準備中'),make('past','2026-10-08','Z.終了','＋Onツアー'),make('knowledge','2026-10-09','Z.終了','ナレッジ'),make('planning','2026-10-09','Z.終了','企画'),make('pr','2026-10-09','Z.終了','ＰＲ'),make('empty','2026-10-09','Z.終了',''),make('cancelled-on','2026-10-09','X.キャンセル','＋Onツアー')];
  assert.deepEqual(rows.filter(visibleTour).map(t=>t.id),['active','past']);
  const ordered=orderTours(rows);
  assert.equal(ordered[initialTour(ordered,'2026-10-09')].id,'active');
  assert.deepEqual(orderTours([rows[0]]),[]);
  assert.equal(visibleTour(make('spaced','2026-10-09',' キャンセル　')),false);
  assert.equal(visibleTour(make('plain','2026-10-09','キャンセル')),false);
  assert.equal(visibleTour(make('wide','2026-10-09',' Ｘ．キャンセル　')),false);
  assert.equal(visibleTour({properties:{Select:'公式ツアー',ステータス:'X.キャンセル'}}),false);
  assert.equal(visibleTour({properties:{}}),false);
});

test('本日の最も早い時間枠、最も近い未来、未来がない場合',()=>{
  const make=(title,time)=>tour({id:title,url:'https://www.notion.so/test',properties:{Select:{type:'select',select:{name:'公式ツアー'}},案件:{type:'title',title:[{plain_text:title}]},時間枠:{type:'rich_text',rich_text:[{plain_text:time}]}}});
  const rows=orderTours([make('20261008 午後','１４：００～１６：００'),make('20261009 翌日','9:00'),make('20261007 過去','10:00'),make('20261008 朝','９：３０〜１１：３０')]);
  assert.equal(rows[initialTour(rows,'2026-10-08')].title,'20261008 朝');
  assert.equal(rows[initialTour(rows,'2026-10-09')].title,'20261009 翌日');
  assert.equal(rows[initialTour(rows,'2026-10-10')].title,'20261009 翌日');
  assert.equal(initialTour([],'2026-10-08'),0);
});
test('現在のFAQマスター形式からJSONのみ抽出し日英検索',async()=>{
  const html=await readFile(new URL('../../index.html',import.meta.url),'utf8').catch(()=> 'const FAQ_DB = [{"id":1,"question":"街の人口","answers":["人口は約14000人"],"question_en":"City population","answers_en":["14000 residents"]}];');
  const rows=parseFAQ(html);assert.ok(rows.length>0);assert.ok(searchFAQ(rows,'人口').length);assert.ok(searchFAQ(rows,'population').length);assert.equal(searchFAQ(rows,'ZZZZQX987654').length,0);assert.throws(()=>parseFAQ('const FAQ_DB = doSomething();'));
});
test('旧パスワード、旧Bearer、偽の内部認証を受け付けない',async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;const origin='https://furuta-ideas.github.io';
 try{
  for(const path of ['/','/index.html','/app.js','/style.css','/opening.png','/icon.png','/lib.mjs','/.env'])for(const method of ['GET','HEAD'])assert.equal((await fetch(url+path,{method})).status,404);
  assert.equal((await fetch(url+'/health')).status,200);
  assert.equal((await fetch(url+'/api/tours')).status,401);
  for(const password of ['2026','wrong'])assert.equal((await fetch(url+'/api/login',{method:'POST',headers:{Origin:origin},body:JSON.stringify({password})})).status,410);
  const preflight=await fetch(url+'/api/tours',{method:'OPTIONS',headers:{Origin:origin}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
  assert.equal((await fetch(url+'/api/tours',{method:'OPTIONS',headers:{Origin:'https://untrusted.example'}})).status,403);
  for(const headers of [{Authorization:'Bearer old.signature.token'},{Cookie:'tour_session=old'},{'X-Playbook-Internal-Proof':'9999999999999.fake.fake'},{'Cf-Access-Authenticated-User-Email':'admin@example.com'}])assert.equal((await fetch(url+'/api/tours',{headers:{Origin:origin,...headers}})).status,401);
  assert.equal((await fetch(url+'/api/tours',{headers:{Origin:'https://untrusted.example'}})).status,403);
 }finally{await new Promise(r=>server.close(r));}
});

test('実施概要はプロンプト内の言及を除外し、正式見出しの2つのコールアウトだけを取得',()=>{
 const prompt={type:'toggle',text:'プロンプト',children:[{type:'paragraph',text:'実施までのログを読み込んで、実施概要を埋めて',children:[]},{type:'paragraph',text:'＃2',children:[]}]};
 const overview={type:'callout',children:[{type:'bulleted_list_item',text:'所要時間：120分',rich:[{text:'120分',color:'pink',bold:true}]}]};
 const customer={type:'callout',children:[{type:'bulleted_list_item',text:'団体名：学校'}]};
 assert.deepEqual(overviewBlocks([prompt,{type:'heading_2',text:'🧾 実施概要'},overview,customer,{type:'divider'},{type:'heading_2',text:'コンテンツ'},prompt]),[overview,customer]);
 assert.deepEqual(overviewBlocks([prompt]),[]);
 assert.deepEqual(overviewBlocks([{type:'column',children:[{type:'toggle',text:'実施概要',children:[overview]}]}]),[overview]);
});
test('FAQカテゴリーはマスター順で重複除外し、キーワードではなくタグ完全一致で抽出',()=>{
 const rows=[{id:2,tags:['歴史'],tags_en:['History'],question:'街の歴史'},{id:1,tags:['柏の葉スマートシティ概要'],question:'歴史も説明'},{id:3,tags:['歴史'],tags_en:['History']}];
 assert.deepEqual(faqCategories(rows),[{name:'歴史',en:'History'},{name:'柏の葉スマートシティ概要',en:'柏の葉スマートシティ概要'}]);
 assert.deepEqual(filterFAQCategory(rows,'歴史').map(r=>r.id),[2,3]);
});

test('複数カテゴリーは主分類の後に追加し、英訳と副分類の検索も対応',()=>{
 const rows=[{id:1,tags:['概要','1st Stage','経営数字'],tags_en:['Overview','Stage One','Business figures']},{id:2,tags:['歴史','2nd Stage','かけだし横丁'],tags_en:['History','Stage Two','Kakedashi Yokocho']},{id:3,tags:['概要','1st Stage']}];
 assert.deepEqual(faqCategories(rows),[{name:'概要',en:'Overview'},{name:'歴史',en:'History'},{name:'1st Stage',en:'Stage One'},{name:'経営数字',en:'Business figures'},{name:'2nd Stage',en:'Stage Two'},{name:'かけだし横丁',en:'Kakedashi Yokocho'}]);
 assert.deepEqual(filterFAQCategory(rows,'1st Stage').map(r=>r.id),[1,3]);
 assert.deepEqual(filterFAQCategory(rows,'かけだし横丁').map(r=>r.id),[2]);
});

test('プロパティの指定順と調整進捗の非表示',()=>{assert.deepEqual(orderedProperties({副担当:'副',調整進捗:'内部',人数:'15',Status:'準備',Select:'公式',主担当:'主',時間枠:'10:00',会場:'KOIL',お出迎え:'入口'}).map(([k])=>k),['Select','Status','会場','時間枠','人数','主担当','副担当','お出迎え']);});
test('直近10案件のキャッシュは再表示で優先度を上げ、11件目で最も古い案件を削除',()=>{const c=new RecentCache(10);for(let i=0;i<10;i++)c.set(String(i),{overview:[i],tour:{id:String(i)}});c.get('0');c.set('10',{overview:[10]});assert.equal(c.entries.size,10);assert.equal(c.get('1'),undefined);assert.deepEqual(c.get('0').overview,[0]);const restored=new RecentCache(10,c.serialize());assert.equal(restored.entries.size,10);assert.deepEqual(restored.get('10').overview,[10]);});
