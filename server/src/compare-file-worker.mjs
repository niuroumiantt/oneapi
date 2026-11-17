import {parentPort,workerData} from 'node:worker_threads';
try{
 const buffer=Buffer.from(workerData.data,'base64');let text='',pages=null;
 if(workerData.extension==='pdf'){
  const {getDocumentProxy}=await import('unpdf');
  const pdf=await getDocumentProxy(new Uint8Array(buffer),{isEvalSupported:false,useWorkerFetch:false,maxImageSize:1_000_000,disableFontFace:true});
  try{pages=pdf.numPages;if(pages>100)throw Error('PDF 超过 100 页，请拆分后再上传');for(let i=1;i<=pages;i++){const page=await pdf.getPage(i),content=await page.getTextContent();text+=content.items.map(v=>v.str+(v.hasEOL?'\n':' ')).join('')+'\n';if(text.length>120000)throw Error('提取文字超过 12 万字符，请拆分文件');}}finally{await pdf.destroy?.();}
 }else{
  const {docxText}=await import('./compare-docx.mjs');text=docxText(buffer);
 }
 if(!text.trim())throw Error('未提取到文字。扫描 PDF 或纯图片文档需先转为文字，或上传模型可识别的图片');
 if(text.length>120000)throw Error('提取文字超过 12 万字符，请拆分文件');
 parentPort.postMessage({text,pages});
}catch(e){parentPort.postMessage({error:String(e.message).slice(0,200)});}
