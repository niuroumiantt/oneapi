# OneAPI / semifly.ai

面向个人与企业的模型 API 平台。仓库规范名为 `oneapi`，中国区入口为 https://oneapi.glocalstorage.cn；旧 api.glocalstorage.cn 独立保留。

## 当前状态（2026-11-14）

已有真实邮箱身份、企业成员权限、员工 OIDC/MFA、供应商验收与用量对账、内部额度调用、支付宝/微信支付接入和经营后台。本次客户付费分支补齐购包报价、折扣冻结、普通客户 Key、官价扣费与在线按包退款；**代码和测试完成不代表已经发布或完成真实商户收退款验收**。

现行规则：购买时按符合条件的最优单条优惠付款，不叠加；到账的是官价面额；调用按官方价格扣面额。未用部分按 `floor(剩余面额 / 原面额 × 实付现金分 × 85%)` 原路退回；已开具且未作废/红冲的销项发票阻止退款。详见[计费规则](docs/handoff/list-credit-billing.md)。

## 当前实现

- 原生 HTML/CSS/JavaScript：公网、个人/企业工作台和员工后台，复用现有密钥、用量、账单、支付与财务页面。
- Node.js / Express 模块化服务，Better Auth 客户身份、Authentik 员工身份，PostgreSQL 业务账本。
- 现有自建模型网关统一承接内部额度和客户付费请求，共用协议、流式响应、路由和输出保护。两种额度、Key 与调用账本分开。
- Caddy、容器和静态包发布。React/Next.js、LiteLLM 是早期候选，未成为当前运行依赖。

## 从这里继续

| 文档 | 用途 |
| --- | --- |
| [本轮交接](docs/handoff/customer-credit-flow.md) | 已实现、测试、发布门槛与未完成项 |
| [现行计费规则](docs/handoff/list-credit-billing.md) | 面额、实付、优惠及退款 |
| [实际架构](docs/06-technical-architecture.md) | 数据流和模块边界 |
| [真实身份](docs/phase-1/13-live-identity.md) | 客户及员工权限 |
| [供应商验收](docs/phase-1/19-supplier-api-lab.md) | 上游验证与成本证据 |
| [部署交接](docs/handoff/oneapi-aliyun.md) | 中国区部署历史 |

`docs/phase-1/` 及其他早期蓝图保留设计背景；涉及当前实现与价格的冲突以本页、现行计费规则和本轮交接为准。AWS、分销返佣和企业付费额度分配等蓝图不能视为已上线功能。

测试：在独立空测试数据库运行 `TEST_DATABASE_URL=postgresql://… npm test`。构建静态包：`python3 scripts/build_static.py --out /tmp/oneapi.tar.gz`。不要用生产数据库跑测试。
