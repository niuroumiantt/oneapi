# 模型目录与能力标签 交接（更新于 2026-11-12，机器 m5；已发布）

## 目标

模型广场、文档页和网关共用一份模型目录；每个型号带能力标签，让用户和程序都能看出它会不会先思考、能不能看图。

## 起因

一个应用反馈：并发只有 3 路；部分型号在 `max_tokens` 小时正文为空；`deepseek-v4-pro`、`deepseek-chat`、`deepseek-reasoner` 调不通。核对结果：

- 3 路并发、每分钟 60 次、403 和 503 都是我们网关自己的规则，不是 KerAPI 的。并发按人计，不是按 Key 计。
- 空正文是思考先用完了 `max_tokens`，是模型和官方的默认行为。接口和页面原来没有任何提示。
- 模型广场、文档页、网关各有一份型号列表，互不一致。广场展示了调不通的 V4 Pro，漏了两个能用的型号。

完整讲解（架构、规则来源、四层梳理、瓶颈）见专题页：https://claude.ai/artifact/S7xPewcf5E87V9VBKaW7jn （私有，需用户账号打开）。

## 已定规则（用户确认过的，不要再问）

- 目录只留一份，源头是 `server/src/official-models.mjs`。
- 标签只写在我们线路上验证过的能力。官方文档有、我们没测的能力不打标签（目前是 GLM Flash 的“看视频、读文件”）。
- 没有线路的型号在广场上显示“暂未开放”，不隐藏。

## 进度

已完成并上线（PR 52，合并提交 `39dbd5d`）：

- `server/src/official-models.mjs`：每个型号加 `caps`（思考、输入、输出、工具、JSON、缓存、上下文、官方最大输出）和展示文字。新增 `capabilityTags()`、`publicCapabilities()`、`marketCatalog()`。
- `web/model-catalog.js`：由 `scripts/build_model_catalog.mjs` 生成，不要手改。`server/test/model-catalog.test.mjs` 在它过期时失败。
- `/v1/models` 和 `/api/employee-credit/status`：每个型号多返回 `name`、`tags`（或 `capability_tags`）、`capabilities`。
- 新接口 `GET /api/public/models`：公开，只返回每个型号当前是否可调用，缓存 60 秒。
- 模型广场（`web/app.js`）：6 张卡片、能力标签、“暂未开放”状态；型号详情写明思考占用 `max_tokens`。
- 文档页（`web/docs.js`）：“可用模型”表改读同一份目录，并说明新字段。
- 测试：全套 59 项通过，在全新的临时库上对 `39dbd5d` 复跑过一次。PR 53 的提交说明里提到一项“nothing published yet”失败（200 !== 404），那是共用测试库里留有旧数据造成的，在干净的库上不出现。

## 口径（改动前先读）

- “思考”和“看图”按 2026-11-11 功能对比在我们线路上的结果填写，数据来自公开接口 `/api/public/realtesting`。
- 三个 GLM 型号都标“始终思考”：官方接口对“关闭思考”返回“该模型始终思考”。网关会把“关闭”换成 `low`。
- 两个 DeepSeek Flash 型号标“默认思考 · 可关”：功能对比里“关闭思考”通过。
- 应用曾报告 `deepseek-flash-0910` 和 `glm-5.3-flashx`“直接出正文”。功能对比里这两个型号都返回了思考内容，以功能对比为准。模型遇到很简单的问题会跳过思考，单次观察会误判。
- GLM Flash、FlashX 的“缓存计价”没有打：功能对比里两边都没有报告缓存命中。
- DeepSeek V4 Pro 没有线路，`verified: false`，能力按官方文档填写，未经实测。
- `capabilities.max_output_tokens` 是网关自己的单次上限（32768），不是官方最大输出。

## 发布记录（2026-11-12）

- 后端和静态页均已上线源码 `39dbd5d36c2f757694177916460d6f4cc3f623de`，镜像 `oneapi-identity:39dbd5d`。`/api/status` 与 `/release.json` 一致。
- 流程沿用既有方式：备份库 `/srv/oneapi-backups/oneapi-20261112T021339Z.dump` → 在 `oneapi-identity:6fa2871` 上叠新的 `server/` → 新镜像冒烟检查 → 切换 `oneapi-api-1`（带健康检查，失败自动还原）→ `push_static_candidate.sh` 发布静态。没有数据库迁移，没有运行 `migrate.mjs`。
- 切换时在途调用为 0。
- 回滚：旧镜像 `oneapi-identity:6fa2871` 与 `/srv/oneapi-runtime/pilot.override.before-39dbd5d.yml` 保留；静态用发布器重新发布旧 SHA。
- 生产核对：`/api/public/models` 返回 5 个可用、`deepseek-v4-pro` 不可用；线上模型广场 6 张卡片，V4 Pro 显示“暂未开放”，其余显示“功能对比已测”；未登录访问员工接口返回 401；旧站 `api.glocalstorage.cn` 返回 200。
- 没有核对：带真实员工 Key 调用 `/v1/models` 看新字段（发布时没有可用的 Key；集成测试覆盖了这一项）。登录后的个人工作台模型表。

## 下一步

1. 用一把员工 Key 调一次线上 `/v1/models`，确认返回 `tags` 和 `capabilities`。
2. 并发上限：另一个会话已在 PR 53（合并提交 `f51b5ba`）里做成“管理者可以单独调高某一把 Key 的并发和每分钟次数”，默认值仍是每人 3 路、每 Key 60 次。写这份交接时它还没有上线，带迁移 050。剩下要做的是用验收台压测测出 KerAPI 这把 Key 的稳定并发，作为调高时的依据。
3. 进程重启时，没收尾的调用会留在 `pending`，最多 15 分钟后才清理（`STALE_PENDING`），这段时间一直占着并发名额。这是读代码得出的，没有在线上复现过。
4. 网关在“正文为空且 `finish_reason` 为 `length`”时，加一个响应头说明原因。
5. `deepseek-v4-pro` 走 DeepSeek 官方直连，线上没有可用线路。是直连 Key 读不到还是型号被暂停，需要在服务器上确认。
6. 测一次 GLM Flash 的视频和文件输入，通过后把 `input` 补上 `video`、`file`，标签会自动出现。

## 待用户决定

- 默认并发上限（每人 3 路）要不要整体调高，是否区分内部员工和将来的外部客户。
- V4 Pro：补官方直连 Key，还是先从目录里拿掉。

## 入口文件与工具

- 目录：`server/src/official-models.mjs`。改完运行 `node scripts/build_model_catalog.mjs` 并提交生成的 `web/model-catalog.js`。
- 网关限额常量：`server/src/employee-credit.mjs` 第 14 行。
- 测试：`npm test`。本机默认的 `oneapi_test` 库（127.0.0.1:55438）可能被别的会话占用；可以在系统临时目录起一个临时 PostgreSQL，用 `TEST_DATABASE_URL` 指过去，库名须以 `_test` 结尾。本机需要先 `export LC_ALL=en_US.UTF-8`，否则 PostgreSQL 起不来。
- 发布：m5 上 SSH 要显式用 `~/.ssh/id_ed25519`（`deploy@47.104.143.95`）；静态发布在 `~/code/infra` 运行 `scripts/push_static_candidate.sh oneapi <包> <SHA>`，带 `MAINLAND_SSH_HOST`、`MAINLAND_SSH_IDENTITY`、`STATIC_PYTHON=/Users/m5/.local/bin/python3.12`。静态包用 `scripts/build_static.py --out` 在一个 HEAD 等于发布 SHA 的干净工作树里构建。
