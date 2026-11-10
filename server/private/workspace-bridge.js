(()=>{'use strict';
const technical=location.pathname.includes('/lab/'),workspace=technical?'technical':'business';
if(window.parent===window){location.replace('/api/staff/console#'+workspace+'/'+location.hash.slice(1));return}
function position(){parent.postMessage({type:'workspace-position',section:location.hash.slice(1)||(technical?'monitor':'overview')},location.origin)}
addEventListener('hashchange',position);addEventListener('workspace-position',position);
addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==parent||e.data?.type!=='workspace-navigate')return;const section=e.data.section;if(typeof section==='string'&&/^[a-z]+$/.test(section)&&location.hash!=='#'+section)location.hash=section});
document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(!a)return;const u=new URL(a.href,location.href);if(u.origin!==location.origin)return;if(['/api/staff/lab/console','/api/staff/workspace/console'].includes(u.pathname)){e.preventDefault();parent.postMessage({type:'workspace-switch',workspace:u.pathname.includes('/lab/')?'technical':'business',section:u.hash.slice(1)||undefined},location.origin)}else if(u.pathname==='/'&&!a.download){a.target='_top'}});position();
})();