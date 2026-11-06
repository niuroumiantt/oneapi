# 命名规则与工程原则

## 代码用途清楚

每个模块围绕一个业务责任组织。交付代码必须能对应真实用例、异常处理、测试或必要基础设施。模板生成的未使用页面、示例接口和无用依赖应删除。

“每一行都有用”不等于压缩成最少行数。校验、权限、日志、测试、错误处理和解释重要业务原因的注释都具有用途。不要为了少写几行把计费、支付和佣金塞进一个巨大函数。

首期不建立通用插件市场、万能规则语言或可配置到无法理解的框架。重复一次未必需要抽象；当相同职责稳定出现并有真实复用者时再提取公共能力。

## 统一业务词汇

| 中文 | 规范名称 | 含义边界 |
| --- | --- | --- |
| 用户 | User | 自然人的登录身份 |
| 组织 | Organization | 个人或企业工作区 |
| 成员 | Membership | 用户在某组织的关系和角色 |
| 计费账户 | BillingAccount | 特定主体、区域和币种下的财务账户 |
| 供应商 | Supplier | 采购合同对方 |
| 供应合同 | SupplierContract | 采购授权、价格引用、付款及服务条款 |
| 采购账户 | SupplierAccount | 实际上游计费和限额账户，不等同一把 Key |
| 共享容量池 | SupplyCapacityPool | 供方确定的账户/模型等限额作用域 |
| 采购价版本 | SupplierRateCardVersion | 有生效时间、币种、单位和适用条件的采购规则 |
| 供应成本记录 | SupplierCostEntry | 一次尝试的暂估/确认成本及更正关联 |
| 上游端点 | ProviderEndpoint | 实际调用和数据处理路径 |
| 可售模型商品 | ModelProduct | 平台向客户销售的服务 |
| 采购方案 | SupplierModelOffer | 供应商、模型、成本及授权组合 |
| 支付订单 | PaymentOrder | 某笔收款意图与状态 |
| 用量费用 | UsageCharge | 根据计量与价格得到的客户费用 |
| 商业账单 | BillingInvoice | 应收和付款跟踪 |
| 税务发票 | TaxInvoice | 对应地区的税务文件 |
| 推广员 | Affiliate | 推荐并取得佣金 |
| 销售代理 | SalesAgent | 按授权协助销售 |
| 分销商 | Distributor | 采购转售 |
| 佣金计提 | CommissionAccrual | 依据合格交易计算的渠道费用 |

避免在核心代码中用 Agent 同时表示 AI 智能体和销售代理。销售角色用 SalesAgent；AI 调用方如以后存在，另用 AiAgent。

## 文件函数字段事件

文件与目录使用 kebab-case；类型使用 PascalCase；函数、变量使用 camelCase；数据库表与列使用 snake_case；常量使用 UPPER_SNAKE_CASE。统一规则优先于个人偏好。

| 避免的名称 | 推荐名称 | 好处 |
| --- | --- | --- |
| handle、process、doIt | reserveUsageBudget | 说明具体动作 |
| changeMoney | postPaymentCredit | 说明金额来源和记账用途 |
| calc | calculateUsageCharge | 明确计算对象 |
| type、status 的裸数字 | payment_status = pending/paid/refunding | 可直接理解状态 |
| agentInfo | salesAgentAgreement | 区分人员、组织和合同 |
| invoice | billingInvoice 或 taxInvoice | 区分商业应收和税务文件 |
| data1、obj、temp | supplierCostSnapshot | 说明数据含义 |
| price | inputTokenPriceMicrosPerMillion | 说明单位与维度 |

事件名称描述已经发生的事实，例如 payment.confirmed.v1、usage.finalized.v1、refund.confirmed.v1、commission.approved.v1。命令描述要执行的动作，例如 approveRefund、rotateProviderCredential。事件含 event_id、aggregate_id、occurred_at、schema_version 和幂等关联，不携带无必要的提示词或密钥。

布尔值用 is、has、can 开头。时间字段写明 at/seconds/milliseconds，数据库时间统一存 UTC，界面按用户地区显示。所有金额字段有币种和精度约定；所有费率说明是比例、小数还是基点。

## 建议的代码位置

| 路径 | 用途 |
| --- | --- |
| apps/web | 官网、模型市场、客户与伙伴界面 |
| apps/admin | 员工运营界面 |
| apps/commerce-api | 业务 API 入口 |
| apps/worker | 异步业务任务 |
| packages/identity | 业务身份映射与授权 |
| packages/organizations | 客户、企业和成员关系 |
| packages/suppliers | 供应商、采购合同/账户/产品、价表、资源、通道质量与对账规则 |
| packages/model-catalog | 模型、版本与商品 |
| packages/pricing | 价格规则及快照 |
| packages/metering | 请求计量与费用计算 |
| packages/ledger | 分录、预占与冲正 |
| packages/payments | 收款、退款与支付适配 |
| packages/procurement | 报价、合同、PO 与授信 |
| packages/invoicing | 账单、税务文件与核销 |
| packages/partners | 代理、分销和客户归属 |
| packages/promotions | 推荐码与优惠 |
| packages/commissions | 计提、结算与追回 |
| packages/policies | 地区、数据和发布准入策略 |
| packages/ui | 实际复用的视觉组件 |
| packages/contracts | API schema、共享类型与事件契约 |
| infra/cn 与 infra/us | 各地区基础设施与发布配置 |
| docs | 需求、架构、业务规则和决定记录 |

这是一张职责地图，尚未创建空实现目录。首期可把较小模块放在 commerce-api 的模块目录中；只有确有共享边界时才提取独立 package，避免为了目录漂亮增加开发负担。

## 依赖和质量规则

接口层负责协议及输入校验，应用层编排用例，领域层承载业务规则，适配层连接支付、网关与数据库。领域规则不依赖 UI 组件或特定支付 SDK。

跨模块通过明确接口和事件协作，不直接修改别人的表。金额、权限与状态转换集中于领域服务，不分散在页面、SQL 和后台脚本中。

依赖锁定版本，登记来源、许可证、更新负责人和替换成本。优先选择有明确维护记录且适合本项目的能力；依赖多不代表复用做得好。

测试优先覆盖金额、并发、幂等、租户隔离和供应商协议；文案和普通样式不为凑覆盖率编写大量镜像测试。评审说明业务目的、变化后的行为、验证证据和剩余限制。
