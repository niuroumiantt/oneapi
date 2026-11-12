# 交接：网关设置逐条确认

> 写于 2026-11-12。新会话先读这份，再读登记表 `docs/14-gateway-settings.md`。

## 这项工作是什么

负责人要求：网关（员工调用 `/v1/chat/completions` 的那一层）的每一条设置，都要有明确的公司决定。做法是：

1. 把网关全部设置登记成表：`docs/14-gateway-settings.md`。每条有现行值、来源（✅ 已定 / ⚠ 待确认 / ❗ 有问题）、对员工的影响。
2. 按表末「待决定清单」一条一条过。每条先查事实（代码 + 生产数据），再给负责人 2–4 个选项，推荐项放第一个并说明理由，由负责人选。
3. 定了就改代码、写测试、改登记表（标「已定（日期 负责人决定）」并写依据）、改员工文档 `web/docs.js`。
4. 负责人明确说「合并并发布」才合并和发布。

## 进度

| # | 事项 | 状态 |
|---|---|---|
| 1 | 单次请求时长 | ✅ 已上线（PR #58）：总时长 900 秒；流式 60 秒空闲超时；超时返回 504 `upstream_timeout`；Caddy `/v1` 等待 910 秒（infra PR #410） |
| 2 | 员工工具先断开怎么算 | ✅ 已上线（PR #58）：记 `CLIENT_CLOSED`；无用量调用按 KerAPI 日志 Token × 官方价结算（`supplier_tokens`），KerAPI 没收钱不扣（`supplier_free`）；网关重启卡住且无请求号的记 `GATEWAY_INTERRUPTED`，不扣 |
| 3 | 全公司对 KerAPI 的总并发 | **下一条从这里开始** |
| 4–14 | 见登记表「待决定清单」 | 未开始 |
| 15 | KerAPI 没收钱时，我们自己的服务器、带宽成本怎么收 | 负责人决定移到单独的会话讨论（阿里云容量与成本），结论回来后再改这里的 `supplier_free` 规则 |

发布后的生产状态（2026-11-12 11:50 北京时间）：镜像 `d90b454`；`CLIENT_CLOSED` 384 次（含迁移 052 改正的历史记录）；21 笔重启卡住的调用已释放。

## 第 3 条的已知事实（可直接用）

- 所有员工共用一把 KerAPI Key（「11.11key2」）；「第二次测试key」指纹相同（`145e40d595e6`），实际没有备用。
- KerAPI 没有书面给出每 Key 的并发、RPM、TPM 上限。
- 2026-11-12 上午的真实批量：同时 17 路（glm-5.3 10 路 + deepseek-flash 6 路），0 次 429、0 次 5xx；12 路以上时输出速度没有下降（deepseek-flash 118.8 tok/s，glm-5.3 50.5 tok/s）。
- 网关现在只有按员工的并发上限（默认 3，按 Key 可调到 64）和按 Key 的每分钟上限（默认 60，可调到 1200），没有全公司总闸。
- 「压测」功能从来没在生产跑过（`load_tests` 表为空）；它一次只测一个模型、每档请求很少、回答很短，测不出「多模型共用一把 Key」和每分钟限额。负责人已同意改造压测，但还没做。

## 做事规则

- 工作目录：`~/.worktrees/oneapi/<任务名>`，从最新 `origin/main` 建分支；不要动 `~/code/oneapi` 主工作区（有其他任务）。
- 测试库：`postgresql://oneapi_test:local_test_only_62178@127.0.0.1:55471/oneapi_test`，先 `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`，再 `TEST_DATABASE_URL=... npm test`。
- 迁移编号会和其他会话撞车：合并前 `git fetch` 看 `origin/main` 的最大编号，必要时改名并同步 `server/src/migrate.mjs` 和文档里的引用。
- 生产只读查询：`ssh aliyun 'cd /srv/oneapi-runtime && sudo -n docker compose -f compose.yml -f pilot.override.yml --env-file /srv/oneapi-config/compose.env exec -T api node --input-type=module -' < 脚本.mjs`（脚本里 `import pg from 'pg'`，用 `process.env.DATABASE_URL`）。
- 发布：`docs/handoff/gateway-settings-release.sh` 是这次用过的发布脚本模板（先备份数据库，再在现有镜像上叠新代码、跑迁移、健康检查，失败自动回滚；再推前端静态文件）。复制到临时目录，填 SHA，`cd` 行指向一个干净的工作树。发布会重启网关，进行中的请求会被中断（新规则下记 `GATEWAY_INTERRUPTED`，不扣员工）。
- Caddy 的线上文件 `/srv/infra/oa-cn/hosts/mainland/Caddyfile.public` 不是 git 仓库，与 infra 仓库 `hosts/mainland/Caddyfile.public` 保持一致。改法：先备份；把候选文件放到容器可写目录 `/var/lib/docker/volumes/mainland_caddy_config/_data/` 里用 `caddy validate --config /config/...` 校验（容器根目录只读）；再写入线上文件、`docker kill -s USR1 mainland-caddy-1` 热加载。
- 合并、发布后删除分支和临时工作树。
