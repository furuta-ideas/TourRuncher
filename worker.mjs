import { httpServerHandler } from 'cloudflare:node';
import { server } from './server.mjs';
import { authRoute, authorizeAPI, internalProof, apiAuthError } from './auth-router.mjs';
export { AuthStore } from './auth-object.mjs';

const handler=httpServerHandler(server);
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
      forwarded.headers.set('X-Playbook-Internal-Proof',internalProof(request,env.SESSION_SECRET));
    }
    const response=await handler.fetch(forwarded,env,ctx);
    const safe=new Response(response.body,response);safe.headers.set('Strict-Transport-Security','max-age=31536000');return safe;
  }
};
