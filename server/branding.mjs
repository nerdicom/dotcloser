import { fail } from './core.mjs';

export function imageData(value, label) {
 if (!value) return '';
 if (typeof value !== 'string') fail('Choose a PNG or JPEG '+label+'.');
 const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if (!match) fail('Choose a PNG or JPEG '+label+'.');
 const bytes=Buffer.from(match[2],'base64');
 if (!bytes.length || bytes.length>100000 || bytes.toString('base64')!==match[2]) fail('Keep each image under 100 KB.');
 const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if (!(match[1]==='png'?png:jpeg)) fail('The image file does not match its type.');
 return value;
}
export function imageAttachment(data, label) {
 if (!data) return null;
 const match=/^data:image\/(png|jpeg);base64,(.*)$/.exec(data);
 return {filename:label+'.'+(match[1]==='jpeg'?'jpg':'png'),content:Buffer.from(match[2],'base64'),contentType:'image/'+match[1],cid:label+'@dotcloser'};
}
export function emailHTML(body,user,unsubscribe) {
 const escape=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const logo=user.logo?'<img src="cid:logo@dotcloser" alt="'+escape(user.company||'Seller logo')+'" style="max-width:180px;max-height:64px;object-fit:contain;display:block;margin-bottom:14px">':'';
 const avatar=user.avatar?'<img src="cid:avatar@dotcloser" alt="Seller avatar" width="48" height="48" style="width:48px;height:48px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:12px">':'';
 return '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#20283d;max-width:640px">'+escape(body).replace(/\n/g,'<br>')+'<div style="border-top:1px solid #e2e6ef;margin-top:24px;padding-top:20px">'+logo+avatar+'<span style="display:inline-block;vertical-align:middle"><strong>'+escape(user.name)+'</strong>'+(user.company?'<br>'+escape(user.company):'')+'</span></div><p style="font-size:12px;color:#687186;margin-top:20px">'+escape(user.address).replace(/\n/g,'<br>')+'<br><a href="'+escape(unsubscribe)+'">Unsubscribe from domain offers</a></p></div>';
}
