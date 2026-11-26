(() => {
 'use strict';
 window.showDialog=content=>{document.querySelector('#dialog-content').innerHTML=content;document.querySelector('#config-dialog').showModal();};
 let timer;
 window.showToast=message=>{const toast=document.querySelector('#toast');toast.textContent=message;toast.classList.add('visible');clearTimeout(timer);timer=setTimeout(()=>toast.classList.remove('visible'),3500);};
 document.querySelector('#config-dialog').addEventListener('close',()=>document.querySelector('#dialog-content').replaceChildren());
 const routes={personal:'apioverview','personal/models':'apimodels','personal/keys':'apikeys','personal/usage':'apiusage','personal/compare':'apicompare'};
 function route(){const view=location.hash.slice(1)||'personal';window.IdentityUI.route(view);parent.postMessage({type:'employee-api-position',page:view.startsWith('personal/connect/')?'apikeys':routes[view]},location.origin);}
 addEventListener('hashchange',route);
 document.addEventListener('click',event=>{const a=event.target.closest('a[href]');if(!a)return;const url=new URL(a.href,location.href);if(url.origin===location.origin&&!url.hash.startsWith('#personal')){event.preventDefault();window.open('/'+url.hash,'_blank','noopener');}});
 route();
})();
