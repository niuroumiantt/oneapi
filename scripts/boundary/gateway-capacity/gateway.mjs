// Our real app, with outbound calls to kerapi.cn redirected to the fake upstream. Pool size 10, as in production.
import pg from 'pg'; import { readFileSync } from 'node:fs';
import { config } from '../../../server/src/core.mjs'; import { createApp } from '../../../server/src/app.mjs';
const seed = JSON.parse(readFileSync(new URL('./seed.json', import.meta.url)));
const cfg = config(); cfg.employeeCredit.organizationId = seed.org;
const UP = `http://127.0.0.1:${process.env.UP_PORT || 47101}`;
cfg.pilotFetch = (url, init) => fetch(String(url).replace('https://kerapi.cn/v1', UP), init);
const pool = new pg.Pool({ connectionString: cfg.databaseURL, max: 10, connectionTimeoutMillis: 5000 });
const { app } = createApp(pool, cfg);
app.listen(Number(process.env.PORT || 47100), '127.0.0.1', () => console.log(JSON.stringify({ gateway: 'ready' })));
let last = process.cpuUsage(), lastT = performance.now();
setInterval(() => {
  const now = performance.now(), u = process.cpuUsage(last), ms = now - lastT; last = process.cpuUsage(); lastT = now;
  console.log(JSON.stringify({ t: Date.now(), cpu_pct: Math.round((u.user + u.system) / 10 / ms), rss_mb: Math.round(process.memoryUsage().rss / 1048576), heap_mb: Math.round(process.memoryUsage().heapUsed / 1048576), pool_total: pool.totalCount, pool_waiting: pool.waitingCount }));
}, 1000);
