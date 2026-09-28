import { createHash, createHmac } from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import Stripe from 'stripe';
import { config } from './config.mjs';
import { get, run } from './db.mjs';
import { fail, now, seal, unseal, email, unsubscribeToken } from './core.mjs';
import { imageAttachment, emailHTML } from './branding.mjs';
const env=process.env;
export const stripe=env.STRIPE_SECRET_KEY?new Stripe(env.STRIPE_SECRET_KEY):null;
const meta=env.FACEBOOK_API_VERSION||'v25.0';
const tenant=/^[a-zA-Z0-9-]+$/.test(env.MICROSOFT_TENANT||'common')?(env.MICROSOFT_TENANT||'common'):'common';
export const providers={
 google:{client:env.GOOGLE_CLIENT_ID,secret:env.GOOGLE_CLIENT_SECRET,auth:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',profile:'https://openidconnect.googleapis.com/v1/userinfo',scope:'openid email profile'},
 facebook:{client:env.FACEBOOK_CLIENT_ID,secret:env.FACEBOOK_CLIENT_SECRET,auth:'https://www.facebook.com/'+meta+'/dialog/oauth',token:'https://graph.facebook.com/'+meta+'/oauth/access_token',profile:'https://graph.facebook.com/'+meta+'/me?fields=id,name,email',scope:'public_profile,email'},
 microsoft:{client:env.MICROSOFT_CLIENT_ID,secret:env.MICROSOFT_CLIENT_SECRET,auth:'https://login.microsoftonline.com/'+tenant+'/oauth2/v2.0/authorize',token:'https://login.microsoftonline.com/'+tenant+'/oauth2/v2.0/token',profile:'https://graph.microsoft.com/v1.0/me',scope:'openid profile email offline_access User.Read Mail.Send'}
};
export function ready(provider) { return !!(providers[provider]?.client&&providers[provider]?.secret); }
export const callback=p=>config.origin+'/auth/'+p+'/callback';
export function authorizeURL(provider,purpose,state,verifier) {
 const p=providers[provider];if(!ready(provider))fail('This connection is not enabled yet.',503);
 const u=new URL(p.auth);const q={client_id:p.client,redirect_uri:callback(provider),response_type:'code',scope:p.scope,state};
 if(provider!=='facebook')Object.assign(q,{code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
 if(provider==='google'&&purpose==='mail')Object.assign(q,{scope:p.scope+' https://www.googleapis.com/auth/gmail.send',access_type:'offline',prompt:'consent select_account'});
 if(provider==='microsoft')q.prompt='select_account';
 Object.entries(q).forEach(([k,v])=>u.searchParams.set(k,v));return u.toString();
}
export async function fetchJSON(url, options={}) {const r=await fetch(url,{...options,signal:AbortSignal.timeout(15000),redirect:'error'}); if(!r.ok){const e=new Error('The provider could not complete this request ('+r.status+').');e.status=502;e.providerStatus=r.status;throw e;}return r.json();}
export async function exchange(provider,code,verifier) {
 const p=providers[provider];const body=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:callback(provider),client_id:p.client,client_secret:p.secret});if(provider!=='facebook')body.set('code_verifier',verifier);
 const token=await fetchJSON(p.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
 const url=new URL(p.profile);if(provider==='facebook')url.searchParams.set('appsecret_proof',createHmac('sha256',p.secret).update(token.access_token).digest('hex'));
 const profile=await fetchJSON(url,{headers:{Authorization:'Bearer '+token.access_token}});
 if(provider==='google'&&!profile.email_verified)fail('Use a verified Google email address.');
 const address=email(profile.email||profile.mail||profile.userPrincipalName);
 return {token:{...token,expires_at:Date.now()+(Number(token.expires_in)||3600)*1000},profile:{subject:profile.sub||profile.id,name:profile.name||profile.displayName||address,email:address}};
}
export async function mailboxToken(mailbox) {
 const token=unseal(mailbox.encrypted);if(token.expires_at>Date.now()+60000)return token.access_token;
 if(!token.refresh_token)fail('Reconnect your email account to continue sending.',409);
 const p=providers[mailbox.provider];
 const refreshed=await fetchJSON(p.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:p.client,client_secret:p.secret,grant_type:'refresh_token',refresh_token:token.refresh_token})});
 const next={...token,...refreshed,refresh_token:refreshed.refresh_token||token.refresh_token,expires_at:Date.now()+(Number(refreshed.expires_in)||3600)*1000};
 run('UPDATE mailboxes SET encrypted=?,updated_at=? WHERE user_id=?',seal(next),now(),mailbox.user_id);return next.access_token;
}
export async function sendEmail(mailbox,user,job) {
 const access=await mailboxToken(mailbox);
 const unsubscribe=config.origin+'/unsubscribe/'+unsubscribeToken(user.id,job.recipient);
 const body=job.body+'\n\n—\n'+user.name+(user.company?' · '+user.company:'')+'\n'+user.address+'\nNo more domain offers: '+unsubscribe;
 const attachments=[imageAttachment(user.logo,'logo'),imageAttachment(user.avatar,'avatar')].filter(Boolean);
 const html=emailHTML(job.body,user,unsubscribe);
 let endpoint,payload;
 if(mailbox.provider==='google'){
  const raw=await new MailComposer({from:{name:user.name,address:mailbox.email},to:job.recipient,subject:job.subject,text:body,html,attachments,messageId:job.id+'@'+new URL(config.origin).hostname,headers:{'List-Unsubscribe':'<'+unsubscribe+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}}).compile().build();
  endpoint='https://gmail.googleapis.com/gmail/v1/users/me/messages/send';payload={raw:raw.toString('base64url')};
 }else if(mailbox.provider==='microsoft'){
  endpoint='https://graph.microsoft.com/v1.0/me/sendMail';payload={message:{subject:job.subject,body:{contentType:'HTML',content:html},attachments:attachments.map(a=>({'@odata.type':'#microsoft.graph.fileAttachment',name:a.filename,contentType:a.contentType,contentBytes:a.content.toString('base64'),contentId:a.cid,isInline:true})),toRecipients:[{emailAddress:{address:job.recipient}}],internetMessageHeaders:[{name:'X-DotCloser-Message-ID',value:job.id}]},saveToSentItems:true};
 }else fail('Unsupported email connection.');
 let response;try{response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000),redirect:'error'});}catch{const e=new Error('Provider response was interrupted. Check Sent in your mailbox before taking further action.');e.unknown=true;throw e;}
 if(!response.ok){const e=new Error(response.status===429?'Your email provider is rate limiting sends.':response.status===401||response.status===403?'Reconnect your email account and check sending permissions.':'The email provider rejected this send.');e.unknown=response.status>=500;throw e;}
 if(response.status===202||response.status===204)return null;
 try{return (await response.json()).id||null;}catch{return null;}
}
export async function syncSubscription(subscriptionId) {
 const s=await stripe.subscriptions.retrieve(subscriptionId);
 const userId=s.metadata.userId;const u=get('SELECT * FROM users WHERE id=?',userId||'');if(!u||u.stripe_customer!==s.customer)return;
 // Reconcile current active subscriptions so stale events cannot revoke a replacement plan.
 const subscriptions=await stripe.subscriptions.list({customer:u.stripe_customer,status:'active',limit:100});
 const active=subscriptions.data.filter(x=>x.metadata.userId===u.id&&x.items.data.some(i=>i.price.id===env.STRIPE_PRICE_ID)).sort((a,b)=>b.created-a.created)[0];
 const chosen=active||s;
 if(!active&&u.subscription_id&&u.subscription_id!==s.id){const current=await stripe.subscriptions.retrieve(u.subscription_id);if(current.status==='active')return;}
 const period=chosen.items.data.reduce((n,i)=>Math.max(n,i.current_period_end||0),0)||chosen.current_period_end||0;
 run('UPDATE users SET subscription_id=?,plan=?,paid_until=?,ever_paid=CASE WHEN ?=1 THEN 1 ELSE ever_paid END WHERE id=?',chosen.id,active?'standard':'expired',active?new Date(period*1000).toISOString():null,active?1:0,u.id);
}
