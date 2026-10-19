import { DurableObject } from 'cloudflare:workers';
import { AuthRepository, AuthError, aclEntries, ACL_MS } from './auth-core.mjs';

export class AuthStore extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env); this.repo=new AuthRepository(ctx.storage.sql); this.acl=null; this.checked=0;
  }
  async entries() {
    if(this.acl && Date.now()-this.checked<ACL_MS) return this.acl;
    // Block interleaving while refreshing the global ACL; never share I/O across Worker requests.
    return this.ctx.blockConcurrencyWhile(async()=>{
      if(this.acl && Date.now()-this.checked<ACL_MS)return this.acl;
      if(!this.env.NOTION_TOKEN || !this.env.ACL_SOURCE_ID)throw new AuthError(503,'利用許可リストの接続が未設定です。');
      let cursor; const pages=[];
      do {
        const r=await fetch(`https://api.notion.com/v1/data_sources/${this.env.ACL_SOURCE_ID}/query`,{
          method:'POST',headers:{Authorization:`Bearer ${this.env.NOTION_TOKEN}`,'Notion-Version':'2025-09-03','Content-Type':'application/json'},
          body:JSON.stringify({page_size:100,...(cursor?{start_cursor:cursor}:{})}),signal:AbortSignal.timeout(12000)
        });
        if(!r.ok)throw new AuthError(503,'利用許可を確認できません。しばらくしてから再度お試しください。');
        const data=await r.json(); pages.push(...data.results); cursor=data.has_more?data.next_cursor:null;
        if(cursor)await new Promise(resolve=>setTimeout(resolve,350));
        if(pages.length>5000)throw new AuthError(503,'利用許可リストを確認できません。管理者に連絡してください。');
      }while(cursor);
      const entries=aclEntries(pages);
      this.repo.revokeRemoved(entries); this.acl=entries; this.checked=Date.now();
      return entries;
    });
  }
  async call(action,args) {
    try {
      if(action==='start')return {ok:true,data:this.repo.start(args.flow,args.ip)};
      if(action==='logout'){this.repo.logout(args.token,null,!!args.all);return {ok:true,data:{ok:true}};}
      if(action==='clear'){this.repo.revokeCookie(args.cookie);return {ok:true,data:{ok:true}};}
      if(action==='authorize')this.repo.token(args.token);
      const entries=await this.entries();
      let data;
      if(action==='resume')data=this.repo.finish(args.flow,null,args.cookie,entries);
      else if(action==='complete')data=this.repo.finish(args.flow,args.identity,null,entries);
      else if(action==='exchange')data=this.repo.exchange(args.code,args.verifier,entries);
      else if(action==='authorize')data=this.repo.authorize(args.token,entries);
      else throw new AuthError(404,'この操作は使用できません。');
      return {ok:true,data};
    }catch(e){return {ok:false,status:e instanceof AuthError?e.status:503,error:e instanceof AuthError?e.message:'本人確認を完了できません。しばらくしてから再度お試しください。'};}
  }
}
