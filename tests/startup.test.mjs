import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cwd=fileURLToPath(new URL('..',import.meta.url));
function environment(overrides={}){
 return {PATH:process.env.PATH,NODE_ENV:'production',PORT:'0',APP_URL:'https://dotcloser.com',DATABASE_PATH:':memory:',ENCRYPTION_KEY:randomBytes(32).toString('hex'),SESSION_SECRET:randomBytes(32).toString('hex'),...overrides};
}
for(const entry of ['app.js','server/app.mjs'])for(const symlink of [false,true]){
 test(`${entry} starts in production${symlink?' through a release symlink':''} and serves the workspace and API`,{timeout:15000},async()=>{
  const temporary=symlink?mkdtempSync(join(tmpdir(),'dotcloser-startup-')):null;
  if(temporary)symlinkSync(cwd,join(temporary,'current'),'dir');
  const launchPath=temporary?join(temporary,'current',entry):entry;
  const child=spawn(process.execPath,[launchPath],{cwd,env:environment()});
  let stderr='',stdout='';
  child.stderr.on('data',chunk=>stderr+=chunk);
  try{
   const port=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Startup timed out: '+stderr)),8000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Startup exited ${code}: ${stderr}`));});
    child.stdout.on('data',chunk=>{
     stdout+=chunk;const match=stdout.match(/DotCloser listening on (\d+)/);
     if(match){clearTimeout(timer);resolve(Number(match[1]));}
    });
   });
   const base=`http://127.0.0.1:${port}`;
   const home=await fetch(base,{signal:AbortSignal.timeout(3000)});
   assert.equal(home.status,200);
   assert.match(await home.text(),/Turn domains into deals/);
   const health=await fetch(base+'/api/health',{signal:AbortSignal.timeout(3000)});
   assert.equal(health.status,200);
   assert.deepEqual(await health.json(),{status:'ok',service:'dotcloser'});
   const session=await fetch(base+'/api/session',{signal:AbortSignal.timeout(3000)});
   assert.equal(session.status,200);
   assert.equal((await session.json()).config.trialLimit,10);
  }finally{
   if(child.exitCode===null&&child.signalCode===null){
    const exited=once(child,'exit');child.kill('SIGTERM');await exited;
   }
   if(temporary)rmSync(temporary,{recursive:true,force:true});
  }
 });
}

test('production rejects missing secrets with a useful startup error',{timeout:10000},async()=>{
 const child=spawn(process.execPath,['app.js'],{cwd,env:environment({ENCRYPTION_KEY:'',SESSION_SECRET:''})});
 let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
 const [code]=await once(child,'exit');
 assert.notEqual(code,0);
 assert.match(stderr,/Production requires HTTPS APP_URL and separate 32-byte ENCRYPTION_KEY and SESSION_SECRET/);
});
