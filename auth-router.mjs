import { createHmac } from 'node:crypto';
import { accessIdentity, AuthError, random } from './auth-core.mjs';

const COOKIE='__Host-playbook-session', FLOW='__Host-playbook-flow';
const headers={
  'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
  'Strict-Transport-Security':'max-age=31536000',
  'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
};
function cookieValue(req,key){return req.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(key+'='))?.slice(key.length+1) || '';}
function cookie(name,value,seconds){return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax${seconds===undefined?'':`; Max-Age=${seconds}`}`;}
function appURL(env){return env.APP_URL || 'https://furuta-ideas.github.io/TourRuncher/';}
export function cors(req,env){return req.headers.get('Origin')===new URL(appURL(env)).origin?{'Access-Control-Allow-Origin':new URL(appURL(env)).origin,'Vary':'Origin','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}:{};}
function json(req,env,data,status=200){return Response.json(data,{status,headers:{...headers,...cors(req,env)}});}
async function body(req){if(Number(req.headers.get('Content-Length'))>4096)throw new AuthError(413,'入力が長すぎます。');const bytes=await req.arrayBuffer();if(bytes.byteLength>4096)throw new AuthError(413,'入力が長すぎます。');try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new AuthError(400,'入力形式を確認してください。');}}
async function store(env,action,args){
  if(!env.AUTH_STORE)throw new AuthError(503,'本人確認の保存先が未設定です。');
  const result=await env.AUTH_STORE.get(env.AUTH_STORE.idFromName('playbook-auth-v1')).call(action,args);
  if(!result.ok)throw new AuthError(result.status,result.error);return result.data;
}
function returned(env,result){
  const url=new URL(appURL(env));url.hash=new URLSearchParams({auth_code:result.code,state:result.state}).toString();
  const h=new Headers({...headers,Location:url.href});
  h.append('Set-Cookie',cookie(FLOW,'',0));
  if(result.sessionCookie)h.append('Set-Cookie',cookie(COOKIE,result.sessionCookie,result.personal?Math.max(0,Math.floor((result.expires-Date.now())/1000)):undefined));
  return new Response(null,{status:303,headers:h});
}
export function internalProof(req,secret){
  const url=new URL(req.url),value=`${Date.now()}.${random()}`;
  return value+'.'+createHmac('sha256',secret).update(`playbook-internal-v2\n${req.method}\n${url.pathname+url.search}\n${value}`).digest('base64url');
}
export async function authorizeAPI(req,env){
  if(!env.CF_ACCESS_ISSUER || !env.CF_ACCESS_AUD || env.CF_ACCESS_MFA_CONFIRMED!=='1')throw new AuthError(503,'本人確認の設定が未完了です。管理者に連絡してください。');
  const token=req.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  return store(env,'authorize',{token});
}
export async function authRoute(req,env){
  const url=new URL(req.url),path=url.pathname;
  if(!path.startsWith('/auth/') && path!=='/api/login')return null;
  try{
    if(url.protocol!=='https:')throw new AuthError(400,'HTTPSで接続してください。');
    if(path==='/api/login')return json(req,env,{error:'パスワードによるログインは終了しました。本人確認からログインしてください。'},410);
    if(req.method==='OPTIONS')return new Response(null,{status:Object.keys(cors(req,env)).length?204:403,headers:{...headers,...cors(req,env)}});
    const ready=env.CF_ACCESS_ISSUER && env.CF_ACCESS_AUD && env.CF_ACCESS_MFA_CONFIRMED==='1' && env.AUTH_STORE;
    if(!ready)throw new AuthError(503,'本人確認の設定が未完了です。管理者に連絡してください。');
    if(path==='/auth/start' && req.method==='GET'){
      const flow=await store(env,'start',{ip:req.headers.get('CF-Connecting-IP') || 'unknown',flow:{challenge:url.searchParams.get('challenge'),state:url.searchParams.get('state'),personal:url.searchParams.get('personal')==='1'}});
      const h=new Headers({...headers,Location:'/auth/continue'}); h.append('Set-Cookie',cookie(FLOW,flow,600));
      return new Response(null,{status:303,headers:h});
    }
    if(path==='/auth/continue' && req.method==='GET'){
      const flow=cookieValue(req,FLOW),session=cookieValue(req,COOKIE);
      if(session){try{return returned(env,await store(env,'resume',{flow,cookie:session}));}catch(e){if(e.status!==401)throw e;}}
      return new Response(null,{status:303,headers:{...headers,Location:'/auth/verify'}});
    }
    if(path==='/auth/verify' && req.method==='GET'){
      // This exact path must be protected by the MFA-required Access application.
      // Headers supplied by a caller are insufficient: validate signature, issuer, audience and expiry.
      const identity=await accessIdentity(req.headers.get('Cf-Access-Jwt-Assertion'),env);
      return returned(env,await store(env,'complete',{flow:cookieValue(req,FLOW),identity}));
    }
    if(path==='/auth/exchange' && req.method==='POST'){
      if(!Object.keys(cors(req,env)).length)throw new AuthError(403,'アクセス元を確認できません。');
      const input=await body(req);
      return json(req,env,await store(env,'exchange',{code:input.code,verifier:input.verifier}));
    }
    if(path==='/auth/session' && req.method==='GET'){
      const session=await authorizeAPI(req,env);return json(req,env,{email:session.email,sessionExpires:session.expires});
    }
    if(path==='/auth/logout' && req.method==='POST'){
      if(!Object.keys(cors(req,env)).length)throw new AuthError(403,'アクセス元を確認できません。');
      const input=await body(req),token=req.headers.get('Authorization')?.replace(/^Bearer /,'');
      await store(env,'logout',{token,all:input.all===true});return json(req,env,{ok:true});
    }
    if(path==='/auth/clear' && req.method==='GET'){
      await store(env,'clear',{cookie:cookieValue(req,COOKIE)});
      const issuer=new URL(env.CF_ACCESS_ISSUER);
      issuer.pathname='/cdn-cgi/access/logout';issuer.searchParams.set('returnTo',appURL(env));
      const h=new Headers({...headers,Location:issuer.href});h.append('Set-Cookie',cookie(COOKIE,'',0));h.append('Set-Cookie',cookie(FLOW,'',0));
      return new Response(null,{status:303,headers:h});
    }
    throw new AuthError(404,'ページが見つかりません。');
  }catch(e){
    const status=e instanceof AuthError?e.status:503,error=e instanceof AuthError?e.message:'本人確認を完了できません。しばらくしてから再度お試しください。';
    if(req.method==='GET' && !['/auth/session'].includes(path)){
      // Only fixed, non-secret messages are rendered; never interpolate provider/Notion responses.
      const safe=error.replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
      return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Tour PlayBook 本人確認</title><style>body{font:18px sans-serif;margin:12vh auto;max-width:34em;padding:24px;line-height:1.8}a{color:#087f72}</style><h1>Tour PlayBook</h1><p>${safe}</p><p><a href="${appURL(env)}">アプリに戻る</a></p>`,{status,headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
    }
    return json(req,env,{error},status);
  }
}
export function apiAuthError(req,env,e){return json(req,env,{error:e instanceof AuthError?e.message:'利用許可を確認できません。しばらくしてから再度お試しください。'},e instanceof AuthError?e.status:503);}
