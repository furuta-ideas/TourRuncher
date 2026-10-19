import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const PERSONAL_MS = 30 * 24 * 60 * 60 * 1000;
export const SHARED_MS = 12 * 60 * 60 * 1000;
export const API_MS = 12 * 60 * 60 * 1000;
export const ACL_MS = 60 * 1000;
export const hash = value => createHash('sha256').update(value).digest('base64url');
export const random = () => randomBytes(32).toString('base64url');
export const emailKey = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
export class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function aclEntries(pages) {
  const text = p => (p?.rich_text || p?.title || []).map(x => x.plain_text ?? x.text?.content ?? '').join('');
  return pages.filter(p => !p.archived && !p.in_trash).map(p => {
    const props = p.properties || {};
    const email = emailKey(props['メールアドレス']?.email ?? text(props['メールアドレス']));
    const expires = props['有効期限']?.date?.start;
    // Missing/incorrect permission properties fail closed, including during schema migration.
    return {id:p.id, email, enabled:props['利用許可']?.type === 'checkbox' && props['利用許可'].checkbox === true,
      expires:expires ? Date.parse(expires.length === 10 ? expires+'T23:59:59+09:00' : expires) : null};
  });
}
export function allowedEntry(entries, email, now=Date.now(), aclId) {
  const matches = entries.filter(x => x.email === emailKey(email));
  if (matches.length !== 1) return null;
  const item = matches[0];
  return item.enabled && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email) &&
    (item.expires === null || Number.isFinite(item.expires) && item.expires > now) && (!aclId || item.id === aclId) ? item : null;
}
export async function accessIdentity(assertion, env, keyset) {
  const issuer = env.CF_ACCESS_ISSUER;
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer || '') || !env.CF_ACCESS_AUD || env.CF_ACCESS_MFA_CONFIRMED !== '1')
    throw new AuthError(503, '本人確認の設定が未完了です。管理者に連絡してください。');
  if (!assertion || assertion.length > 16000) throw new AuthError(401, '本人確認が必要です。');
  if (!keyset) {
    keyset=createRemoteJWKSet(new URL(issuer+'/cdn-cgi/access/certs'),{timeoutDuration:10000});
  }
  let claims;
  try { ({payload:claims}=await jwtVerify(assertion,keyset,{issuer,audience:env.CF_ACCESS_AUD,algorithms:['RS256'],requiredClaims:['sub','email','iat','exp'],clockTolerance:5})); }
  catch { throw new AuthError(401, '本人確認の有効期限が切れています。再度ログインしてください。'); }
  if (claims.type !== 'app' || typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string')
    throw new AuthError(401, '利用者の本人確認ができません。');
  return {key:issuer+'|'+claims.sub,email:emailKey(claims.email),proofExpires:claims.exp*1000};
}

