import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { config } from './config.mjs';
import { all, get, run, transaction } from './db.mjs';
import { id, now, hash, random, fail, clean, email, domain, seal, unseal, usage, reserveCampaign, generateDraft, decodeUnsubscribe } from './core.mjs';
import { providers, ready, authorizeURL, exchange, stripe, syncSubscription } from './integrations.mjs';
import { research, contactSearch } from './research.mjs';
import { startWorker } from './worker.mjs';
import { imageData } from './branding.mjs';
export const app=express();
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
app.disable('x-powered-by');app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'data:'],connectSrc:["'self'"],fontSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"],formAction:["'self'"],upgradeInsecureRequests:config.production?[]:null}}}));
app.post('/api/billing/webhook',express.raw({type:'application/json',limit:'1mb'}),async(req,res,next)=>{
 try{
  if(!stripe||!process.env.STRIPE_WEBHOOK_SECRET)return res.sendStatus(503);
  let event;try{event=stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET);}catch{return res.status(400).json({error:'Invalid webhook signature.'});}
  if(get('SELECT id FROM webhook_events WHERE id=?',event.id))return res.json({received:true});
  const o=event.data.object;
  if(event.type==='checkout.session.completed'&&o.subscription)await syncSubscription(o.subscription);
  if(event.type.startsWith('customer.subscription.'))await syncSubscription(o.id);
  if(['invoice.paid','invoice.payment_failed'].includes(event.type)){const sid=o.subscription||o.parent?.subscription_details?.subscription;if(sid)await syncSubscription(sid);}
  run('INSERT OR IGNORE INTO webhook_events VALUES (?,?)',event.id,now());res.json({received:true});
 }catch(e){next(e);}
});
app.use(express.json({limit:'1mb'}));
app.use('/api',rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Please slow down and try again in a minute.'}}));
const authLimiter=rateLimit({windowMs:15*60000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,message:'Too many sign-in attempts. Try again later.'});
const expensive=rateLimit({windowMs:60000,limit:10,keyGenerator:req=>req.user.id,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Research limit reached. Try again in one minute.'}});
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split(/=(.*)/s)).filter(p=>p.length>1).map(([k,v])=>[k,v]));}
function setCookie(res,name,value,age){res.cookie(name,value,{httpOnly:true,secure:config.production,sameSite:'lax',path:'/',maxAge:age});}
app.use((req,res,next)=>{const token=cookies(req).dc_session;if(token){const session=get('SELECT * FROM sessions WHERE id=? AND expires_at>?',hash(token),now());if(session){req.session=session;req.user=get('SELECT * FROM users WHERE id=?',session.user_id);}}next();});
function auth(req,res,next){if(!req.user)return res.status(401).json({error:'Sign in to continue.'});next();}
app.use('/api',(req,res,next)=>{
 res.set('Cache-Control','no-store');
 if(!['GET','HEAD','OPTIONS'].includes(req.method)){
  if(req.headers.origin!==config.origin)return res.status(403).json({error:'Request origin not allowed.'});
  if(req.user&&req.headers['x-csrf-token']!==req.session.csrf)return res.status(403).json({error:'Refresh the page and try again.'});
 }next();
});
let priceCache;
async function priceInfo(){if(!stripe||!process.env.STRIPE_PRICE_ID)return null;if(priceCache?.expires>Date.now())return priceCache.value;try{const p=await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID);if(!p.active||!p.recurring||p.recurring.interval!=='month')return null;const value={amount:p.unit_amount,currency:p.currency,interval:p.recurring.interval};priceCache={value,expires:Date.now()+300000};return value;}catch{return null;}}
app.get('/api/session',async(req,res)=>res.json({user:req.user?{id:req.user.id,name:req.user.name,email:req.user.email,company:req.user.company,address:req.user.address,logo:req.user.logo||'',avatar:req.user.avatar||''}:null,csrf:req.session?.csrf,usage:req.user?usage(req.user):null,config:{demo:config.demo,google:ready('google'),facebook:ready('facebook'),microsoft:ready('microsoft'),mailEncryption:!!config.encryptionKey,trialDays:config.trialDays,trialLimit:config.trialLimit,dailyLimit:config.dailyLimit,billing:!!(stripe&&process.env.STRIPE_PRICE_ID&&process.env.STRIPE_WEBHOOK_SECRET),price:await priceInfo(),sources:{regcount:process.env.REGCOUNT_ENABLED==='true',dotdb:process.env.DOTDB_ENABLED==='true'&&!!process.env.DOTDB_API_KEY,hunter:!!process.env.HUNTER_API_KEY}}}));
app.get('/api/health',(req,res)=>res.json({status:'ok',service:'dotcloser'}));
app.get('/auth/:provider/start',authLimiter,(req,res,next)=>{try{
 const {provider}=req.params;const purpose=clean(req.query.purpose||'login');if(!providers[provider]||!['login','mail','link'].includes(purpose))fail('Unsupported sign-in request.');
 if(provider==='microsoft'&&purpose!=='mail')fail('Use Google or Facebook to sign in.');if(provider==='facebook'&&purpose==='mail')fail('Facebook cannot send email.');
 if(purpose!=='login'&&!req.user)fail('Sign in first.',401);
 const state=random(),browser=random(),verifier=random();
 run('DELETE FROM oauth_states WHERE expires_at<?',now());
 run('INSERT INTO oauth_states VALUES (?,?,?,?,?,?,?)',hash(state),hash(browser),provider,purpose,req.user?.id||null,verifier,new Date(Date.now()+600000).toISOString());
 setCookie(res,'dc_oauth',browser,600000);res.redirect(authorizeURL(provider,purpose,state,verifier));
 }catch(e){next(e);}});
