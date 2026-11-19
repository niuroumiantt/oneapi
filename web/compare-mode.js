// Determine embedding before styles or page content can paint.
if(new URLSearchParams(location.search).get('embedded')==='1')document.documentElement.classList.add('compare-embedded');
