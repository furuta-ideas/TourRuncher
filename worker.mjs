import { httpServerHandler } from 'cloudflare:node';
import { server } from './server.mjs';
import { authRoute, authorizeAPI, internalProof, apiAuthError } from './auth-router.mjs';
export { AuthStore } from './auth-object.mjs';

const handler=httpServerHandler(server);
function apiJSON(request,status,body){
  const origin=request.headers.get('Origin');
  let appOrigin='';
  try{appOrigin=new URL(process.env.APP_URL).origin;}catch{}
  const headers={
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'private, no-store',
    'Strict-Transport-Security':'max-age=31536000',
    'X-Content-Type-Options':'nosniff'
  };
  if(origin===appOrigin){headers['Access-Control-Allow-Origin']=origin;headers.Vary='Origin';}
  return new Response(JSON.stringify(body),{status,headers});
}
async function privateFAQ(request,env){
  if(!env.FAQ_DB)return apiJSON(request,503,{error:'FAQデータベースが設定されていません。'});
  const data=await env.FAQ_DB.get('current',{type:'json'});
  if(!data || !Array.isArray(data.records))return apiJSON(request,503,{error:'FAQデータベースを読み込めません。'});
  return apiJSON(request,200,{rows:data.records,meta:{version:data.version,updatedAt:data.updatedAt,count:data.records.length}});
}
export default {
  async fetch(request,env,ctx){
    if(new URL(request.url).protocol!=='https:')return Response.redirect(request.url.replace(/^http:/,'https:'),308);
    const auth=await authRoute(request,env);if(auth)return auth;
    for(const key of ['NOTION_TOKEN','SESSION_SECRET','CLOUDFLARE_WORKER','DIRECT_DOWNLOADS'])if(env[key]!==undefined)process.env[key]=env[key];
    if(!env.SESSION_SECRET)return Response.json({error:'APIの初期設定が必要です。管理者に連絡してください。'},{status:503});
    const url=new URL(request.url),forwarded=new Request(request);
    forwarded.headers.delete('X-Playbook-Internal-Proof');
    if(url.pathname.startsWith('/api/') && request.method!=='OPTIONS'){
      try { await authorizeAPI(request,env); }
      catch(e){return apiAuthError(request,env,e);}
      if(url.pathname==='/api/faq' && request.method==='GET')return privateFAQ(request,env);
      forwarded.headers.set('X-Playbook-Internal-Proof',internalProof(request,env.SESSION_SECRET));
    }
    const response=await handler.fetch(forwarded,env,ctx);
    const safe=new Response(response.body,response);safe.headers.set('Strict-Transport-Security','max-age=31536000');return safe;
  }
};
