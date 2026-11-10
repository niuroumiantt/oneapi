# 员工公司额度与自助 API Key

2026-11-10。工作树 `~/.worktrees/oneapi/employee-credit`，分支 `claude/employee-credit`，基线 `origin/main` 3c1db07。

## 已定规则

- 员工 = 服务端 `EMPLOYEE_CREDIT_ORG_ID` 指定企业的有效成员。平台公开注册、人人可建企业，所以不能按“任意企业成员”发放。
- 每人一次性 10 元，首次打开个人空间时发放；主键为用户，退出再加入不重发，追加须另做管理操作。
- 按 KerAPI 账单实扣。公司内部额度，不写 `billing_accounts`（现金账本精度为分，且约定商户验证前不得入账）。
- 客户售价和 KerAPI 合同价仍未确认。本功能只用于公司内部，不能作为对外售价依据。

## 计费流程

1. 调用前按“输入字节上限 + max_tokens”乘登记费率和 2 倍高峰系数预留，账户行锁防并发超支。
2. 收到用量后把预留缩小到实际用量的高峰价；失败调用释放预留。
3. `usageWorker` 每 5 分钟同步 KerAPI 后运行 `settleEmployeeCalls`，按 credential + 上游 request ID 写实扣金额。
4. 24 小时仍无账单的调用按预留金额结算。实扣高于余额时封顶，不透支，`actual_yuan` 保留真实值。

代码：`server/src/employee-credit.mjs`、`server/migrations/025_employee_credit.sql`。`/v1` 路由须在全局 16 KB JSON 解析前挂载。Key 前缀 `sf_emp_`，与试用 `sf_test_` 并存。支持流式、工具调用，正文上限 512 KB，max_tokens 上限 8192，每 Key 每分钟 60 次，每人并发 3 个。

## 验证

- 临时 PostgreSQL 完整测试 38/38 通过，测试库已清理。新增用例覆盖发放幂等、非成员拒绝、实扣结算幂等、流式、失败释放、并发不超支、账单封顶、无账单兜底、停用后立即失效。
- 本地浏览器以员工登录：看到 10 元、生成 Key、调用成功、预留显示正确，手机宽度无溢出。上游为模拟 KerAPI。
- 未验证：真实 KerAPI 调用与 request ID 匹配（尤其流式）、生产部署。

## 上线前必须完成

1. 服务器私有环境增加 `EMPLOYEE_CREDIT_ORG_ID`（公司企业 UUID）和 `EMPLOYEE_CREDIT_MODELS`（逗号分隔的 KerAPI 型号）。
2. 这些型号要在验收台有启用的 KerAPI 端点，并登记输入、输出费率；没有费率的型号不会开放。
3. 备份数据库，运行迁移 025，同一代码版本发布 API 与静态页。
4. infra 的 OneAPI Caddy 配置放行 `/v1/models` 和 `/v1/chat/completions`，请求体至少 512 KB，并放宽 `response_header_timeout`（`/api` 块是 16 KB、30 秒，不能照搬）。
5. 用一个员工账号做真实小额调用，确认 5 分钟后转为“已结算”，金额与 KerAPI 日志一致。
