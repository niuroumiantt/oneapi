# 充值系统第一步交接

2026-11-07，功能源码 `09b6bd4b2d6f48428a86d5b2c64a99906c8f111d` 已推送并部署到独立 `oneapi.glocalstorage.cn`。后端镜像 `oneapi-identity:09b6bd4`，静态包 SHA256 `b9bcc7b3d1e429f2d66538f78e21391632d30087267be24d95d7cbf6383615b7`。

## 本阶段结果

- 个人空间新增“真实余额与充值状态”；企业管理台“预算与用量”新增企业资金入口。两种身份共用页面规则，账户物理隔离。企业资金仅有效企业代表人可读。
- 新增 `billing_accounts` 和追加式 `billing_ledger`，与 `demo_*` 模拟账本分开。账本对 UPDATE/DELETE 拒绝。真实余额按人民币分的整数字符串返回与显示。
- 商户未开通，真实账户只读；无充值下单或入账接口。页面明确“收款尚未开放”“计划最低充值 ¥5”。支付、推理及业务就绪开关仍为 `false`。
- 隔离 PostgreSQL 测试 29/29 通过。公网 `/release.json` 与 `/api/status` 同版本，匿名读真实余额返回 401，旧 `api.glocalstorage.cn` 返回 200。

## 生产备份及下一步

迁移前备份：`/srv/oneapi-backups/oneapi-before-09b6bd4.dump`、`/srv/oneapi-config/compose.before-09b6bd4.env`、`/srv/oneapi-config/identity.before-09b6bd4.env`。旧镜像保留；`016_billing_foundation.sql` 为加法迁移，回滚应用时保留新表。

用户确认微信/支付宝商户尚未开通，DeepSeek Flash 客户价尚未确定。下一步根据 `docs/phase-1/20-recharge-system.md` 建充值订单和商户适配器；先核实价格、授权和支付渠道，再在隔离商户环境验签、幂等、对账、原路退款及真实调用。用户提出的 15% 退款手续费暂不执行，需先核验条款与渠道可行性。
