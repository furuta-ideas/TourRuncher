import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { orderTours, initialTour, tour, parseFAQ, searchFAQ, overviewBlocks, faqCategories, filterFAQCategory } from '../lib.mjs';
import { server } from '../server.mjs';

test('本日の最も早い時間枠、最も近い未来、未来がない場合',()=>{
  const make=(title,time)=>tour({id:title,url:'https://www.notion.so/test',properties:{案件:{type:'title',title:[{plain_text:title}]},時間枠:{type:'rich_text',rich_text:[{plain_text:time}]}}});
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
test('ログイン前の保護、誤入力、ログイン後のアクセス、秘密ファイル非公開',async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
  try{
    assert.equal((await fetch(`${url}/api/tours`)).status,401);
    assert.equal((await fetch(`${url}/.env`)).status,404);
    const wrong=await fetch(`${url}/api/login`,{method:'POST',body:JSON.stringify({password:'wrong'})});assert.equal(wrong.status,401);
    const login=await fetch(`${url}/api/login`,{method:'POST',body:JSON.stringify({password:'2026'})});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
    const playbook=await fetch(`${url}/api/playbook`,{headers:{Cookie:cookie.split(';')[0]}});assert.equal(playbook.status,502);assert.match((await playbook.json()).error,/NOTION_TOKEN/);
    const altered=await fetch(`${url}/api/tours`,{headers:{Cookie:cookie.split(';')[0]+'x'}});assert.equal(altered.status,401);
    const home=await fetch(url);assert.equal(home.status,200);assert.match(await home.text(),/TourRuncher/);
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
