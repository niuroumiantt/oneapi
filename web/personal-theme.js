/* Appearance preference for the site, stored in this browser. */
(() => {
  'use strict';
  const storageKey = 'semifly.personal-theme.v1';
  const palettes = new Map([
    ['cool-red', ['冷白灰 · 正红', '#EBECEE', '#BCBBBF', '#D71019']],
    ['mist', ['银灰 · 雾白', '#DBE1E4', '#F2F7F8', '#6553D8']],
    ['ink-green', ['墨绿 · 酸绿', '#062320', '#B4B9B4', '#58EB04']],
    ['burnt-orange', ['暖白 · 焦橙', '#FFF8F2', '#190300', '#FB5E0D']],
  ]);
  const root = document.documentElement;
  const localPreview = root.hasAttribute('data-local-theme-preview');
  let selected = 'mist';
  try {
    const saved = localStorage.getItem(storageKey);
    if (palettes.has(saved)) selected = saved;
  } catch {
    // Private browsing or restricted storage still allows switching for this visit.
  }
  if (localPreview) {
    const previewTheme = new URL(location.href).searchParams.get('theme');
    if (palettes.has(previewTheme)) selected = previewTheme;
  }
  root.dataset.siteTheme = selected;

  function control() {
    const options = [...palettes].map(([id, [label, base, middle, accent]]) => `
      <button type="button" data-personal-theme-option="${id}" aria-pressed="${id === selected}">
        <span class="personal-theme-swatch" aria-hidden="true" style="--swatch-base:${base};--swatch-mid:${middle};--swatch-accent:${accent}"></span>
        <span>${label}</span><span class="personal-theme-option-state" aria-hidden="true">当前</span>
      </button>`).join('');
    return `<details class="personal-theme-picker">
      <summary aria-label="换肤，当前：${palettes.get(selected)[0]}"><span class="personal-theme-current" aria-hidden="true"></span>换肤</summary>
      <div class="personal-theme-options" role="group" aria-label="网站配色">${options}</div>
    </details>`;
  }

  function sync(container) {
    for (const option of container.querySelectorAll('[data-personal-theme-option]')) {
      option.setAttribute('aria-pressed', String(option.dataset.personalThemeOption === selected));
    }
    for (const picker of container.querySelectorAll('.personal-theme-picker')) {
      picker.querySelector('summary').setAttribute('aria-label', '换肤，当前：' + palettes.get(selected)[0]);
    }
  }

  function apply(id) {
    selected = id;
    root.dataset.siteTheme = id;
    sync(document);
  }

  document.addEventListener('click', event => {
    const picker = event.target.closest('.personal-theme-picker');
    for (const open of document.querySelectorAll('.personal-theme-picker[open]')) {
      if (open !== picker) open.open = false;
    }
    const id = event.target.closest('[data-personal-theme-option]')?.dataset.personalThemeOption;
    if (!picker || !palettes.has(id)) return;
    apply(id);
    try { localStorage.setItem(storageKey, id); } catch {}
    // Keep existing local comparison links shareable after changing the selection.
    if (localPreview) {
      const url = new URL(location.href);
      if (url.searchParams.has('theme')) {
        url.searchParams.set('theme', id);
        history.replaceState(history.state, '', url);
      }
    }
    picker.open = false;
    picker.querySelector('summary').focus();
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const picker = event.target.closest('.personal-theme-picker[open]');
    if (!picker) return;
    event.preventDefault();
    picker.open = false;
    picker.querySelector('summary').focus();
  });

  document.addEventListener('DOMContentLoaded', () => {
    for (const slot of document.querySelectorAll('[data-theme-control]')) slot.innerHTML = control();
  });

  window.addEventListener('storage', event => {
    if (event.key === storageKey) apply(palettes.has(event.newValue) ? event.newValue : 'mist');
  });

  window.PersonalTheme = { control };
})();
