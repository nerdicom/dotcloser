import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_PATH=':memory:';
process.env.ENCRYPTION_KEY='a'.repeat(64);
process.env.SESSION_SECRET='b'.repeat(64);
process.env.NODE_ENV='test';
const {db,run,get,all}=await import('../server/db.mjs');
const {id,now,usage,reserveCampaign:reserve,seal,unseal,hash,unsubscribeToken,decodeUnsubscribe}=await import('../server/core.mjs');
const {processQueue}=await import('../server/worker.mjs');
const {app}=await import('../server/application.mjs');
const {imageData,emailHTML}=await import('../server/branding.mjs');
function snapshot(userId,draftIds){const u=get('SELECT * FROM users WHERE id=?',userId);return {userName:u.name,company:u.company,address:u.address,logo:u.logo||'',avatar:u.avatar||'',mailboxEmail:get('SELECT email FROM mailboxes WHERE user_id=?',userId)?.email,drafts:draftIds.map(id=>{const d=get('SELECT d.*,p.email FROM drafts d JOIN prospects p ON p.id=d.prospect_id WHERE d.id=?',id);return {id,subject:d?.subject,body:d?.body,recipient:d?.email};})};}
function reserveCampaign(userId,ids,key){return reserve(userId,ids,key,snapshot(userId,ids));}
function fixture(count=12,plan='trial'){
 const u=id();run('INSERT INTO users (id,name,email,address,created_at,trial_end,plan,paid_until,subscription_id) VALUES (?,?,?,?,?,?,?,?,?)',u,'Test Seller',u+'@example.com','123 Test St, City, US',now(),new Date(Date.now()+604800000).toISOString(),plan,plan==='standard'?new Date(Date.now()+2592000000).toISOString():null,plan==='standard'?'sub_'+u:null);
 run('INSERT INTO mailboxes VALUES (?,?,?,?,?)',u,'google',u+'@example.com',seal({access_token:'test',expires_at:Date.now()+3600000}),now());
 const d=id();run('INSERT INTO domains VALUES (?,?,?,?,?,?,?)',d,u,'testing'+u.slice(0,8)+'.com',250000,'USD','testing',now());
 const drafts=[];
 for(let i=0;i<count;i++){const p=id(),dr=id();run('INSERT INTO prospects VALUES (?,?,?,?,?,?,?,?,?,?,?)',p,u,d,'Business '+i,'business'+i+'.com','hello'+i+'@business.com','manual','https://business.com/contact','A relevant brand.',1,now());run('INSERT INTO drafts VALUES (?,?,?,?,?,?,?)',dr,u,d,p,'A domain for your business','Hello team, this domain is available.',now());drafts.push(dr);}
 return {user:get('SELECT * FROM users WHERE id=?',u),drafts,domain:d};
}
test('trial reserves exactly ten and rejects over-limit atomically',()=>{const f=fixture();assert.throws(()=>reserveCampaign(f.user.id,f.drafts.slice(0,11),id()),/allowance/);assert.equal(usage(f.user).used,0);const key=id();const jobs=reserveCampaign(f.user.id,f.drafts.slice(0,10),key);assert.equal(jobs.length,10);assert.equal(usage(f.user).remaining,0);assert.equal(reserveCampaign(f.user.id,f.drafts.slice(0,10),key).length,10);assert.throws(()=>reserveCampaign(f.user.id,[f.drafts[10]],id()),/allowance/);});
test('expired trial cannot reserve or reset through a paid status change',()=>{const f=fixture(1);run('UPDATE users SET trial_end=? WHERE id=?','2020-01-01T00:00:00Z',f.user.id);assert.throws(()=>reserveCampaign(f.user.id,f.drafts,id()),/allowance/);const u=get('SELECT * FROM users WHERE id=?',f.user.id);assert.equal(usage(u).plan,'expired');});
test('Standard enforces fifty and resets accepted/unknown outcomes on UTC midnight',()=>{const f=fixture(51,'standard');reserveCampaign(f.user.id,f.drafts.slice(0,50),id());assert.throws(()=>reserveCampaign(f.user.id,[f.drafts[50]],id()),/allowance/);run("UPDATE sends SET status='sent',sent_at=? WHERE user_id=?",'2020-01-01T12:00:00Z',f.user.id);assert.equal(usage(f.user).remaining,50);const first=get('SELECT id FROM sends WHERE user_id=? LIMIT 1',f.user.id);run("UPDATE sends SET status='unknown',sent_at=NULL,reserved_at=? WHERE id=?",'2020-01-01T12:00:00Z',first.id);assert.equal(usage(f.user).remaining,50);});
test('foreign drafts, unreviewed contacts and duplicate domain-recipient sends are blocked',()=>{const a=fixture(2),b=fixture(1);assert.throws(()=>reserveCampaign(a.user.id,b.drafts,id()),/reviewed/);run('UPDATE prospects SET reviewed=0 WHERE user_id=?',a.user.id);assert.throws(()=>reserveCampaign(a.user.id,a.drafts,id()),/reviewed/);run('UPDATE prospects SET reviewed=1 WHERE user_id=?',a.user.id);reserveCampaign(a.user.id,[a.drafts[0]],id());assert.throws(()=>reserveCampaign(a.user.id,[a.drafts[0]],id()),/already/);});
test('cancelled and definitely failed jobs can be requeued; uncertain jobs cannot',()=>{const f=fixture(1);const [job]=reserveCampaign(f.user.id,f.drafts,id());run("UPDATE sends SET status='cancelled' WHERE id=?",job.id);assert.equal(usage(f.user).used,0);const [second]=reserveCampaign(f.user.id,f.drafts,id());run("UPDATE sends SET status='failed' WHERE id=?",second.id);const [third]=reserveCampaign(f.user.id,f.drafts,id());run("UPDATE sends SET status='unknown' WHERE id=?",third.id);assert.throws(()=>reserveCampaign(f.user.id,f.drafts,id()),/already/);});
test('unsubscribe tokens reject tampering and suppress reservations',()=>{const f=fixture(1);const recipient=get('SELECT email FROM prospects WHERE user_id=?',f.user.id).email;const token=unsubscribeToken(f.user.id,recipient);assert.deepEqual(decodeUnsubscribe(token),[f.user.id,recipient]);assert.throws(()=>decodeUnsubscribe(token+'bad'));run('INSERT INTO suppressions VALUES (?,?,?)',f.user.id,recipient,now());assert.throws(()=>reserveCampaign(f.user.id,f.drafts,id()),/unsubscribed/);});
test('tokens are encrypted with authenticated encryption',()=>{const text=seal({refresh_token:'secret'});assert.ok(!text.includes('secret'));assert.equal(unseal(text).refresh_token,'secret');const pieces=text.split('.');pieces[2]='A'+pieces[2].slice(1);assert.throws(()=>unseal(pieces.join('.')));});
test('worker accepts provider result once and retains ambiguous outcome without retry',async()=>{
 run("UPDATE sends SET status='cancelled' WHERE status='queued'");const f=fixture(2);const jobs=reserveCampaign(f.user.id,f.drafts,id());let calls=0;await processQueue(async()=>{calls++;return 'provider-test-id';});assert.equal(get('SELECT status FROM sends WHERE id=?',jobs[0].id).status,'sent');await processQueue(async()=>{calls++;const e=Error('Interrupted');e.unknown=true;throw e;});assert.equal(get('SELECT status FROM sends WHERE id=?',jobs[1].id).status,'unknown');await processQueue(async()=>{calls++;});assert.equal(calls,2);
});
test('authenticated endpoints enforce sessions, CSRF, tenant isolation, and cancellation on unsubscribe',async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const f=fixture(1),other=fixture(1),raw=id(),csrf=id();run('INSERT INTO sessions VALUES (?,?,?,?)',hash(raw),f.user.id,csrf,new Date(Date.now()+60000).toISOString());
  assert.equal((await fetch(base+'/api/workspace')).status,401);
  const headers={'Content-Type':'application/json',Cookie:'dc_session='+raw,Origin:'http://localhost:3000'};
  assert.equal((await fetch(base+'/api/profile',{method:'PATCH',headers,body:'{}'})).status,403);
  headers['X-CSRF-Token']=csrf;
  const r=await fetch(base+'/api/workspace',{headers});const w=await r.json();assert.equal(w.domains.length,1);assert.equal(w.domains[0].user_id,f.user.id);
  assert.equal((await fetch(base+'/api/drafts/'+other.drafts[0],{method:'PATCH',headers,body:JSON.stringify({subject:'Test',body:'Test'})})).status,404);
  const [j]=reserveCampaign(f.user.id,f.drafts,id());const em=get('SELECT email FROM prospects WHERE user_id=?',f.user.id).email;assert.equal((await fetch(base+'/unsubscribe/'+unsubscribeToken(f.user.id,em),{method:'POST'})).status,200);assert.equal(get('SELECT status FROM sends WHERE id=?',j.id).status,'cancelled');
 }finally{await new Promise(r=>server.close(r));}
});

