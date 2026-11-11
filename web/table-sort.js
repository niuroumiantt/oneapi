/* Click any column heading to sort the table. Paged tables sort every row, then show the current page.
   Keep this file identical to server/private/table-sort.js, which the staff pages load. */
(() => {
 'use strict';
 const state = new Map();
 let scheduled = false, busy = false;
 const DATE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?/;
 const EMPTY = /^(—|-|–|尚未使用|待实测|暂无.*|未设置)?$/;
 const NUMBER = /^(?:预留\s*)?[<≈~]?\s*¥?\s*(-?[\d,]*\.?\d+)/;
 const keyOf = table => [...(table.tHead?.rows[0]?.cells || [])].map(cell => cell.textContent.trim()).join('|');
 const sortable = th => th.colSpan === 1 && !/^(操作)?$/.test(th.textContent.trim()) && !th.closest('table').hasAttribute('data-nosort');
 const dataRows = table => table.tBodies[0] ? [...table.tBodies[0].rows].filter(row => ![...row.cells].some(cell => cell.colSpan > 1)) : [];
 function value(cell) {
  if (!cell) return null;
  const explicit = cell.dataset.sort;
  if (explicit !== undefined && explicit !== '' && !Number.isNaN(Number(explicit))) return Number(explicit);
  const raw = (explicit ?? cell.innerText ?? cell.textContent ?? '').trim();
  if (EMPTY.test(raw)) return null;
  const date = raw.match(DATE);
  if (date) return new Date(+date[1], date[2] - 1, +date[3], +date[4], +date[5], +(date[6] || 0), +((date[7] || '0').padEnd(3, '0'))).getTime();
  const number = raw.match(NUMBER);
  if (number) return Number(number[1].replace(/,/g, ''));
  return raw.toLowerCase();
 }
 function compare(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return String(a).localeCompare(String(b), 'zh-CN');
 }
 function sortRows(table, { col, dir }) {
  const body = table.tBodies[0], rows = dataRows(table);
  // Empty values always go last, whatever the direction.
  const ordered = rows.map((row, index) => ({ row, index, v: value(row.cells[col]) })).sort((x, y) => {
   if (x.v === null || y.v === null) return x.v === null && y.v === null ? x.index - y.index : x.v === null ? 1 : -1;
   return (dir === 'asc' ? compare(x.v, y.v) : compare(y.v, x.v)) || x.index - y.index;
  }).map(item => item.row);
  if (ordered.some((row, index) => rows[index] !== row)) ordered.forEach(row => body.appendChild(row));
 }
 function pagerOf(table) {
  const next = table.closest('.personal-table-wrap,.live-table-wrap,.org-table-wrap,.table-scroll')?.nextElementSibling;
  return next?.matches?.('[data-pager]') ? next : null;
 }
 function showPage(table) {
  const pager = pagerOf(table);if (!pager) return;
  const size = Number(pager.dataset.size), page = Number(pager.dataset.page);
  dataRows(table).forEach((row, index) => { row.hidden = index < (page - 1) * size || index >= page * size; });
 }
 function apply() {
  scheduled = false;busy = true;
  try {
   document.querySelectorAll('table').forEach(table => {
    const head = table.tHead?.rows[0];if (!head) return;
    const current = state.get(keyOf(table));
    [...head.cells].forEach((th, index) => {
     if (!sortable(th)) return;
     if (!th.classList.contains('is-sortable')) { th.classList.add('is-sortable');th.tabIndex = 0;th.title = '点击排序'; }
     th.setAttribute('aria-sort', current?.col === index ? (current.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
    if (current) sortRows(table, current);
    showPage(table);
   });
  } finally { busy = false; }
 }
 const schedule = () => { if (!scheduled && !busy) { scheduled = true;setTimeout(apply, 30); } };
 function toggle(th) {
  const table = th.closest('table'), key = keyOf(table), col = th.cellIndex, current = state.get(key);
  const sample = dataRows(table).map(row => value(row.cells[col])).find(v => v !== null);
  const dir = current?.col === col ? (current.dir === 'asc' ? 'desc' : 'asc') : typeof sample === 'number' ? 'desc' : 'asc';
  state.set(key, { col, dir });
  apply();
  const pager = pagerOf(table);
  if (pager) document.dispatchEvent(new CustomEvent('table-sorted', { detail: { group: pager.dataset.pager } }));
 }
 document.addEventListener('click', event => { const th = event.target.closest?.('th.is-sortable');if (th) toggle(th); });
 document.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('th.is-sortable')) { event.preventDefault();toggle(event.target); } });
 const style = document.createElement('style');
 style.textContent = 'th.is-sortable{cursor:pointer;user-select:none}th.is-sortable:hover{color:#7740b6}th.is-sortable::after{content:"↕";margin-left:4px;font-size:10px;opacity:.35}th[aria-sort=ascending]::after{content:"↑";opacity:1;color:#7740b6}th[aria-sort=descending]::after{content:"↓";opacity:1;color:#7740b6}';
 document.head.append(style);
 new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
 schedule();
})();
