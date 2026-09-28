import { get, run, transaction } from './db.mjs';
import { now, usage } from './core.mjs';
import { config } from './config.mjs';
import { sendEmail } from './integrations.mjs';
let working=false;
export async function processQueue(sender=sendEmail) {
 if(working)return;working=true;
 try{
  const job=transaction(()=>{
   const j=get("SELECT * FROM sends WHERE status='queued' ORDER BY reserved_at LIMIT 1");if(!j)return;
   const u=get('SELECT * FROM users WHERE id=?',j.user_id);const m=get('SELECT * FROM mailboxes WHERE user_id=?',j.user_id);
   if(!m||m.email!==j.mailbox_email||usage(u).plan==='expired'||get('SELECT email FROM suppressions WHERE user_id=? AND email=?',j.user_id,j.recipient)){run("UPDATE sends SET status='cancelled',error=? WHERE id=?",'Sending paused: connection, subscription or recipient eligibility changed.',j.id);return;}
   // Queued reservations remain counted across midnight; accepted sends count on the actual send day.
   const sentToday=get("SELECT count(*) n FROM sends WHERE user_id=? AND status IN ('sent','sending','unknown') AND substr(coalesce(sent_at,reserved_at),1,10)=?",j.user_id,now().slice(0,10)).n;
   if(usage(u).plan==='standard'&&sentToday>=config.dailyLimit)return;
   const claimed=run("UPDATE sends SET status='sending',reserved_at=? WHERE id=? AND status='queued'",now(),j.id);return claimed.changes?{...j,user:{...u,name:j.sender_name,company:j.sender_company,address:j.sender_address},mailbox:m}:null;
  });
  if(!job)return;
  try{const providerId=await sender(job.mailbox,job.user,job);run("UPDATE sends SET status='sent',sent_at=?,provider_id=? WHERE id=?",now(),providerId,job.id);}
  catch(e){run('UPDATE sends SET status=?,error=? WHERE id=?',e.unknown?'unknown':'failed',String(e.message).slice(0,300),job.id);}
 }finally{working=false;}
}
export function startWorker(){
 // Crash recovery never blindly retries a send that may already have reached the provider.
 run("UPDATE sends SET status='unknown',error='Interrupted send. Check your mailbox Sent folder.' WHERE status='sending'");
 const timer=setInterval(()=>processQueue().catch(()=>console.error('Queue processing failed.')),config.interval*1000);timer.unref();return timer;
}
