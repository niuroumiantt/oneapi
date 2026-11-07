# 供应商验收报告交接

2026-11-07，oneapi；功能分支 `codex/phase-one-launch-design`。

## 本阶段结果

- 内部 `#ops/supply/<supplier-id>` 的供应产品详情新增“验收统计”。供应或平台管理员登记已完成测试的时间窗、样本数、成功数、首 Token 和完整耗时 p95、用量账单核对、结论、HTTPS 证据及问题说明。报告不可编辑，按时间倒序保留最近 50 条。
- `#ops/products` 读取每款商品对应供给的最新报告，显示样本结果与阶段。人工报告通过只进入“待审批”，不改变 `sale_ready=false`，公开模型广场和付款仍关闭。
- 新增 `supplier_validation_runs` 表、员工专用详情/汇总/新增接口和审计。平台管理员、供应岗位可写；运营、财务可读；匿名及客户身份不能访问。校验样本边界、时间窗、延迟及 HTTPS 证据。
- 未接入供应商自动探测、采购合同、商户、API Key、真实用量或账单。生产目前 0 条验收报告，不能把数据空缺解释成通过。

## 发布与验收

- 功能提交 `17bccf05dcb0951ccda89bc6cfb494aaeadd2922` 已推送并部署至独立 `oneapi.glocalstorage.cn`，后端镜像 `oneapi-identity:17bccf0`；静态包 SHA256 `e42cb5cfe7cbbb7161bf43838adbaa072a88a742b40b04a79a6de08b4bdf53f3`。
- 迁移前数据库备份 `/srv/oneapi-backups/oneapi-20261107T042212Z.dump`；旧配置备份 `/srv/oneapi-config/compose.before-17bccf0.env` 与 `/srv/oneapi-config/identity.before-17bccf0.env`。旧镜像仍在服务器。迁移为加法，回滚应用时保留新表和数据。
- 隔离 PostgreSQL 27/27 测试通过；线上前后端版本相同，新 API 容器 healthy；匿名验收接口 401，旧 `api.glocalstorage.cn` 200。员工登录后的生产页面仍需有员工会话时复核；未模拟生产权限。

## 接下来

1. 供应方提供合同、销售授权、API 文档、SLA、可用测试账户及用量账单样本后，做受控凭据引用、自动连通/能力/计量探测和证据复核。
2. 商品发布门禁应分别核对供给授权、技术验收、成本、客户价格、地区与有效期；通过前不出现在公开可购买目录。价格草稿和促销草稿已经具备历史版本与绑定关系，可接到审批后的商品版本。
3. 商户开通后按订单、支付回调验签、幂等资金账本、退款和对账顺序接入，再接真实调用与企业成员预算。促销兑换和计佣只消费已结算的真实交易事件。