test('stale review cannot send changed recipients or messages',()=>{const f=fixture(1);const reviewed=snapshot(f.user.id,f.drafts);run('UPDATE drafts SET body=? WHERE id=?','Changed after review',f.drafts[0]);assert.throws(()=>reserve(f.user.id,f.drafts,id(),reviewed),/changed after review/);assert.equal(usage(f.user).used,0);const latest=snapshot(f.user.id,f.drafts);run('UPDATE prospects SET email=? WHERE user_id=?','different@business.com',f.user.id);assert.throws(()=>reserve(f.user.id,f.drafts,id(),latest),/changed after review/);});
test('failed upgrade retains original trial; a former paid plan never restarts it',()=>{const f=fixture(1);run("UPDATE users SET subscription_id='sub_incomplete',plan='expired' WHERE id=?",f.user.id);assert.equal(usage(get('SELECT * FROM users WHERE id=?',f.user.id)).plan,'trial');run('UPDATE users SET ever_paid=1 WHERE id=?',f.user.id);assert.equal(usage(get('SELECT * FROM users WHERE id=?',f.user.id)).plan,'expired');});

test('seller branding is validated and queued with the reviewed campaign',()=>{
 const f=fixture(1);
 const png='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64');
 assert.equal(imageData(png,'logo'),png);assert.throws(()=>imageData('data:image/svg+xml;base64,PHN2Zz4=','logo'));
 run('UPDATE users SET logo=? WHERE id=?',png,f.user.id);const reviewed=snapshot(f.user.id,f.drafts);
 run('UPDATE users SET logo=? WHERE id=?','',f.user.id);assert.throws(()=>reserve(f.user.id,f.drafts,id(),reviewed),/sender details changed/);
 run('UPDATE users SET logo=? WHERE id=?',png,f.user.id);const [job]=reserve(f.user.id,f.drafts,id(),reviewed);
 assert.equal(get('SELECT sender_logo FROM sends WHERE id=?',job.id).sender_logo,png);
 assert.match(emailHTML('<hello>',{name:'Seller',company:'Company',address:'Street',logo:png},'https://example.com/unsubscribe'),/&lt;hello&gt;/);
});
