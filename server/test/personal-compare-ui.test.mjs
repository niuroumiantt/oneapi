import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pager from '../../web/personal-compare.js';

test('personal answer pagination preserves long Unicode, newlines and unbroken output',()=>{
 for(const value of ['第一行\n\n第二行\n','模型回答😀。'.repeat(900),'x'.repeat(5000),'\n'.repeat(100)]){
  const pages=pager.pages(value,18,5);assert.equal(pages.join(''),value);
  for(const page of pages){let rows=0,col=0;for(const ch of Array.from(page)){if(ch==='\n'||col>=18){rows++;col=0;}if(ch!=='\n')col++;}assert.ok(rows<=5);}
  assert.ok(pages.length>=1);
 }
});
test('personal compare assets ship together and scoped mode retains enterprise renderer',()=>{
 const html=readFileSync(new URL('../../web/compare.html',import.meta.url),'utf8');
 const build=readFileSync(new URL('../../scripts/build_static.py',import.meta.url),'utf8');
 for(const asset of ['personal-compare.js','personal-compare.css']){assert.ok(html.includes(asset));assert.ok(build.includes(asset));}
 const source=readFileSync(new URL('../../web/identity.js',import.meta.url),'utf8');assert.ok(source.includes("${panelOrg?'':'&personal=1'}"));
});
test('balance bar uses server refund eligibility rather than treating all paid balance as refundable',()=>{
 const source=readFileSync(new URL('../../web/identity.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf(' function personalBalanceBar('),source.indexOf(' function personalRechargeCompact('));
 assert.match(fn,/const refund=split\?\.refundable_fen/);assert.match(fn,/refund==null\?'查看可退金额'/);
});

test('third party endpoint and manual model stay in the reference connection',()=>{
 const source=readFileSync(new URL('../../web/personal-compare.js',import.meta.url),'utf8');
 assert.ok(source.includes('sourceRow.append(sourceLabel,refSettings)'));
 assert.ok(source.includes("modelRow.append(modelLabel,$('manual-model-wrap'))"));
 assert.ok(!source.includes("showAdvanced('reference')"));
});
