import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { orderTours, initialTour, visibleTour, tour, parseFAQ, searchFAQ, overviewBlocks, redactOverview, faqCategories, filterFAQCategory, orderedProperties, RecentCache, contentMaterials, materialRows, troubleSections } from '../lib.mjs';
import { server } from '../server.mjs';

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
test('コンテンツファイルは認証後にのみ取得し、添付ファイルとしてストリーム配信',async()=>{
 const originalFetch=globalThis.fetch,oldToken=process.env.NOTION_TOKEN;process.env.NOTION_TOKEN='test-only';
 const id='11111111-1111-1111-1111-111111111111',toggleId='22222222-2222-2222-2222-222222222222';
 const file={id,type:'file',file:{name:'script.xlsx',file:{url:'https://prod-files-secure.s3.us-west-2.amazonaws.com/test.xlsx'}}};
 globalThis.fetch=async(url,options)=>{const value=String(url);if(value.startsWith('https://api.notion.com/')){if(value.includes('/blocks/'+id))return Response.json(file);return Response.json({results:value.includes(toggleId)?[file]:[{id:toggleId,type:'toggle',has_children:true,toggle:{rich_text:[{plain_text:'コンテンツ'}]}}],has_more:false});}if(value.startsWith('https://prod-files-secure.s3.us-west-2.amazonaws.com/'))return new Response('file-bytes',{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});return originalFetch(url,options);};
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;const origin='https://furuta-ideas.github.io';
 try{assert.equal((await fetch(url+'/api/material/'+id)).status,401);const login=await fetch(url+'/api/login',{method:'POST',headers:{Origin:origin},body:JSON.stringify({password:'2026'})});const {token}=await login.json();const r=await fetch(url+'/api/material/'+id,{headers:{Origin:origin,Authorization:'Bearer '+token}});assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/attachment.*script.xlsx/);assert.equal(await r.text(),'file-bytes');const form={method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token})};const download=await fetch(url+'/api/material/'+id,form);assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/octet-stream');assert.match(download.headers.get('content-disposition'),/attachment; filename="download.xlsx"/);assert.equal(await download.text(),'file-bytes');assert.equal((await fetch(url+'/api/material/'+id,{...form,body:'token=invalid'})).status,401);assert.equal((await fetch(url+'/api/material/'+id,{...form,headers:{}})).status,403);file.type='video';file.video={...file.file,name:'clip.mp4'};delete file.file;const video=await fetch(url+'/api/material/'+id,form);assert.equal(video.status,200);assert.equal(video.headers.get('content-type'),'application/octet-stream');assert.match(video.headers.get('content-disposition'),/filename="download.mp4"/);assert.equal(await video.text(),'file-bytes');}
 finally{await new Promise(r=>server.close(r));globalThis.fetch=originalFetch;if(oldToken===undefined)delete process.env.NOTION_TOKEN;else process.env.NOTION_TOKEN=oldToken;}
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
test('RenderはAPI専用：画面非公開、Pages限定ログイン、Bearer認証必須',async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;const origin='https://furuta-ideas.github.io';
 try{
  for(const path of ['/','/index.html','/app.js','/style.css','/opening.png','/icon.png','/lib.mjs','/.env'])for(const method of ['GET','HEAD'])assert.equal((await fetch(url+path,{method})).status,404);
  assert.equal((await fetch(url+'/health')).status,200);
  assert.equal((await fetch(url+'/api/tours')).status,401);
  for(const badOrigin of [undefined,'https://untrusted.example',url]){const r=await fetch(url+'/api/login',{method:'POST',headers:badOrigin?{Origin:badOrigin}:{},body:JSON.stringify({password:'2026'})});assert.equal(r.status,403);}
  const wrong=await fetch(url+'/api/login',{method:'POST',headers:{Origin:origin},body:JSON.stringify({password:'wrong'})});assert.equal(wrong.status,401);
  const preflight=await fetch(url+'/api/tours',{method:'OPTIONS',headers:{Origin:origin}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
  assert.equal((await fetch(url+'/api/tours',{method:'OPTIONS',headers:{Origin:'https://untrusted.example'}})).status,403);
  const login=await fetch(url+'/api/login',{method:'POST',headers:{Origin:origin},body:JSON.stringify({password:'2026'})});assert.equal(login.status,200);assert.equal(login.headers.get('set-cookie'),null);const {token}=await login.json();assert.ok(token);
  const response=await fetch(url+'/api/playbook',{headers:{Origin:origin,Authorization:'Bearer '+token}});assert.equal(response.status,502);assert.match((await response.json()).error,/NOTION_TOKEN/);
  assert.equal((await fetch(url+'/api/tours',{headers:{Origin:origin,Authorization:'Bearer '+token+'x'}})).status,401);
  assert.equal((await fetch(url+'/api/tours',{headers:{Cookie:'tour_session='+token}})).status,401);
  assert.equal((await fetch(url+'/api/tours',{headers:{Origin:'https://untrusted.example',Authorization:'Bearer '+token}})).status,403);
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

test('プロパティの指定順と調整進捗の非表示',()=>{assert.deepEqual(orderedProperties({副担当:'副',調整進捗:'内部',人数:'15',Status:'準備',Select:'公式',主担当:'主',時間枠:'10:00',会場:'KOIL',お出迎え:'入口'}).map(([k])=>k),['Select','Status','会場','時間枠','人数','主担当','副担当','お出迎え']);});
test('直近10案件のキャッシュは再表示で優先度を上げ、11件目で最も古い案件を削除',()=>{const c=new RecentCache(10);for(let i=0;i<10;i++)c.set(String(i),{overview:[i],tour:{id:String(i)}});c.get('0');c.set('10',{overview:[10]});assert.equal(c.entries.size,10);assert.equal(c.get('1'),undefined);assert.deepEqual(c.get('0').overview,[0]);const restored=new RecentCache(10,c.serialize());assert.equal(restored.entries.size,10);assert.deepEqual(restored.get('10').overview,[10]);});
