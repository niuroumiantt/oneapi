> 当前实现：个人/企业真实邮箱身份、企业成员权限、员工 OIDC/MFA 与岗位授权。详见 [真实身份与权限](docs/phase-1/13-live-identity.md)。模型调用、付费和促销尚未开放。

# OneAPI 模型 API 交易平台

2026-11-06 部署决定更新：用户要求保留旧平台并独立建设；新版入口改为 **oneapi.glocalstorage.cn**，旧 api.glocalstorage.cn 保持原有服务。参见 [阿里云部署说明](docs/deployment/aliyun.md)。

OneAPI 是面向个人开发者和企业客户的模型 API 商业平台。本仓库保存产品设计、业务规则与静态交互预览源码。仓库名不是最终品牌，也不代表已经采用同名第三方网关。

**当前阶段：独立阿里云 UI 预览，2026 年 11 月 6 日。已增加三类入口、企业成员权限与预算管理交互；真实认证、供应接入、收款、调用和促销尚未上线。**

## 当前先读：五条并行主线

当前重点依次为员工/客户登录与权限、供应商与产品验证、模型广场与产品设计、付费、促销。模块按依赖并行推进；中国阿里云与海外 AWS 的环境也从首期并行建设。中国区主体为深圳市格洛可半导体有限公司，新版独立入口为 oneapi.glocalstorage.cn（旧 api.glocalstorage.cn 保留），首轮直接开放公众注册；实际开放须完成业务验收。

| 文档 | 内容 |
| --- | --- |
| [五模块实施进度](docs/phase-1/10-implementation-tracker.md) | 每个模块已完成内容、下一步真实实现与开放验收 |
| [0.4 上线基线](docs/phase-1/08-launch-baseline.md) | 用户确认的风格、五模块边界、主体/域名与公开注册验收 |
| [跨项目视觉参考包](design/spectrum/README.md) | 设计 token、可运行参考、glocal dmg 改造交接 |
| [当前优先级与验收](docs/phase-1/00-priorities.md) | 五条工作线、共同底座、里程碑与后置范围 |
| [供应商与供应商产品管理](docs/phase-1/07-supplier-operations.md) | 货源与准入、采购价格、资金与容量、质量故障、需求和对账 |
| [登录与身份](docs/phase-1/01-identity-and-login.md) | 微信、Google、GitHub、X；个人/企业、绑定、恢复与携码回跳 |
| [模型广场与 Agent 接入](docs/phase-1/02-models-and-agent-onboarding.md) | 两家族入口，Cursor/TRAE/Qoder/WorkBuddy 配置与兼容边界 |
| [支付、促销码与返佣](docs/phase-1/03-payments-and-promotions.md) | 微信/支付宝/Stripe，新老客优惠、价格口径与计佣 |
| [阿里云 / AWS 与共享发布](docs/phase-1/04-regional-delivery.md) | 不同域名和数据，同一核心代码与版本化部署 |
| [当前官方模型目录](docs/phase-1/05-model-catalog-snapshot.md) | DeepSeek 与智谱完整分组、当前/历史型号及协议差异 |
| [本轮官方来源](docs/phase-1/06-sources.md) | 来源、文档冲突与尚未实际验证的边界 |

0.2 取代旧版串行排期解释、“美国区整体后建”和默认仅新客促销的假设。既有 0.1 PDF 是历史设计版本；当前范围以本目录及决定记录为准。

0.3 将供应商与供应产品提升为第五条首期主线，补齐采购、供量、质量和结算的完整运营流程；供应商自助入驻仍后置，平台内部供应管理从首期建设。

## 产品方向

一个产品面向中国和美国市场，先从中国落地，首批模型家族为 DeepSeek 和 GLM。覆盖供应商、模型市场、个人与企业客户、支付计费、采购 PO 与发票、代理分销、推荐返佣、客户控制台和员工运营后台。

采用共用代码与设计系统、地区独立运营的总体建议。平台先以自身名义销售获授权服务，商业账本与模型网关分开；多卖家自助入驻和复杂多层结算作为后续独立阶段。

## 三条工程原则

1. 每段代码职责清楚，能对应实际用例、必要保护或验证。
2. 名称能表达业务动作、对象、单位和范围。
3. 优先复用成熟能力，自研本平台的商业与合规规则。

## 总体业务蓝图

| 文档 | 内容 |
| --- | --- |
| [五模块实施进度](docs/phase-1/10-implementation-tracker.md) | 每个模块已完成内容、下一步真实实现与开放验收 |
| [设计基线](docs/00-requirements.md) | 已确认要求、产品定位与商业起点 |
| [18 个模块](docs/01-product-and-modules.md) | 模块边界、职责和首期范围 |
| [用户企业与渠道](docs/02-users-and-partners.md) | 组织、权限、四种渠道及推荐关系 |
| [资金计费与采购](docs/03-billing-and-settlement.md) | 充值、预占、费用、退款、PO、开票与对账 |
| [供应商与网关](docs/04-suppliers-and-gateway.md) | 模型分层、质量、授权及路由 |
| [中美区域与合规](docs/05-regions-and-compliance.md) | 区域边界、法规事实与上线证据 |
| [技术架构](docs/06-technical-architecture.md) | 部署、数据、网关与成熟组件复用 |
| [命名与工程](docs/07-naming-and-engineering.md) | 术语、目录、函数、事件与代码质量 |
| [视觉与页面](docs/08-ui-and-experience.md) | 前台、客户、企业、渠道与密集后台 |
| [实施与验收](docs/09-delivery-and-acceptance.md) | 阶段、关键场景、团队与规划估计 |
| [决定与待办](docs/10-decisions-and-open-questions.md) | 已确认要求、建议状态与待决定事项 |
| [官方来源](docs/11-sources.md) | 26 组研究依据与验证边界 |

## 方案边界

技术默认候选为模块化 TypeScript 业务服务、独立 LiteLLM OSS 网关、PostgreSQL 业务主账本和地区化运行环境。候选不等于已经通过验证；供应商授权、数据路径、支付主体、软件许可证和真实接口测试都是上线前的实际输入。

所有具体价格、佣金比例、模型型号、最终品牌和上线日期以之后记录的正式决定为准。设计中的示例金额和视觉数据只说明规则。

## 接下来

先执行 M0：固定五条主线的共享契约、准备两区域名与应用资格、核实首批供应产品的授权/价格/容量，并验证真实模型和客户端组合。页面、身份、付款、促销和供应后台按已定义接口并行推进。新会话从本页与“决定与待办”继续；每个重要变化更新文档并留下 Git 提交。

企业工作台的新方案（含 WorkBuddy / Codex / Claude Code 官方资料对比、三入口、组织权限与可调拨预算）：[企业工作台设计](docs/phase-1/09-enterprise-workspace.md)。独立预览已部署到 https://oneapi.glocalstorage.cn ，实际部署版本和边界见 [部署交接](docs/handoff/oneapi-aliyun.md)。

本轮体验入口：[/#login](https://oneapi.glocalstorage.cn/#login)、[/#enterprise](https://oneapi.glocalstorage.cn/#enterprise)。规则测试：在项目目录使用 Node 运行 tests/enterprise-core.test.cjs。所有额度操作仅作用于当前页面的内存样例。
