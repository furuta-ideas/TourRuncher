import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { generateKeyPair, SignJWT } from 'jose';
import { AuthRepository, AuthError, PERSONAL_MS, SHARED_MS, API_MS, random, hash, aclEntries, allowedEntry, accessIdentity } from '../auth-core.mjs';
import { authRoute, authorizeAPI } from '../auth-router.mjs';

function fixture(){
 const db=new DatabaseSync(':memory:');
 const sql={exec(query,...values){const s=db.prepare(query);const rows=query.trim().startsWith('SELECT')?s.all(...values):(s.run(...values),[]);return {toArray:()=>rows};}};
 let now=Date.now();const repo=new AuthRepository(sql,()=>now);
 const entries=[{id:'acl1',email:'guide@example.com',enabled:true,expires:null}];
 const identity={key:'https://team.cloudflareaccess.com|user-1',email:'guide@example.com',proofExpires:now+PERSONAL_MS*2};
 function login(personal=true){const verifier=random(),state=random(),flow=repo.start({challenge:hash(verifier),state,personal},'ip');const result=repo.finish(flow,identity,null,entries);const token=repo.exchange(result.code,verifier,entries);return {...result,...token};}
 return {repo,entries,identity,login,db,advance:ms=>now+=ms,now:()=>now};
}
function denied(fn,status){assert.throws(fn,e=>e instanceof AuthError && e.status===status);}

