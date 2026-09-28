import { readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath,['--check','app.js'],{stdio:'inherit'});
for(const folder of ['server','public','scripts'])for(const file of readdirSync(folder)){if(/\.(mjs|js)$/.test(file))execFileSync(process.execPath,['--check',folder+'/'+file],{stdio:'inherit'});}
for(const path of ['public/index.html','public/styles.css','public/logo-mark.png','public/favicon.svg'])if(!existsSync(path)||!statSync(path).size)throw Error('Missing asset: '+path);
console.log('DotCloser source and assets validated. Start with npm start. This is a Node application, not a static export.');
