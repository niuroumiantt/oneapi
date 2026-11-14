import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {csvRows,parseStatement,statementFiles,downloadStatement,checkBillDate,billDay} from '../src/alipay-bills.mjs';
const header='支付宝交易号,商户订单号,业务类型,订单金额（元）,服务费（元）,退款批次号/请求号,商品名称';
const csv=header+'\ntrade-1,order-1,交易,5.00,0.03,,"模型,调用"\n#合计\n';
function zip(b){let crc=0xffffffff;for(const v of b){crc^=v;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;const compressed=deflateRawSync(b),name=Buffer.from('trade.csv'),h=Buffer.alloc(30),c=Buffer.alloc(46),e=Buffer.alloc(22);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(8,8);h.writeUInt32LE(crc,14);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(b.length,22);h.writeUInt16LE(name.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(name.length,28);e.writeUInt32LE(0x06054b50);e.writeUInt16LE(1,8);e.writeUInt16LE(1,10);e.writeUInt32LE(c.length+name.length,12);e.writeUInt32LE(h.length+name.length+compressed.length,16);return Buffer.concat([h,name,compressed,c,name,e]);}
test('statement ZIP and CSV decode, exact amounts, footer and quoted values',()=>{
 const entries=parseStatement(statementFiles(zip(Buffer.from('\ufeff#账单说明\n'+csv))));
 assert.deepEqual(entries,[{trade:'trade-1',order:'order-1',kind:'交易',amount:500,fee:3,refund:''}]);
 assert.deepEqual(csvRows('"a,b","x""y"\n'),[['a,b','x"y']]);
 assert.throws(()=>parseStatement([Buffer.from(csv.replace('0.03','NaN'))]),/AMOUNT/);
 assert.throws(()=>parseStatement([Buffer.from(csv.replace('业务类型','未知列'))]),/HEADER/);
 assert.throws(()=>csvRows('"unterminated'),/CSV/);
 const bad=zip(Buffer.from(csv));bad[bad.length-22-46-9+16]^=1;assert.throws(()=>statementFiles(bad),/ZIP/);
 assert.throws(()=>statementFiles(Buffer.alloc(10)),/ZIP/);
});
test('statement download refuses unsafe hosts, protocol, redirects and oversized responses',async()=>{
 for(const url of ['http://download.alipay.com/a','https://alipay.com.evil.test/a','https://127.0.0.1/a','https://u:p@alipay.com/a','https://alipay.com:444/a'])await assert.rejects(downloadStatement(url),/HOST/);
 let seen=false;const result=await downloadStatement('https://download.alipay.com/bill',async(u,opts)=>{seen=true;assert.equal(opts.redirect,'error');return new Response('abc');});assert.ok(seen);assert.equal(result.toString(),'abc');
 await assert.rejects(downloadStatement('https://download.alipay.com/bill',async()=>new Response('x',{headers:{'content-length':String(17*1024*1024)}})),/LARGE/);
});
test('statement dates use Beijing days and prohibit current/future/invalid dates',()=>{
 const now=new Date('2026-01-03T16:01:00Z');assert.equal(billDay(now),'2026-01-04');assert.equal(checkBillDate('2026-01-03',now),'2026-01-03');
 for(const d of ['2026-01-04','2026-02-30','2026-13-01','bad'])assert.throws(()=>checkBillDate(d,now));
});
