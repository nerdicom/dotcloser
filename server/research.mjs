import { domain, clean, fail } from './core.mjs';
import { fetchJSON } from './integrations.mjs';
export async function research(keyword,source,exclude) {
 const q=clean(keyword,63).toLowerCase();if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(q))fail('Use one keyword of 2–63 letters, numbers or hyphens.');
 let rows,url;
 if(source==='regcount'){
  if(process.env.REGCOUNT_ENABLED!=='true')fail('RegCount research is not connected yet. You can add buyers manually.',503);
  url=new URL('/api/search',process.env.REGCOUNT_API_URL||'https://regcount.com');url.searchParams.set('q',q);url.searchParams.set('position','any');
  const data=await fetchJSON(url);
  if(data.source==='demo'||!Array.isArray(data.related)||!Array.isArray(data.suffixes)||!data.fetchedAt)fail('RegCount did not return a verified live-data response.',502);
  rows=[{name:data.exactName||data.query,suffixes:data.suffixes},...data.related];
 }else if(source==='dotdb'){
  if(process.env.DOTDB_ENABLED!=='true'||!process.env.DOTDB_API_KEY)fail('dotDB research needs a licensed API connection.',503);
  url=new URL('https://api.dotdb.com/v2/search');url.searchParams.set('keyword',q);url.searchParams.set('page','1');
  const data=await fetchJSON(url,{headers:{Authorization:'Token '+process.env.DOTDB_API_KEY}});if(!Array.isArray(data.matches))fail('dotDB returned an unexpected response.',502);rows=data.matches;
 }else fail('Choose RegCount or dotDB.');
 const found=new Map();
 for(const row of rows){if(typeof row.name!=='string'||!Array.isArray(row.suffixes))continue;for(const suffix of row.suffixes){try{const website=domain(row.name+'.'+String(suffix).replace(/^\./,''));if(website===exclude||found.has(website))continue;found.set(website,{company:row.name,website,email:'',source,source_url:source==='regcount'?'https://regcount.com':'https://dotdb.com',reason:'A related domain name was found for the keyword “'+q+'”. Review the business to confirm relevance.'});}catch{}}}
 return [...found.values()].slice(0,50);
}
export async function contactSearch(website) {
 if(!process.env.HUNTER_API_KEY)fail('Contact lookup is not connected yet. Add a published business email and its source URL manually.',503);
 const u=new URL('https://api.hunter.io/v2/domain-search');u.searchParams.set('domain',domain(website));u.searchParams.set('api_key',process.env.HUNTER_API_KEY);u.searchParams.set('limit','10');u.searchParams.set('type','generic');
 const data=await fetchJSON(u);
 return (data.data?.emails||[]).filter(e=>e.type==='generic'&&e.value&&e.sources?.some(s=>s.uri)).map(e=>({email:e.value,source_url:e.sources.find(s=>s.uri).uri,confidence:e.confidence,verification:e.verification?.status||'unknown'})).slice(0,5);
}
