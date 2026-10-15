import { httpServerHandler } from 'cloudflare:node';
import { server } from './server.mjs';

const handler=httpServerHandler(server);
export default {
  fetch(request,env,ctx){
    for(const key of ['NOTION_TOKEN','SESSION_SECRET','APP_PASSWORD','CLOUDFLARE_WORKER','DIRECT_DOWNLOADS'])if(env[key]!==undefined)process.env[key]=env[key];
    if(!env.SESSION_SECRET || !env.APP_PASSWORD)return Response.json({error:'APIの初期設定が必要です。管理者に連絡してください。'},{status:503});
    return handler.fetch(request,env,ctx);
  }
};
