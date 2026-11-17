const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = {window:{}};
vm.createContext(context);
for(const file of ['catalog.js','catalog-extra.js','source-refs.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context);
const rows=context.window.SKILL_CATALOG, refs=context.window.SKILL_SOURCES;
const audit=JSON.parse(fs.readFileSync(path.join(__dirname,'source-audit.json'),'utf8'));
assert.equal(rows.length,40);
assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
assert.equal(rows.filter(r=>r.category==='个人娱乐').length,5);
for(const r of rows){
 const ref=refs.find(s=>s.repo===r.repo&&s.path.endsWith('/'+(r.folder||r.slug)+'/SKILL.md'));
 assert.ok(ref,r.id+' has immutable source');
 assert.match(ref.sha,/^[a-f0-9]{40}$/);
 const evidence=audit.find(e=>e.repo===ref.repo&&e.path===ref.path);
 assert.equal(evidence.commit,ref.sha);
 assert.match(evidence.sourceExcerpt,new RegExp('name: '+r.slug+'(?:\\n|\\r)'));
 assert.ok(evidence.licenseEvidence);
 if(ref.license){assert.equal(evidence.license,ref.license);assert.equal(evidence.licensePath,ref.licensePath);assert.ok(['MIT','Apache-2.0'].includes(ref.license));}
 for(const field of ['summary','input','output','audience','dependencies','limitations','prompt','result','recommended']) assert.ok(r[field]?.length>10,r.id+' '+field);
 assert.ok(r.features.length>=3);
 assert.ok(r.scene>=0&&r.scene<=5);
 assert.ok(evidence.taskTest === 'Not run' || evidence.executionEvidence, r.id+' execution evidence required');
}
const marketSources=JSON.parse(fs.readFileSync(path.join(__dirname,'market-sources.json'),'utf8'));
assert.deepEqual(marketSources,JSON.parse(JSON.stringify(rows.map(({id,repo,slug})=>({id,repo,slug})))));
console.log('PASS: 40 unique Skills, 5 entertainment entries, source commits, actual upstream names, license evidence and editorial fields.');
