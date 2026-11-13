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
| 2 | 员工工具先断开怎么算 | ✅ 已上线（PR #58）：记 `CLIENT_CLOSED`；无用量调用按 KerAPI 日志 Token × 官方价结算（`supplier_tokens`）；KerAPI 没收钱时的通道费见 #15；网关重启卡住且无请求号的记 `GATEWAY_INTERRUPTED`，不扣 |
| 3 | 全公司对 KerAPI 的总并发 | ✅ 已定、已实现（分支 `claude/gateway-settings-3-f96b1e`，未发布）：全平台同时 50 个、每分钟 1,500 万 Token；每个企业默认 10 个、200 万，本公司 30 个、400 万（迁移 053）；技术后台「路由」页可改。依据见登记表 C6、C10 |
| 4 | 限流或故障时是否换 Key | ✅ 已定、代码已实现（同一分支，未发布）：429/5xx 未开始输出时换下一条线路；全部限流返回 `upstream_rate_limited`；指纹相同的 Key 不算备用。官方备用线路已接入（迁移 055）：负责人选「另建备用 Key」，发布后在「评测 Key」页卡片下方登记，按型号填官方型号 ID；无用量的官方调用不扣（`official_unmetered`） |
| 5–6 | 默认并发 / RPM（C1、C2）与按人席位（C3）+ 人级 TPM（C11）+ 429 计数（C12） | ✅ 已上线（PR #73，镜像 `e2b1ca8`）：席位默认 10 路 / 300 万 TPM；Key RPM 60；限流是护栏；满了加上游 Key；每日 429 计数（迁移 056） |
| 7 | 不传 max_tokens 默认值（B5） | ✅ 已上线（PR #74，镜像 `43ee1b5`）：GLM 默认 8192，其余 4096 |
| 8 | 24 小时没等到账单（H7） | ✅ 已定：按预留上限扣（代码已是 `hold_fallback`；本分支只落登记） |
| 9 | 节假日名单（H3）+ 官方定价观察窗 | ✅ 已上线（PR #77，镜像 `8fc957e`）：假日名单 + 官方定价观察（迁移 057） |
| 10 | 只开放两个接口（A6） | ✅ 已上线（PR #78，镜像 `dfdb2dc`）：维持 `/v1/models` + `/v1/chat/completions` |
| 11 | 请求体 / 消息条数 / 每人 Key（B1、B2、A3） | ✅ 已上线（PR #79，镜像 `de07e06`）：维持 8 MB、500 条、5 把 |
| 12 | 早期试用 Key（L1） | ✅ 本分支：下线 `sf_test_`；迁移 058 停用存量；个人台 `/api/pilot/status` 关闭 |
| 13 | 网关不自动重试（F7） | ✅ 已定（2026-11-13）：不自动重试；重试交给客户端 |
| 14 | 非流式卡死检测（D7） | ⚠ 仍先不做（2026-11-13 维持） |
| 15 | KerAPI 没收钱时通道费（`supplier_free`） | ✅ 本分支：提交 Token × ¥0.005/百万；优先日志 input，否则 `estimated_input_tokens`（迁移 059） |

发布后的生产状态（2026-11-12 17:41 北京时间）：镜像 `e2b1ca8`（含第 5–6 条席位 10/300 万 TPM + 迁移 056 的 429 计数）；静态 `e2b1ca80d8a0`；`gateway_rejection_counts` 已建表。此前：`d90b454` 时 `CLIENT_CLOSED` 384 次；21 笔重启卡住的调用已释放。

## 第 3 条的事实（已用于决定）

- KerAPI 答复（负责人转述，2026-11-12）：并发不设上限；前期约 2000 万 TPM；缓存命中计入 TPM；超过返回 429。
- 容量由「阿里云容量与成本」会话核实（`docs/15-aliyun-capacity-and-cost.md` 4.2 节）：最先到顶的是网关 CPU（0.75 核约 60 路）；出口已不是 3 Mbps；智能体调用每路约 107 万 TPM。

以下是最初的记录：

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
