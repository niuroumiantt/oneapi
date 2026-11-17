import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {pdfBytes}=createRequire(import.meta.url)('../../web/compare-pdf.js');
test('single-page PDF preserves binary image and valid byte offsets',()=>{
 const jpeg=Uint8Array.from([255,216,0,128,255,217]),bytes=pdfBytes(jpeg,1240,1754),s=Buffer.from(bytes).toString('latin1');
 assert.ok(s.startsWith('%PDF-1.4'));assert.match(s,/\/Count 1/);assert.equal((s.match(/\/Type \/Page /g)||[]).length,1);assert.match(s,/\/MediaBox \[0 0 595.28 841.89\]/);
 const start=Number(s.match(/startxref\n(\d+)/)[1]);assert.equal(s.slice(start,start+4),'xref');
 const offsets=s.slice(start).split('\n').slice(3,8);offsets.forEach((line,i)=>assert.ok(s.slice(Number(line.slice(0,10))).startsWith((i+1)+' 0 obj')));
 assert.ok(Buffer.from(bytes).includes(Buffer.from(jpeg)));assert.match(s,/\/Length 6 >>\nstream/);
});
