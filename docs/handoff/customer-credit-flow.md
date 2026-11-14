# 普通客户额度包闭环交接（2026-11-14，m5）

## 目标与已定规则

先统一文档、价格和退款口径，再打通普通客户购包、付款、Key、调用扣费和在线退款。小而美，复用现有页面。购包优惠取最优单条、不叠加；调用按官价；未用比例实付扣 15% 后退，已开销项发票阻止退款。

## 已完成

- 分支 `codex/customer-credit-flow`，基线 `c412979`；独立工作树 `~/.worktrees/oneapi/customer-credit-flow`，未改主工作区或生产。
- 公网价格、模型目录、公开文档、README 与架构说明统一为现行规则。复用密钥、用量、账单和财务支付订单页。
- 在线订单冻结面额/实付/优惠，支付验签及幂等入账；客户独立 Key、模型范围和额度上限；复用现有网关流式处理、输出保护及路由。
- PostgreSQL 批次账本精确扣费，缺少可靠用量等待对账，24 小时后释放预留。在线退款按未用批次冻结、原路退款、失败恢复；开票与退款共享账户锁。
- 迁移 061 幂等；060 不再重复补满已经消费的余额。历史已有消费/退款而未建立批次的账户会阻止迁移，需要明确核对，不能自动制造余额。
- 完整自动化回归 88 项通过（独立空 PostgreSQL 16 数据库）。涵盖签名模拟支付渠道、普通用户购包/Key/流式和非流式调用/扣费/退款、支付防重、越权、预占额度、上游超量仍受 Key 上限约束、退款失败及超时重试、开票拦截、迁移重跑。
- Chrome 1440px 本地虚构数据页面检查：密钥页、购包表单和账单退款表；无运行时异常。此检查不是实际商户验收。

## 发布与真实验收进度（2026-11-14 21:18 CST）

- 用户明确授权合并发布 PR #86 并做小额付款、Key、调用扣费和退款验收；实际付款交给用户。
- PR #86 已合并，生产 API 与静态页面均为 `0b3a738c8e119e8dfe7e6b881ce9529786a5a76a`。容器 `oneapi-identity:0b3a738` healthy；迁移成功，公网三个 JS 资产及价格/退款文字已核对。
- 切换前备份：`/srv/oneapi-backups/oneapi-20261114T131032Z.dump`，约 72 MB；前一运行镜像 `oneapi-identity:c412979`，前一配置 `pilot.override.before-0b3a738.yml`。
- 指定验收账号 `larryxie@hotmail.com` 已验证、未停用、未升级企业；目前尚无该个人资金账户。尚未创建本轮付款单、Key 或退款，没有实际扣款。
- 生产只读预检：4 笔历史 pending 支付订单，0 现金流水，0 额度包，0 生效优惠。客户状态与报价接口未登录均返回 401。
- 支付宝 AppID `2021007119640179` 与用户截图一致；应用截图显示已上线，但生产 `alipay.trade.query` 返回 `40006 / isv.insufficient-isv-permissions`（接口调用权限不足）。用户正在“可调用产品”页，截图当前选中电子发票；已引导搜索“电脑网站支付”，找不到则点“获取更多产品”。尚不能据截图确定该支付产品已开通。
- 客户付费调用仍关闭，未扩大公众开放范围。DeepSeek Flash 现有上游路由已配置，可用于后续小额验收。
- 下一步：确认电脑网站支付产品开通和应用绑定 → 重新做真实只读查单 → 用用户正常登录会话创建 ¥5 面额订单 → 通知用户实际付款 → 验证通知/查单幂等入账 → 限定模型开放验收 → 通过现有页面生成 Key → 极小真实调用及官价账本核对 → 现有退款申请/财务流程原路退剩余包 → 核实实退和账本。不能通过改余额或绕过客户身份伪造验收。
- 本机发布日志 `/tmp/oneapi-customer-credit-release.log`；发布工作树 `~/.worktrees/oneapi/customer-credit-release` 保持合并 SHA。此记录保存在 `codex/customer-credit-acceptance` 分支，待实际验收继续补齐。

## 下一步与开放边界

1. 代码审核后按既有发布流程合并、备份、迁移和发布；已于上节记录的版本完成生产发布。
2. 首次发布保持客户调用关闭；通过实际商户小额付款、异步通知、Key、真实模型用量核对、剩余包退款后，再设 `CUSTOMER_PAID_ENABLED=true` 和已验收的 `CUSTOMER_PAID_MODELS` 白名单。供应凭证配置仍复用现有配置。商户支付白名单也需与开放范围一致。
3. 对公退款自动账本、企业普通成员的付费预算分配、渠道返佣未完成；对公入账双人复核仍可用，退款页明确联系财务，不提供假自动操作。
4. 旧测试订单须核实是否仍能付款；迁移旧 pending 单按原实付作为面额，不追溯套用新优惠。过期 pending 单仍占优惠预算，只有确定取消才可释放，防迟到支付通知突破优惠预算。

## 入口与验证

- 规则：`docs/handoff/list-credit-billing.md`；实际架构：`docs/06-technical-architecture.md`。
- 代码：`server/src/{pack-ledger,customer-credit,payments}.mjs`、`server/migrations/061_customer_credit.sql`。
- 验证：独立空数据库 `TEST_DATABASE_URL=postgresql://… npm test`；提交后 `python3 scripts/build_static.py --out /tmp/oneapi.tar.gz`。
- 本机测试日志 `/tmp/oneapi-credit-tests7.log`；预览截图 `/tmp/oneapi-credit-{keys,billing}.png`。临时测试数据不包含真实客户资金或生产密钥。

## New merchant app handoff (2026-11-14, m5)

- User screenshot confirms new AppID `2021007119672763`, generated name `OpenApp_476099_9zkv`. The preceding screenshot says website payments opened; new app permissions are not API-verified yet. Keep the old app.
- Generated a separate RSA 2048 key on production only: `/srv/oneapi-config/alipay-2021007119672763/application-private.pem`, directory 0700, file 0600. Runtime still uses the old AppID; no config switch yet. Reuse this new key, never overwrite it during continuation.
- Application public key exported as single-line SPKI DER Base64 (392 characters): local `/tmp/oneapi-alipay-2021007119672763-public.txt`. DER SHA256: `ad3ab7aa82a344b40670398d502334e7d2d06c1dd853cf1283e5f857158a1743`.
- Opened public key file for user to paste into the application-public-key form. No browser read/click tool is available in this session. Await user submission, then obtain the new app's Alipay verification public key, verify merchant identity/PID and product permissions before switching runtime. Application public key is NOT the Alipay verification public key.
