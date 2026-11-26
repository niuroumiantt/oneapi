import test from 'node:test';
import assert from 'node:assert/strict';
import {statementSnapshot} from '../src/vip-statements.mjs';
import {renderVipStatementPDF,statementMoney} from '../src/vip-statement-pdf.mjs';
import {extractText} from 'unpdf';
const row=(kind,cash,commission,extra={})=>({kind,cash_fen:String(cash),commission_fen:String(commission),code:'ABCDEFGH',public_reference:'random-private-reference',occurred_at:'2026-10-31T15:59:59Z',email:'secret@example.test',phone:'13800138000',out_trade_no:'MERCHANTPRIVATE',...extra});
test('monthly commission uses consumption, not paid estimates or canceled future commission; snapshot is private',()=>{
 const rows=[row('paid',10000,1000),row('used',4000,400),row('refund',6000,-600),row('used',1000,200,{code:'BCDEFGHJ'})];
 const s=statementSnapshot({public_code:'ABCDEFGH',legal_name:'Secret Name'},'2026-10',1,rows,new Date('2026-10-31T16:00:00Z'));
 assert.deepEqual(s.totals,{paid_fen:'10000',used_fen:'5000',refunded_fen:'6000',commission_fen:'600'});assert.equal(s.codes.length,2);
 assert.equal(s.entries[0].reference,s.entries[1].reference);assert.match(s.entries[0].time,/10-31.*23:59/);
 const text=JSON.stringify(s);for(const privateValue of ['secret@example.test','13800138000','MERCHANTPRIVATE','random-private-reference','Secret Name'])assert.ok(!text.includes(privateValue));
 assert.notEqual(statementSnapshot({public_code:'ABCDEFGH'},'2026-11',1,[rows[0]]).entries[0].reference,s.entries[0].reference);
 assert.equal(statementMoney('9007199254740993'),'90071992547409.93');
});
test('PDF embeds Chinese text, includes all records across pages and has no customer identity',async()=>{
 const rows=Array.from({length:70},(_,i)=>row('used',100,10,{public_reference:'ref'+i}));
 const snapshot=statementSnapshot({public_code:'ABCDEFGH'},'2026-10',1,rows);
 const pdf=await renderVipStatementPDF(snapshot);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
 const extracted=await extractText(new Uint8Array(pdf),{mergePages:true});assert.ok(extracted.totalPages>1);assert.match(extracted.text,/VIP 月账单/);assert.match(extracted.text,/7.00/);
 for(const e of snapshot.entries)assert.ok(extracted.text.includes(e.reference));assert.ok(!extracted.text.includes('secret@example.test'));
});