test('個人端末30日は固定期限、APIトークンは12時間以内。延長しない',()=>{
 const f=fixture(),a=f.login();assert.equal(a.sessionExpires,f.now()+PERSONAL_MS);assert.equal(a.expires,f.now()+API_MS);
 f.advance(API_MS+1);denied(()=>f.repo.authorize(a.token,f.entries),401);
 const verifier=random(),state=random(),flow=f.repo.start({challenge:hash(verifier),state,personal:true},'ip');
 const resumed=f.repo.finish(flow,null,a.sessionCookie,f.entries);assert.equal(resumed.expires,a.sessionExpires);
 const renewed=f.repo.exchange(resumed.code,verifier,f.entries);assert.equal(renewed.sessionExpires,a.sessionExpires);
 f.advance(PERSONAL_MS);denied(()=>f.repo.session(a.sessionCookie,f.entries),401);
});
test('共有端末12時間。本人確認の証明期限を超えて保持しない',()=>{
 const f=fixture();assert.equal(f.login(false).sessionExpires,f.now()+SHARED_MS);
 f.identity.proofExpires=f.now()+600000;assert.equal(f.login().sessionExpires,f.identity.proofExpires);
});
test('PKCE不一致、コード再利用、期限切れ、フロー再利用を拒否',()=>{
 const f=fixture(),verifier=random(),flow=f.repo.start({challenge:hash(verifier),state:random(),personal:true},'ip');
 const r=f.repo.finish(flow,f.identity,null,f.entries);
 denied(()=>f.repo.exchange(r.code,random(),f.entries),401);
 f.repo.exchange(r.code,verifier,f.entries);denied(()=>f.repo.exchange(r.code,verifier,f.entries),401);
 denied(()=>f.repo.finish(flow,f.identity,null,f.entries),400);
 const flow2=f.repo.start({challenge:hash(verifier),state:random()},'ip');const expired=f.repo.finish(flow2,f.identity,null,f.entries);
 f.advance(60001);denied(()=>f.repo.exchange(expired.code,verifier,f.entries),401);
 denied(()=>f.repo.start({challenge:'bad',state:random()},'ip'),400);
});
test('ACL無効化・削除で全セッション失効、再許可しても復活しない',()=>{
 const f=fixture(),a=f.login(),b=f.login();
 f.entries[0].enabled=false;f.repo.revokeRemoved(f.entries);
 f.entries[0].enabled=true;
 denied(()=>f.repo.authorize(a.token,f.entries),401);denied(()=>f.repo.session(b.sessionCookie,f.entries),401);
 const c=f.login();f.entries.length=0;denied(()=>f.repo.authorize(c.token,f.entries),403);
});
test('未許可・重複メール・期限切れ・別アカウントの自動紐付けを拒否',()=>{
 const f=fixture();f.login();f.identity.key='another-idp|user-2';denied(()=>f.login(),403);
 f.identity.key='https://team.cloudflareaccess.com|user-1';f.entries.push({...f.entries[0],id:'duplicate'});denied(()=>f.login(),403);
 f.entries.pop();f.entries[0].expires=f.now();denied(()=>f.login(),403);
 f.entries[0].expires=null;f.identity.email='outsider@example.com';denied(()=>f.login(),403);
});
test('単端末と全端末ログアウト、ACLが取得できなくても失効可能',()=>{
 const f=fixture(),a=f.login(),b=f.login();f.repo.logout(a.token,null);
 denied(()=>f.repo.authorize(a.token,f.entries),401);assert.ok(f.repo.authorize(b.token,f.entries));
 const c=f.login();f.repo.logout(b.token,null,true);denied(()=>f.repo.authorize(c.token,f.entries),401);
 const d=f.login();f.repo.revokeCookie(d.sessionCookie);denied(()=>f.repo.authorize(d.token,f.entries),401);
});
test('Notion許可欄欠落は拒否。日付のみの期限は日本時間の当日末',()=>{
 const pages=[{id:'acl',properties:{'メールアドレス':{rich_text:[{plain_text:' Guide@Example.com '}]},'利用許可':{type:'checkbox',checkbox:true},'有効期限':{date:{start:'2026-10-31'}}}}];
 const entries=aclEntries(pages);assert.ok(allowedEntry(entries,'guide@example.com',Date.parse('2026-10-31T12:00:00+09:00')));
 assert.equal(allowedEntry(entries,'guide@example.com',Date.parse('2026-11-01T00:00:00+09:00')),null);
 delete pages[0].properties['利用許可'];assert.equal(aclEntries(pages)[0].enabled,false);
});
test('Cookieとコードの平文を保存せず、旧形式トークンを拒否',()=>{
 const f=fixture(),a=f.login();const values=f.db.prepare('SELECT * FROM sessions').all();assert.ok(!JSON.stringify(values).includes(a.sessionCookie));
 denied(()=>f.repo.authorize('999999999.signature.nonce',f.entries),401);
});
test('Cloudflare署名・issuer・audience・有効期限を検証。メールヘッダーだけでは認証不可',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('RS256');
 const env={CF_ACCESS_ISSUER:'https://team.cloudflareaccess.com',CF_ACCESS_AUD:'app-audience',CF_ACCESS_MFA_CONFIRMED:'1'};
 const token=await new SignJWT({email:'guide@example.com',type:'app'}).setProtectedHeader({alg:'RS256'}).setSubject('user-1').setIssuedAt().setIssuer(env.CF_ACCESS_ISSUER).setAudience(env.CF_ACCESS_AUD).setExpirationTime('5m').sign(privateKey);
 assert.equal((await accessIdentity(token,env,publicKey)).email,'guide@example.com');
 await assert.rejects(accessIdentity(token,{...env,CF_ACCESS_AUD:'other'},publicKey),e=>e.status===401);
 await assert.rejects(accessIdentity(token.slice(0,-6)+'abcdef',env,publicKey),e=>e.status===401);
 await assert.rejects(accessIdentity('',env,publicKey),e=>e.status===401);
 await assert.rejects(accessIdentity(token,{...env,CF_ACCESS_MFA_CONFIRMED:'0'},publicKey),e=>e.status===503);
});
test('認証ルーターは別Originの交換、旧パスワード、不完全な設定を拒否',async()=>{
 const env={CF_ACCESS_ISSUER:'https://team.cloudflareaccess.com',CF_ACCESS_AUD:'app',CF_ACCESS_MFA_CONFIRMED:'1',AUTH_STORE:{}};
 assert.equal((await authRoute(new Request('https://api.example/api/login',{method:'POST',body:'{"password":"2026"}'}),env)).status,410);
 assert.equal((await authRoute(new Request('https://api.example/auth/exchange',{method:'POST',headers:{Origin:'https://attacker.example'},body:'{}'}),env)).status,403);
 assert.equal((await authRoute(new Request('https://api.example/auth/start'),{})).status,503);
 await assert.rejects(authorizeAPI(new Request('https://api.example/api/tours'),{}),e=>e.status===503);
});
test('認証済みCookieはHttpOnly/Secure、GitHubへ返るのは一度限りのコード',async()=>{
 const f=fixture(),env={APP_URL:'https://furuta-ideas.github.io/TourRuncher/',CF_ACCESS_ISSUER:'https://team.cloudflareaccess.com',CF_ACCESS_AUD:'app',CF_ACCESS_MFA_CONFIRMED:'1',AUTH_STORE:{idFromName:()=>'',get:()=>({call:async(action,args)=>{
  try{return {ok:true,data:action==='start'?f.repo.start(args.flow,args.ip):f.repo.finish(args.flow,null,args.cookie,f.entries)};}catch(e){return {ok:false,status:e.status,error:e.message};}
 }})}};
 const a=f.login(),verifier=random(),state=random();
 const r=await authRoute(new Request('https://api.example/auth/start?'+new URLSearchParams({challenge:hash(verifier),state,personal:'1'})),env);
 const flowCookie=r.headers.get('set-cookie').split(';')[0];assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
 const done=await authRoute(new Request('https://api.example/auth/continue',{headers:{Cookie:flowCookie+'; __Host-playbook-session='+a.sessionCookie}}),env);
 const location=done.headers.get('location');assert.ok(location.startsWith(env.APP_URL+'#auth_code='));assert.ok(!location.includes(a.sessionCookie));assert.ok(!location.includes(a.token));assert.match(done.headers.get('set-cookie'),/Max-Age=/);
});
