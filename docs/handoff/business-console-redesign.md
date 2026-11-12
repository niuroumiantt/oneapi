# 商务后台重组交接（更新于 2026-11-12，机器 m5）

## 目标

商务后台从“供给流程视角”改为老板和财务看公司的视角：收入、成本、利润、发票；上下游编码和客户管理；产品与折扣；一线客户支持。

## 已定规则（用户确认过的，不要再问）

- 编码用带年份的流水号，建档即生成、不可修改：上游 `S26-001`，企业客户 `E26-0001`，个人客户 `P26-00001`。年份取记录建档时间（北京时间）。
- 折扣授权本期只做台账（授权、审批、有效期、上限、记录），不接入扣费。页面上写明“尚未接入扣费”。
- 发票：财务在电子税务局开具，后台登记申请和结果；客户可在自己的账单页自助申请。
- 新增“财务”开关。收入、成本、毛利、发票、退款、上游付款只对财务开关和平台管理员可见。现有商务员工默认不带财务权限，由管理员逐人打开。

## 进度

已完成（分支 `claude/business-console-redesign`，基于 `origin/main` b662d20，已在本地提交，尚未推送）：

- 迁移 `server/migrations/048_business_console.sql`：`staff_finance_access`、编码计数器与 `next_business_code()`、`suppliers.code` 与联系人、`customers`、`customer_notes`、`tax_invoices`、`supplier_payments`、`discount_grants`、工单分类与层级、`support_ticket_replies`、`support_answers`。可重复执行。
- 后端 `server/src/business-console.mjs`：`/api/staff/business/*`（驾驶舱、损益、发票、上游付款、供应商、客户、折扣、工单与问答）和客户侧 `/api/billing/*/invoices`、`/api/support/answers`。
- 前端 `server/private/workspace.html`、`workspace.js` 重写为 5 组 12 页；`web/console.js` 登记新页面；`web/identity.js` 增加财务开关、客户发票申请、工单分类、常见问题。
- 收款与退款接口由商务权限改为财务权限。
- 测试：`server/test/identity.test.mjs` 末尾新增两项；全套 50 项通过（合入 main 之后），连续两次运行都通过。

## 口径（改动前先读）

- 已确认收入 = 客户现金账本的 `usage` 流水。目前没有代码写这类流水，线上会是 0。
- 内部额度消耗按标价显示，不计收入。
- 上游成本 = 销售成本（客户调用对应的上游账单；没有逐笔账单的按标价估算）+ 没有任何客户调用对应的上游账单（测试、验收、系统）。
- 现金口径 = 充值收款 − 已成功退款 − 登记的上游付款。
- 可开票金额 = 充值入账 − 退款（含处理中）− 待开票和已开具的发票。作废、红冲、退回后金额回到额度。财务登记时可勾选“允许超出实收”（先票后款）。
- 客户行由 `ensure_customers()` 在后台访问时补建，不挂在注册路径上。每个企业一条 E 编码，每个登录账号一条 P 编码。

## 下一步

1. 推送、开 PR、发布。发布后在生产库核对：现有 3 家供应商得到 `S26-001` 起的编码；客户编码按建档时间顺序生成。
2. 平台管理员在“账户与权限”里给需要的人打开财务开关。
3. 未做、需要单独排期：对公转账入账（手工给客户加余额）、折扣接入扣费、发票 PDF 上传与邮件送达、已转技术的工单在技术后台显示、旧 `#ops/*` 预览页的清理。

## 待用户决定

- 对公转账入账是否做成“财务登记 + 第二人复核后入账”。
- 现金扣费上线时，折扣按“下单时生效的授权里最优的一条”还是允许叠加。

## 入口文件与工具

- 设计背景：`docs/12-unified-accounts-and-backoffice.md` 第 0 节（2026-11-12 更新）。
- 测试：`npm test`，使用本机 `oneapi_test` 库（127.0.0.1:55438）。
- 本地预览员工后台需要一个代替公司身份服务的本地 OIDC 服务，写法照 `server/test/identity.test.mjs` 里的 `idpServer`；应用用 `STAFF_OIDC_ISSUER`、`STAFF_OIDC_CLIENT_ID`、`STAFF_OIDC_CLIENT_SECRET`、`STAFF_BOOTSTRAP_SUB`、`SUPPLIER_LAB_SECRET` 启动。本机 3000 端口被 Docker 占用，预览用 3217。
