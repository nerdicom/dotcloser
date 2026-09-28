import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { config } from './config.mjs';
import { all, get, run, transaction } from './db.mjs';
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const hash = value => createHash('sha256').update(value).digest('hex');
export const random = () => randomBytes(32).toString('base64url');
export function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
export const clean = (value, max = 200) => String(value || '').trim().slice(0, max);
export function email(value) { const v = clean(value, 254).toLowerCase(); if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v) || /[\r\n]/.test(v)) fail('Enter a valid email address.'); return v; }
export function domain(value) { const v = domainToASCII(clean(value).toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')); if (v.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v) || /\.(local|localhost|internal|test|invalid)$/.test(v)) fail('Enter a public domain name, without a path.'); return v; }
export function seal(value) { if (!/^[a-f0-9]{64}$/i.test(config.encryptionKey)) fail('Mailbox connections need the server encryption key configured.',503); const iv=randomBytes(12); const c=createCipheriv('aes-256-gcm',Buffer.from(config.encryptionKey,'hex'),iv); const encrypted=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]); return [iv,c.getAuthTag(),encrypted].map(b=>b.toString('base64url')).join('.'); }
export function unseal(value) { const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64url')); const c=createDecipheriv('aes-256-gcm',Buffer.from(config.encryptionKey,'hex'),iv); c.setAuthTag(tag); return JSON.parse(Buffer.concat([c.update(data),c.final()]).toString()); }
export function unsubscribeToken(userId, recipient) { const p=Buffer.from(JSON.stringify([userId,recipient])).toString('base64url'); return p+'.'+createHmac('sha256',config.sessionSecret).update(p).digest('base64url'); }
export function decodeUnsubscribe(token) { const [p,s]=String(token||'').split('.'); const expected=createHmac('sha256',config.sessionSecret).update(p||'').digest('base64url'); if (!s || s.length!==expected.length || !timingSafeEqual(Buffer.from(s),Buffer.from(expected))) fail('Invalid unsubscribe link.'); const data=JSON.parse(Buffer.from(p,'base64url').toString()); return [data[0],email(data[1])]; }
export function usage(user, at=new Date()) {
  const today=at.toISOString().slice(0,10);
  const active=user.plan==='standard' && user.paid_until && new Date(user.paid_until)>at;
  const trial=!user.ever_paid && new Date(user.trial_end)>at;
  const used=get("SELECT count(*) n FROM sends WHERE user_id=? AND (status IN ('queued','sending') OR (status IN ('sent','unknown') AND (?=0 OR substr(coalesce(sent_at,reserved_at),1,10)=?)))",user.id,active?1:0,today).n;
  const limit=active?config.dailyLimit:trial?config.trialLimit:0;
  return { plan:active?'standard':trial?'trial':'expired', used, limit, remaining:Math.max(0,limit-used), trialEnd:user.trial_end, resetAt:active?new Date(Date.UTC(at.getUTCFullYear(),at.getUTCMonth(),at.getUTCDate()+1)).toISOString():user.trial_end, daysLeft:Math.max(0,Math.ceil((new Date(user.trial_end)-at)/86400000)) };
}
export function reserveCampaign(userId, draftIds, campaignKey, reviewed) {
  if (!Array.isArray(draftIds) || !draftIds.length || draftIds.length>50 || new Set(draftIds).size!==draftIds.length) fail('Select between 1 and 50 unique drafts.');
  return transaction(()=>{
    const existing=all('SELECT id,status FROM sends WHERE user_id=? AND campaign_key=?',userId,campaignKey); if(existing.length) return existing;
    const user=get('SELECT * FROM users WHERE id=?',userId);
    if(!user.address || !user.name) fail('Complete your sender name and business mailing address in Settings before sending.');
    const mailbox=get('SELECT * FROM mailboxes WHERE user_id=?',userId);
    if(!mailbox) fail('Connect your email account before sending.');
    if(!reviewed||!Array.isArray(reviewed.drafts)||reviewed.drafts.length!==draftIds.length||reviewed.mailboxEmail!==mailbox.email||reviewed.userName!==user.name||reviewed.company!==user.company||reviewed.address!==user.address) fail('Your sender details changed. Refresh and review this campaign again.',409);
    const available=usage(user); if(draftIds.length>available.remaining) fail('This campaign exceeds your remaining send allowance.',409);
    const jobs=draftIds.map(draftId=>{
      const d=get('SELECT d.*,p.email,p.reviewed FROM drafts d JOIN prospects p ON p.id=d.prospect_id WHERE d.id=? AND d.user_id=? AND p.user_id=?',draftId,userId,userId);
      if(!d||!d.reviewed||!d.email) fail('Every selected draft needs a reviewed buyer contact.');
      const snapshot=reviewed.drafts.find(x=>x.id===draftId);
      if(!snapshot||snapshot.recipient!==d.email||snapshot.subject!==d.subject||snapshot.body!==d.body) fail('A draft or recipient changed after review. Refresh and review the campaign again.',409);
      if(get('SELECT email FROM suppressions WHERE user_id=? AND email=?',userId,d.email)) fail('A selected buyer has unsubscribed.');
      if(get("SELECT id FROM sends WHERE user_id=? AND domain_id=? AND recipient=? AND status IN ('queued','sending','sent','unknown')",userId,d.domain_id,d.email)) fail('This domain has already been queued or sent to one of these buyers.');
      const job={id:id(),...d}; job.id=id(); return job;
    });
    for(const j of jobs) run("INSERT INTO sends (id,user_id,domain_id,prospect_id,recipient,subject,body,status,reserved_at,campaign_key,sender_name,sender_company,sender_address,mailbox_email) VALUES (?,?,?,?,?,?,?,'queued',?,?,?,?,?,?)",j.id,userId,j.domain_id,j.prospect_id,j.email,j.subject,j.body,now(),campaignKey,user.name,user.company,user.address,mailbox.email);
    return jobs.map(j=>({id:j.id,status:'queued'}));
  });
}
export function generateDraft(user,d,p) {
  const price=new Intl.NumberFormat('en-US',{style:'currency',currency:d.currency,maximumFractionDigits:0}).format(d.price/100);
  return {subject:d.name+' is available for '+p.company,body:'Hello '+p.company+' team,\n\nI own '+d.name+' and am offering it for sale at '+price+'.'+(p.reason?'\n\n'+p.reason:'')+'\n\nIf the name could be useful for your business, I would be happy to discuss the asking price and a secure domain transfer. You can reply directly to this email.\n\nThank you,\n'+user.name+(user.company?'\n'+user.company:'')};
}
