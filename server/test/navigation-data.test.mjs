import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const window={};
vm.runInNewContext(readFileSync(new URL('../../web/navigation-data.js',import.meta.url),'utf8'),{window});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
test('navigation shares pending reads, reuses fresh data, and expires without caching errors',async()=>{
 let now=0,calls=0;const pending=deferred();
 const cache=window.NavigationData.create({owner:()=>1,now:()=>now,read:()=>{calls++;return calls===1?pending.promise:calls===3?Promise.reject(Error('offline')):calls;}});
 const first=cache.get('/status'),second=cache.get('/status');assert.equal(first,second);
 await Promise.resolve();assert.equal(calls,1);pending.resolve(1);await first;
 assert.equal(await cache.get('/status'),1);assert.equal(calls,1);
 now=15000;assert.equal(cache.fresh('/status'),false);assert.equal(await cache.get('/status'),2);
 now=30000;await assert.rejects(cache.get('/status'),/offline/);assert.equal(await cache.get('/status'),4);
});
test('account changes and mutations cannot repopulate the cache with late responses',async()=>{
 let owner='a';const old=deferred(),newer=deferred();let calls=0;
 const cache=window.NavigationData.create({owner:()=>owner,read:()=>++calls===1?old.promise:newer.promise});
 const a=cache.get('/credit');await Promise.resolve();owner='b';const b=cache.get('/credit');await Promise.resolve();old.resolve('a');await a;assert.equal(cache.fresh('/credit'),false);
 cache.clear();newer.resolve('b');await b;assert.equal(cache.fresh('/credit'),false);
 assert.equal(await cache.get('/credit',Promise.resolve('fresh b')),'fresh b');assert.equal(calls,2);
});
test('only navigation reads use the cache; fresh key eligibility and writes bypass it',()=>{
 const source=readFileSync(new URL('../../web/identity.js',import.meta.url),'utf8');
 assert.match(source,/if\(mutation\)\{navigationData.clear\(\)/);
 assert.match(source,/const credit=await api\('\/api\/customer-credit\/status'\)/);
 assert.match(source,/if\(mutation\|\|r.status===401\)navigationData.clear\(\)/);
 assert.match(source,/if\(o.status==='paid'\)\{navigationData.clear\(\)/);
});