app.get('/auth/:provider/callback',authLimiter,async(req,res)=>{try{
 const s=get('SELECT * FROM oauth_states WHERE id=?',hash(String(req.query.state||'')));run('DELETE FROM oauth_states WHERE id=?',hash(String(req.query.state||'')));res.clearCookie('dc_oauth',{path:'/'});
 if(!s||s.provider!==req.params.provider||s.browser_hash!==hash(cookies(req).dc_oauth||'')||s.expires_at<now())fail('Sign-in expired. Please try again.');
 if(req.query.error)fail('The connection was cancelled.');if(!req.query.code)fail('Missing authorization code.');
 if(s.purpose!=='login'&&req.user?.id!==s.user_id)fail('Sign in to the same account to connect this service.',403);
 const {token,profile}=await exchange(s.provider,String(req.query.code),s.verifier);
 if(s.purpose==='mail'){
  const scopes=String(token.scope||'').toLowerCase().split(/\s+/);
  const permitted=s.provider==='google'?scopes.includes('https://www.googleapis.com/auth/gmail.send'):scopes.some(v=>v==='mail.send'||v==='https://graph.microsoft.com/mail.send');
  if(!permitted)fail('Sending permission was not granted. Reconnect and approve the send-email permission.');
  const old=get('SELECT * FROM mailboxes WHERE user_id=?',s.user_id);
  if(!token.refresh_token&&old?.provider===s.provider&&old.email===profile.email)token.refresh_token=unseal(old.encrypted).refresh_token;
  if(!token.refresh_token)fail('Offline access was not granted. Reconnect and approve access.');
  run('INSERT INTO mailboxes VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider,email=excluded.email,encrypted=excluded.encrypted,updated_at=excluded.updated_at',s.user_id,s.provider,profile.email,seal(token),now());
  return res.redirect('/?connected=1#settings');
 }
 let identity=get('SELECT * FROM identities WHERE provider=? AND subject=?',s.provider,profile.subject);
 if(s.purpose==='link'){
  if(identity&&identity.user_id!==s.user_id)fail('That sign-in belongs to another DotCloser account.');
  run('INSERT OR IGNORE INTO identities VALUES (?,?,?)',s.provider,profile.subject,s.user_id);return res.redirect('/?linked=1#settings');
 }
 if(!identity){
  if(get('SELECT id FROM users WHERE lower(email)=?',profile.email.toLowerCase()))fail('This email already has an account. Use your original sign-in, then link this provider in Settings.');
  const uid=id();transaction(()=>{run('INSERT INTO users (id,name,email,created_at,trial_end) VALUES (?,?,?,?,?)',uid,profile.name,profile.email,now(),new Date(Date.now()+config.trialDays*86400000).toISOString());run('INSERT INTO identities VALUES (?,?,?)',s.provider,profile.subject,uid);});identity={user_id:uid};
 }
 const raw=random();run('INSERT INTO sessions VALUES (?,?,?,?)',hash(raw),identity.user_id,random(),new Date(Date.now()+7*86400000).toISOString());setCookie(res,'dc_session',raw,7*86400000);res.redirect('/#overview');
 }catch(e){res.redirect('/?auth_error='+encodeURIComponent(e.status&&e.status<500?e.message:'Sign-in could not be completed. Check the provider setup and try again.')+'#overview');}});
