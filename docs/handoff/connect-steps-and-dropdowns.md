# 接入三步、全站下拉菜单与迁移重跑修复 交接（更新于 2026-11-12，机器 m5）

## 目标
让员工按“① 模型 → ② Agent 工具 → ③ 接入方法”接入；全站下拉框统一为在下方弹出的圆角菜单；修好 employee credit 测试和迁移重跑问题。

## 已定规则（用户确认过的，不要再问）
- 每个任务做完都直接走完：提交 → 开 PR → 合并到 main → 删分支 → 上线（`server/` 有改动时连后端一起发）。不逐步询问。
- 企业 Glocal Team 只有 sales@glocalstorage.com 是企业管理者，其他人都是企业成员（生产库已改，带审计记录）。
- 第 2 步标题为“您正在使用的 Agent 工具：请选择”，选择框用荧光绿 `#c8ff3e`；第 1、2 步标题用深色加粗，三项配置名称保持灰色且一行显示。
- 下拉框样式参照 macOS Excel 的菜单：在框下方弹出、白底圆角、轻阴影，不盖住选择框。

## 进度
- 已完成（均已合并并上线，生产前后端 `dd30633`）：
  - PR #60 模型页「接入配置」改三步；PR #61 密钥页「为指定 Agent 生成 Key」改三步、生成区缩小；PR #65 标题和荧光绿。
  - PR #68 客户站下拉菜单 `web/select-menu.js`；PR #69 员工后台同一份脚本（`server/private/select-menu.js`，测试保证两份一致）。
  - PR #71：测试按员工后台方式设置限额（带 `limits_updated_at`）；052、055 只放宽旧的 `settlement_source` 约束，不再覆盖新的；新增“有 official_unmetered 记录时重跑迁移”的测试。
- 进行中：无。

## 下一步
1. 用员工身份登录后台，实际点开工作台、供应实验室的下拉框核对样式（本地没有员工登录态，没看过）。
2. 用真实员工账号看一眼模型页和密钥页的三步布局（本地只用模拟数据核对过）。
3. 以后新增 `settlement_source` 取值的迁移，要照 052/055 的写法加 `IF NOT EXISTS ... LIKE '%新值%'` 判断。

## 待用户决定
- 无。

## 入口文件与工具
- 三步布局：`web/identity.js` 的 `agentStepTitle`、`labelEm`、`employeeKeyPanel`、`employeeCreditKeys`；样式在 `web/identity.css` 末尾（`.pc-steps`、`.kg-*`）。
- 下拉菜单：`web/select-menu.js`（样式写在脚本里）；改它要同步复制到 `server/private/select-menu.js`。`data-native-select` 的区域保留系统菜单。
- 本地看登录后的页面：在 `web/` 下临时放一份 index.html 副本，开头注入假 `fetch`（`/api/platform/me`、`/api/platform/organizations/<id>`、`/api/employee-credit/status`），用 `.claude/launch.json` 的 `start-3100` 起服务；本机 3000 端口被 New API 占用。用完删掉副本。
- 测试：共用测试库 `127.0.0.1:55438/oneapi_test` 可能被其他会话同时使用，或残留旧代码写坏的数据。可以在临时目录 `initdb` 一个库（`LC_ALL=en_US.UTF-8`，`-c unix_socket_directories=''`，端口如 55499），用 `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55499/ci_test npm test`。
- 发布：静态用 `scripts/build_static.py --out` + infra `scripts/push_static_candidate.sh oneapi <包> <SHA>`（`MAINLAND_SSH_HOST=deploy@47.104.143.95`、`MAINLAND_SSH_IDENTITY=~/.ssh/id_ed25519`、`STATIC_PYTHON=/Users/m5/.local/bin/python3.12`）。后端用 `docs/handoff/gateway-settings-release.sh`：复制到临时目录，填 SHA，`cd` 改成指向该 SHA 的干净工作树（`~/.worktrees/oneapi/release-<sha7>`，用完 `git worktree remove`）。发布前先看 `docker ps` 和 `/srv/oneapi-runtime` 最新目录，确认没有其他会话正在发布。
