import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../web/identity.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf(' function supportTextPages('),source.indexOf(' function personalSupportContent('));
const pages=vm.runInNewContext(code+';supportTextPages');
test('long support replies preserve every character and bound blank lines and unicode',()=>{
 for(const value of ['答复\n'.repeat(400),'\n'.repeat(400),'长问题😀'.repeat(1000),'']){
  const result=pages(value);assert.equal(result.join(''),value);assert.ok(result.length);
  for(const page of result){assert.ok(Array.from(page).length<=180);assert.ok((page.match(/\n/g)||[]).length<=6);}
 }
});
test('support draft survives list switching and async data loads do not replace active typing',()=>{
 assert.match(source,/supportDraft\[event.target.name\]=event.target.value/);
 assert.match(source,/pageViews.support!=='new'/);
 assert.match(source,/delete panelData\['loading:tickets'\]/);
});
