/* The local preview changes palette without remounting the workspace. */
(() => {
  const options = new Map([
    ['ink-green', '墨绿 · 酸绿'],
    ['burnt-orange', '暖白 · 焦橙'],
    ['mist', '雾白 · 功能色'],
  ]);
  const param = new URL(location.href).searchParams.get('theme');
  let theme = options.has(param) ? param : 'mist';
  document.documentElement.dataset.previewTheme = theme;

  const renderFooter = SiteHeader.footer;
  SiteHeader.footer = (...args) => {
    const choices = [...options].map(([value, label]) =>
      `<option value="${value}"${theme === value ? ' selected' : ''}>${label}</option>`
    ).join('');
    return renderFooter(...args).replace(
      /<a class="site-filing"[^>]*>[^<]*<\/a>/,
      `<label class="site-filing preview-palette"><span>本地配色预览 · 演示数据</span><select data-preview-palette aria-label="预览配色">${choices}</select></label>`
    );
  };
  document.addEventListener('change', event => {
    const select = event.target;
    if (!select.matches('[data-preview-palette]') || !options.has(select.value)) return;
    theme = select.value;
    document.documentElement.dataset.previewTheme = theme;
    const url = new URL(location.href);
    url.searchParams.set('theme', theme);
    history.replaceState(history.state, '', url);
    document.querySelectorAll('[data-preview-palette]').forEach(control => { control.value = theme; });
  });
})();
