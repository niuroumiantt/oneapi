(()=>{'use strict';
// The staff console now lives in the main site at /#console/<business|technical>/<section>. Old links land here and are forwarded.
const raw=location.hash.slice(1).split('/').filter(Boolean),fallback=location.pathname.includes('/lab/')?'technical':'business';
const workspace=['business','technical'].includes(raw[0])?raw.shift():fallback,section=raw[0]||'',supplier=new URLSearchParams(location.search).get('supplier');
location.replace('/#console/'+workspace+(section?'/'+section:'')+(supplier&&/^[a-f0-9-]{36}$/.test(supplier)?'?supplier='+supplier:''));
})();