// All mutations are synchronous SQLite statements inside a single Durable Object.
// Browser tokens/cookies are stored as hashes; authentication tokens never enter Notion.
export class AuthRepository {
  constructor(sql, clock=Date.now) {
    this.sql=sql; this.clock=clock;
    sql.exec(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, identity TEXT NOT NULL, email TEXT NOT NULL, acl_id TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS bindings (identity TEXT PRIMARY KEY, acl_id TEXT NOT NULL UNIQUE, email TEXT NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS flows (id TEXT PRIMARY KEY, challenge TEXT NOT NULL, state TEXT NOT NULL, personal INTEGER NOT NULL, expires INTEGER NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS codes (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, challenge TEXT NOT NULL, expires INTEGER NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, expires INTEGER NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS rates (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS sessions_identity ON sessions(identity)`);
  }
  one(query,...values) { return this.sql.exec(query,...values).toArray()[0]; }
  clean() {
    const now=this.clock();
    for(const table of ['sessions','flows','codes','tokens','rates']) this.sql.exec(`DELETE FROM ${table} WHERE expires <= ?`,now);
  }
  rate(id) {
    const now=this.clock(), key=hash(id), row=this.one('SELECT * FROM rates WHERE id=?',key);
    if(row && row.expires>now && row.count>=100) throw new AuthError(429,'操作回数が多すぎます。10分後にお試しください。');
    this.sql.exec('INSERT OR REPLACE INTO rates VALUES (?, ?, ?)',key,row?.expires>now?row.count+1:1,row?.expires>now?row.expires:now+600000);
  }
  start({challenge,state,personal}, ip) {
    this.clean(); this.rate(ip);
    if(!/^[A-Za-z0-9_-]{43}$/.test(challenge || '') || !/^[A-Za-z0-9_-]{43}$/.test(state || '')) throw new AuthError(400,'ログイン操作をやり直してください。');
    const id=random();
    this.sql.exec('INSERT INTO flows VALUES (?,?,?,?,?)',hash(id),challenge,state,personal?1:0,this.clock()+600000);
    return id;
  }
  session(cookie,entries) {
    if(!/^[A-Za-z0-9_-]{43}$/.test(cookie || '')) throw new AuthError(401,'再度ログインしてください。');
    return this.sessionByHash(hash(cookie),entries);
  }
  sessionByHash(id,entries) {
    const session=this.one('SELECT * FROM sessions WHERE id=?',id);
    if(!session || session.revoked || session.expires<=this.clock()) throw new AuthError(401,'再度ログインしてください。');
    if(!allowedEntry(entries,session.email,this.clock(),session.acl_id)) {
      this.sql.exec('UPDATE sessions SET revoked=1 WHERE identity=?',session.identity);
      throw new AuthError(403,'このアプリの利用が許可されていません。管理者に確認してください。');
    }
    return session;
  }
  revokeRemoved(entries) {
    for(const s of this.sql.exec('SELECT id,email,acl_id FROM sessions WHERE revoked=0').toArray())
      if(!allowedEntry(entries,s.email,this.clock(),s.acl_id)) this.sql.exec('UPDATE sessions SET revoked=1 WHERE id=?',s.id);
  }
  finish(flowCookie, identity, cookie, entries) {
    const id=hash(flowCookie || ''), flow=this.one('SELECT * FROM flows WHERE id=?',id);
    if(!flow || flow.expires<=this.clock()) throw new AuthError(400,'ログイン操作の有効期限が切れました。最初からやり直してください。');
    let session, sessionCookie;
    if(identity) {
      const entry=allowedEntry(entries,identity.email,this.clock());
      if(!entry) throw new AuthError(403,'このアプリの利用が許可されていません。管理者に確認してください。');
      const binding=this.one('SELECT * FROM bindings WHERE identity=? OR acl_id=?',identity.key,entry.id);
      if(binding && (binding.identity!==identity.key || binding.acl_id!==entry.id || binding.email!==identity.email))
        throw new AuthError(403,'登録されたアカウントと一致しません。管理者に確認してください。');
      const expires=Math.min(this.clock()+(flow.personal?PERSONAL_MS:SHARED_MS),identity.proofExpires);
      if(expires<=this.clock()) throw new AuthError(401,'本人確認の有効期限が切れています。');
      this.sql.exec('INSERT OR IGNORE INTO bindings VALUES (?,?,?)',identity.key,entry.id,identity.email);
      sessionCookie=random(); session={id:hash(sessionCookie),identity:identity.key,email:identity.email,acl_id:entry.id,expires};
      this.sql.exec('INSERT INTO sessions (id,identity,email,acl_id,expires) VALUES (?,?,?,?,?)',session.id,session.identity,session.email,entry.id,expires);
    } else {
      session=this.session(cookie,entries); sessionCookie=cookie;
      if(!flow.personal) {
        session.expires=Math.min(session.expires,this.clock()+SHARED_MS);
        this.sql.exec('UPDATE sessions SET expires=? WHERE id=?',session.expires,session.id);
      }
    }
    this.sql.exec('DELETE FROM flows WHERE id=?',id);
    const code=random();
    this.sql.exec('INSERT INTO codes VALUES (?,?,?,?)',hash(code),session.id,flow.challenge,this.clock()+60000);
    return {code,state:flow.state,sessionCookie,expires:session.expires,personal:!!flow.personal};
  }
  exchange(code, verifier, entries) {
    if(!/^[A-Za-z0-9_-]{43,128}$/.test(verifier || '') || typeof code!=='string') throw new AuthError(400,'ログイン操作をやり直してください。');
    const row=this.one('SELECT * FROM codes WHERE id=?',hash(code));
    if(!row || row.expires<=this.clock() || row.challenge!==hash(verifier)) throw new AuthError(401,'ログイン操作をやり直してください。');
    this.sql.exec('DELETE FROM codes WHERE id=?',hash(code));
    const session=this.sessionByHash(row.session_id,entries),token=random(),expires=Math.min(this.clock()+API_MS,session.expires);
    this.sql.exec('INSERT INTO tokens VALUES (?,?,?)',hash(token),session.id,expires);
    return {token,expires,sessionExpires:session.expires,email:session.email};
  }
  authorize(token,entries) {
    const row=this.token(token);
    return this.sessionByHash(row.session_id,entries);
  }
  token(token) {
    if(!/^[A-Za-z0-9_-]{43}$/.test(token || '')) throw new AuthError(401,'ログインしてください。');
    const row=this.one('SELECT * FROM tokens WHERE id=?',hash(token));
    if(!row || row.expires<=this.clock()) throw new AuthError(401,'再度ログインしてください。');
    return row;
  }
  logout(token,entries,all=false) {
    const row=typeof token==='string'?this.one('SELECT * FROM tokens WHERE id=?',hash(token)):null;
    const session=row?this.one('SELECT * FROM sessions WHERE id=?',row.session_id):null;
    if(!session)throw new AuthError(401,'再度ログインしてください。');
    this.sql.exec(all?'UPDATE sessions SET revoked=1 WHERE identity=?':'UPDATE sessions SET revoked=1 WHERE id=?',all?session.identity:session.id);
  }
  revokeCookie(value) { if(value)this.sql.exec('UPDATE sessions SET revoked=1 WHERE id=?',hash(value)); }
}
