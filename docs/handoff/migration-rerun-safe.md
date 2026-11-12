# 迁移可重复执行 交接（更新于 2026-11-12，机器 m5；已上线）

## 目标

每次启动都会重跑全部 SQL 迁移，旧迁移不能再把约束改回更窄的版本，否则库里已有的新数据会让启动失败。

## 已定规则（用户确认过的，不要再问）

- 生产和测试都照旧在每次启动时重跑全部迁移，不改成“只跑新文件”。
- 共用测试库（127.0.0.1:55438）不清空。要干净的库就另起临时 PostgreSQL。
- 用户说“合并并发布”后再合并、发布。

## 规则：怎么改 CHECK 的取值列表

`employee_calls_settlement_source_check` 已经被 025、026、052、055 先后改过。每一条“删除后重建”都包在判断里：现有约束还不含本文件新增的那个值时才替换，例如 026 看 `official_price`，052 看 `supplier_tokens`，055 看 `official_unmetered`。列表只增不减，所以已含新值就说明现有约束不比本文件的窄。

以后再加取值：新开一条迁移，照同样写法以新值为判断条件，写出完整列表。旧迁移不用改。`identity.test.mjs` 会为最终约束允许的每个值各插一行，再跑一次 `migrate()`，哪条旧迁移会收窄约束就会当场失败。

## 进度

1. PR 67（合并提交 `5f0961a`，已上线）：026 改成上面的判断写法；加了重跑迁移的回归测试。
   - 发布：镜像 `oneapi-identity:5f0961a`。
   - 备份 `/srv/oneapi-backups/oneapi-20261112T061011Z.dump`。
   - 先用新镜像跑 `migrate.mjs`，再切换 `oneapi-api-1`（`--timeout 25`，带健康检查和失败自动还原）。
   - 切换时有 7 个在途调用被标为 `GATEWAY_INTERRUPTED`，没有扣费。
   - 回滚：`pilot.override.before-5f0961a.yml` 加镜像 `oneapi-identity:cf34e94`。
2. PR 71（合并提交 `dd30633`，另一个会话做的，已上线）：独立修了同样两个问题。
   - 052 原先还在无条件写五项列表，库里一旦有 055 的 `official_unmetered` 记录，下次启动就会失败。052 和 055 已改成上面的判断写法。
   - 测试里重跑 `migrate()` 时，053 会把“没人定过限额”的测试公司重设为每分钟 400 万 Token，后面第 5 步的调用收到 429。改法是测试设限额时同时写 `limits_updated_at`。这个问题是 PR 67 的测试带进来的。
3. PR 70（本交接所在的 PR）：加了本文档；回归测试改为为最终约束允许的每个值各插一行再重跑 `migrate()`，以后新增取值不用另写断言；026 只改了注释。这些没有运行时影响，所以没有重新发布后端。
   - 测试：在临时库上连续两次 `npm test`，两次全部通过。

## 下一步

1. 切换容器总会打断在途的流式调用。可以考虑让 `docker stop` 的等待时间和应用的 20 秒退出时限对齐（compose 里设 `stop_grace_period`），或者先让新容器接流量再停旧的。还没有做。

## 待用户决定

- 无。

## 入口文件与工具

- 迁移列表：`server/src/migrate.mjs`；涉及的迁移：`server/migrations/026_*.sql`、`052_*.sql`、`055_*.sql`。
- 回归测试：`server/test/identity.test.mjs`，搜 “Every deploy re-runs all migrations”。
- 临时测试库：先 `export LC_ALL=C`（否则 PostgreSQL 报 “postmaster became multithreaded” 起不来），然后 `initdb --locale=C -U postgres --auth=trust`，`pg_ctl -o "-k '' -p <端口> -h 127.0.0.1"` 只开 TCP，建 `oneapi_test` 角色和库，`TEST_DATABASE_URL` 指过去跑 `npm test`。
- 发布时的注意事项：
  - `/srv/oneapi-runtime` 归 root 所有，要用 sudo。
  - compose 命令要带 `-p oneapi --env-file /srv/oneapi-config/compose.env`。
  - 镜像里没有 `sh`，冒烟检查用 `docker run --entrypoint node`。
  - 源码用 `git archive <SHA> server` 打包，上传到 `source-<短SHA>/`，`Dockerfile` 用 `FROM` 上一版镜像再 `COPY server`。