app.post('/api/logout',auth,(req,res)=>{run('DELETE FROM sessions WHERE id=?',req.session.id);res.clearCookie('dc_session',{path:'/'});res.json({ok:true});});
app.get('/api/workspace',auth,(req,res)=>res.json({domains:all('SELECT * FROM domains WHERE user_id=? ORDER BY created_at DESC',req.user.id),prospects:all('SELECT * FROM prospects WHERE user_id=? ORDER BY created_at DESC',req.user.id),drafts:all('SELECT * FROM drafts WHERE user_id=? ORDER BY updated_at DESC',req.user.id),sends:all('SELECT * FROM sends WHERE user_id=? ORDER BY reserved_at DESC LIMIT 500',req.user.id),mailbox:get('SELECT provider,email,updated_at FROM mailboxes WHERE user_id=?',req.user.id)||null,identities:all('SELECT provider FROM identities WHERE user_id=?',req.user.id),suppressionCount:get('SELECT count(*) n FROM suppressions WHERE user_id=?',req.user.id).n,usage:usage(req.user)}));
app.patch('/api/profile',auth,(req,res)=>{const name=clean(req.body.name,100),address=clean(req.body.address,300),company=clean(req.body.company,150);if(!name||/[\r\n]/.test(name))fail('Enter your sender name on one line.');run('UPDATE users SET name=?,company=?,address=?,logo=?,avatar=? WHERE id=?',name,company,address,logo,avatar,req.user.id);res.json({ok:true});});
app.delete('/api/mailbox',auth,(req,res)=>{transaction(()=>{run('DELETE FROM mailboxes WHERE user_id=?',req.user.id);run("UPDATE sends SET status='cancelled',error='Mailbox disconnected.' WHERE user_id=? AND status='queued'",req.user.id);});res.json({ok:true});});
app.post('/api/domains',auth,(req,res)=>{
 const rows=req.body.domains;if(!Array.isArray(rows)||!rows.length||rows.length>500)fail('Add 1–500 domains at a time.');
 if(get('SELECT count(*) n FROM domains WHERE user_id=?',req.user.id).n+rows.length>5000)fail('Your portfolio is limited to 5,000 domains.');
 const values=rows.map(r=>{const p=Math.round(Number(r.price)*100);if(!Number.isSafeInteger(p)||p<100||p>100000000000)fail('Enter a valid asking price of at least $1.');return {name:domain(r.name),price:p,keywords:clean(r.keywords,100)};});
 transaction(()=>{for(const r of values)run('INSERT INTO domains VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,name) DO UPDATE SET price=excluded.price,keywords=excluded.keywords',id(),req.user.id,r.name,r.price,'USD',r.keywords,now());});res.status(201).json({count:values.length});
});
app.post('/api/research',auth,expensive,async(req,res)=>{
 const d=get('SELECT * FROM domains WHERE id=? AND user_id=?',clean(req.body.domainId),req.user.id);if(!d)fail('Choose a domain from your portfolio.');if(usage(req.user).plan==='expired')fail('Upgrade to continue buyer research.',402);
 const candidates=await research(req.body.keyword,req.body.source,d.name);let count=0;
 transaction(()=>{for(const p of candidates){const result=run('INSERT OR IGNORE INTO prospects VALUES (?,?,?,?,?,?,?,?,?,?,?)',id(),req.user.id,d.id,p.company,p.website,'',p.source,p.source_url,p.reason,0,now());count+=result.changes;}});res.json({count,message:'Candidate websites found. Confirm relevance and add a sourced contact before drafting.'});
});
function safeURL(value){try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)fail('Use a public contact-source URL.');return u.href.slice(0,1000);}catch{fail('Enter the public page where the contact was found.');}}
app.post('/api/prospects',auth,(req,res)=>{
 const b=req.body,d=get('SELECT id FROM domains WHERE id=? AND user_id=?',clean(b.domainId),req.user.id);if(!d)fail('Choose one of your domains.');
 const company=clean(b.company,150);if(!company)fail('Enter the business name.');const em=b.email?email(b.email):'';const sourceURL=b.sourceUrl?safeURL(b.sourceUrl):'';if(em&&!sourceURL)fail('Add the source URL for this contact.');
 run('INSERT INTO prospects VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,domain_id,website) DO UPDATE SET company=excluded.company,email=excluded.email,source_url=excluded.source_url,reason=excluded.reason,reviewed=excluded.reviewed',id(),req.user.id,d.id,company,domain(b.website),em,'manual',sourceURL,clean(b.reason,500),b.reviewed&&em&&sourceURL?1:0,now());res.status(201).json({ok:true});
});
app.patch('/api/prospects/:id',auth,(req,res)=>{const p=get('SELECT * FROM prospects WHERE id=? AND user_id=?',req.params.id,req.user.id);if(!p)fail('Buyer not found.',404);const em=email(req.body.email),sourceURL=safeURL(req.body.sourceUrl);run('UPDATE prospects SET email=?,source_url=?,reviewed=?,company=?,reason=? WHERE id=? AND user_id=?',em,sourceURL,req.body.reviewed?1:0,clean(req.body.company||p.company,150),clean(req.body.reason||p.reason,500),p.id,req.user.id);res.json({ok:true});});
app.get('/api/prospects/:id/contacts',auth,expensive,async(req,res)=>{const p=get('SELECT * FROM prospects WHERE id=? AND user_id=?',req.params.id,req.user.id);if(!p)fail('Buyer not found.',404);res.json({contacts:await contactSearch(p.website)});});
app.post('/api/drafts',auth,(req,res)=>{const ids=req.body.prospectIds;if(!Array.isArray(ids)||!ids.length||ids.length>50)fail('Select up to 50 buyers.');transaction(()=>{for(const pid of ids){const p=get('SELECT * FROM prospects WHERE id=? AND user_id=?',pid,req.user.id);if(!p||!p.reviewed||!p.email)fail('Review and save each buyer contact before drafting.');const d=get('SELECT * FROM domains WHERE id=? AND user_id=?',p.domain_id,req.user.id);const draft=generateDraft(req.user,d,p);run('INSERT INTO drafts VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,prospect_id) DO NOTHING',id(),req.user.id,d.id,p.id,draft.subject,draft.body,now());}});res.json({ok:true});});
app.patch('/api/drafts/:id',auth,(req,res)=>{const subject=clean(req.body.subject,180),body=clean(req.body.body,8000);if(!subject||/[\r\n]/.test(subject)||!body)fail('Enter a subject and message.');const r=run('UPDATE drafts SET subject=?,body=?,updated_at=? WHERE id=? AND user_id=?',subject,body,now(),req.params.id,req.user.id);if(!r.changes)fail('Draft not found.',404);res.json({ok:true});});
app.post('/api/campaigns',auth,(req,res)=>{if(req.body.confirmed!==true)fail('Review and confirm the campaign before sending.');const key=clean(req.body.campaignKey,100);if(!/^[a-f0-9-]{36}$/.test(key))fail('Invalid campaign key.');const jobs=reserveCampaign(req.user.id,req.body.draftIds,key,req.body.reviewed);res.status(202).json({jobs,usage:usage(req.user)});});
app.post('/api/campaigns/cancel',auth,(req,res)=>{const r=run("UPDATE sends SET status='cancelled',error='Cancelled by sender.' WHERE user_id=? AND status='queued'",req.user.id);res.json({cancelled:r.changes});});
app.post('/api/billing/checkout',auth,async(req,res)=>{
 if(!stripe||!process.env.STRIPE_PRICE_ID||!process.env.STRIPE_WEBHOOK_SECRET||!await priceInfo())fail('Subscriptions are not available yet. Please contact DotCloser.',503);
 if(req.user.subscription_id){const sub=await stripe.subscriptions.retrieve(req.user.subscription_id);if(['active','trialing','past_due','unpaid','paused','incomplete'].includes(sub.status))fail('Manage your existing subscription in the billing portal.',409);}
 let customer=req.user.stripe_customer;if(!customer){const c=await stripe.customers.create({email:req.user.email,name:req.user.name,metadata:{userId:req.user.id}},{idempotencyKey:'customer-'+req.user.id});customer=c.id;run('UPDATE users SET stripe_customer=? WHERE id=?',customer,req.user.id);}
 const prior=get('SELECT session_id FROM checkout_sessions WHERE user_id=?',req.user.id);
 if(prior){const open=await stripe.checkout.sessions.retrieve(prior.session_id);if(open.status==='open')return res.json({url:open.url});if(open.status==='complete'&&open.subscription){await syncSubscription(open.subscription);const existing=await stripe.subscriptions.retrieve(open.subscription);if(!['canceled','incomplete_expired'].includes(existing.status))fail('Your subscription is processing or already active. Refresh or open billing management.',409);}}
 const session=await stripe.checkout.sessions.create({mode:'subscription',customer,client_reference_id:req.user.id,line_items:[{price:process.env.STRIPE_PRICE_ID,quantity:1}],subscription_data:{metadata:{userId:req.user.id}},success_url:config.origin+'/?billing=success#billing',cancel_url:config.origin+'/#billing',allow_promotion_codes:true},{idempotencyKey:'checkout-'+req.user.id+'-'+(prior?.session_id||'initial')});
 run('INSERT INTO checkout_sessions VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET session_id=excluded.session_id',req.user.id,session.id);res.json({url:session.url});
});
app.post('/api/billing/portal',auth,async(req,res)=>{if(!stripe||!req.user.stripe_customer)fail('No billing account is connected yet.');res.json({url:(await stripe.billingPortal.sessions.create({customer:req.user.stripe_customer,return_url:config.origin+'/#billing'})).url});});
app.get('/unsubscribe/:token',(req,res)=>{try{decodeUnsubscribe(req.params.token);res.type('html').send('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe · DotCloser</title><link rel="stylesheet" href="/styles.css"><body class="standalone"><main class="legal-card"><h1>No more domain offers?</h1><p>Unsubscribe from this seller’s future DotCloser emails.</p><form method="post"><button class="btn primary">Unsubscribe</button></form></main></body></html>');}catch{res.status(400).send('Invalid unsubscribe link.');}});
app.post('/unsubscribe/:token',(req,res)=>{try{const [uid,em]=decodeUnsubscribe(req.params.token);transaction(()=>{run('INSERT OR IGNORE INTO suppressions VALUES (?,?,?)',uid,em,now());run("UPDATE sends SET status='cancelled',error='Recipient unsubscribed.' WHERE user_id=? AND recipient=? AND status='queued'",uid,em);});res.type('html').send('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed · DotCloser</title><link rel="stylesheet" href="/styles.css"><body class="standalone"><main class="legal-card"><h1>You’re unsubscribed.</h1><p>This seller will no longer send you domain offers through DotCloser.</p></main></body></html>');}catch{res.status(400).send('Invalid unsubscribe link.');}});
app.use(express.static(resolve(root,'public'),{maxAge:config.production?'1h':0,etag:true}));
app.get('/{*path}',(req,res)=>{if(req.path.startsWith('/api/'))return res.status(404).json({error:'Endpoint not found.'});res.sendFile(resolve(root,'public/index.html'));});
app.use((error,req,res,next)=>{if(res.headersSent)return next(error);if(error.status>=400&&error.status<600)return res.status(error.status).json({error:error.message});if(error.code?.includes('CONSTRAINT'))return res.status(409).json({error:'This record already exists or is in use.'});console.error('Request failed:',error.name,error.code||'');res.status(500).json({error:'The request could not be completed. Please try again.'});});
let server;
export function startServer(){
 if(server)return server;
 server=app.listen(config.port,'0.0.0.0',(error)=>{
  if(error)throw error;
  console.log('DotCloser listening on '+(server?.address()?.port??config.port));
  startWorker();
 });
 return server;
}
