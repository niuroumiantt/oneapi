/* Short-lived, account-scoped reads for navigation only. Mutations use fresh API reads. */
(() => {
 'use strict';
 function create({read,owner,now=Date.now,ttl=15000}){
  const entries=new Map();
  let revision=0;
  function clear(){revision++;entries.clear();}
  function fresh(path){const entry=entries.get(path);return Boolean(entry&&entry.owner===owner()&&entry.value!==undefined&&now()-entry.at<ttl);}
  function get(path,prefetched){
   const identity=owner(),old=entries.get(path);
   if(old?.owner===identity){if(old.pending)return old.pending;if(fresh(path))return Promise.resolve(old.value);}
   const entry={owner:identity,revision,pending:null};entries.set(path,entry);
   entry.pending=Promise.resolve().then(()=>prefetched||read(path)).then(value=>{
    if(entry.revision===revision&&entry.owner===owner()&&entries.get(path)===entry){entry.value=value;entry.at=now();entry.pending=null;}
    return value;
   },error=>{if(entries.get(path)===entry)entries.delete(path);throw error;});
   return entry.pending;
  }
  return {get,fresh,clear};
 }
 window.NavigationData={create};
})();
