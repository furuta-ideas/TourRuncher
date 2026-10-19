import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { random, hash } from '../auth-core.mjs';

// Run after `wrangler deploy --dry-run --outdir .wrangler/auth-build`.
// Uses the installed Wrangler runtime, synthetic settings, and an ephemeral SQLite store.
const require=createRequire(import.meta.url);
const runtime=createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions }=runtime('miniflare');
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{
  modules:true,scriptPath:resolve('.wrangler/auth-build/worker.js'),
  compatibilityDate:'2026-10-01',compatibilityFlags:['nodejs_compat','enable_nodejs_http_server_modules'],
  durableObjects:{AUTH_STORE:{className:'AuthStore',useSQLite:true}},
  bindings:{SESSION_SECRET:'smoke-test-only-not-a-production-secret',CLOUDFLARE_WORKER:'1',DIRECT_DOWNLOADS:'1',
    CF_ACCESS_ISSUER:'https://test.cloudflareaccess.com',CF_ACCESS_AUD:'smoke-test',CF_ACCESS_MFA_CONFIRMED:'1',
    APP_URL:'https://furuta-ideas.github.io/TourRuncher/'}
}]}));
try{
 const root='https://api.example';
 const dispatch=(url,options={})=>mf.dispatchFetch(url,{...options,redirect:'manual'});
 const start=await dispatch(root+'/auth/start?'+new URLSearchParams({challenge:hash(random()),state:random(),personal:'1'}));
 assert.equal(start.status,303);assert.equal(start.headers.get('location'),'/auth/continue');
 const cookie=start.headers.get('set-cookie').split(';')[0];
 const next=await dispatch(root+'/auth/continue',{headers:{Cookie:cookie}});assert.equal(next.status,303);assert.equal(next.headers.get('location'),'/auth/verify');
 assert.equal((await dispatch(root+'/auth/verify',{headers:{Cookie:cookie,'Cf-Access-Jwt-Assertion':'forged'}})).status,401);
 assert.equal((await dispatch(root+'/api/tours')).status,401);
 assert.equal((await dispatch(root+'/api/login',{method:'POST',body:'{"password":"2026"}'})).status,410);
 assert.equal((await dispatch(root+'/health')).status,200);
 assert.equal((await dispatch('http://api.example/health')).status,308);
 console.log('Worker runtime smoke: SQLite flow, forged identity, API guard, old login and HTTPS passed.');
}finally{await mf.dispose();}
