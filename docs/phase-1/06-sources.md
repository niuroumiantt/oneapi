# 首期方案的官方来源与核验边界

核验日期：2026-11-06。引用为供应商与客户端官方文档，以及官方直接集成资料；支持相应产品事实，不代表 OneAPI 已获得供应授权、开通商户、部署身份系统或完成真实客户端验收。设计建议、预算和优先级由本项目提出。

## identity

| 编号 | 资料 | 用途 |
| --- | --- | --- |
| I01 | [腾讯官方 PC 微信登录（2026-08-26）](https://cloud.tencent.com/document/product/1441/62649) | 登录、身份标识、权限或复用边界 |
| I02 | [腾讯官方微信网页登录（2026-08-26）](https://cloud.tencent.com/document/product/1441/62650) | 登录、身份标识、权限或复用边界 |
| I03 | [微信支付官方参数说明（2026-10-13）](https://pay.wechatpay.cn/doc/v3/partner/4012081935) | 登录、身份标识、权限或复用边界 |
| I04 | [腾讯官方微信授权 API（2026-10-26）](https://cloud.tencent.com/document/product/1441/68675) | 登录、身份标识、权限或复用边界 |
| I05 | [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) | 登录、身份标识、权限或复用边界 |
| I06 | [Google 服务端验证 ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token) | 登录、身份标识、权限或复用边界 |
| I07 | [GitHub OAuth 授权流程](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) | 登录、身份标识、权限或复用边界 |
| I08 | [GitHub OAuth 最佳实践](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app) | 登录、身份标识、权限或复用边界 |
| I09 | [GitHub 用户端点](https://docs.github.com/en/rest/users/users#get-the-authenticated-user) | 登录、身份标识、权限或复用边界 |
| I10 | [GitHub 邮箱端点](https://docs.github.com/en/rest/users/emails) | 登录、身份标识、权限或复用边界 |
| I11 | [X OAuth 2.0 + PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code) | 登录、身份标识、权限或复用边界 |
| I12 | [X 已认证用户端点](https://docs.x.com/x-api/users/get-my-user) | 登录、身份标识、权限或复用边界 |
| I13 | [X 权限映射](https://docs.x.com/fundamentals/authentication/guides/v2-authentication-mapping) | 登录、身份标识、权限或复用边界 |
| I14 | [Keycloak 官方管理指南](https://www.keycloak.org/docs/latest/server_admin/) | 登录、身份标识、权限或复用边界 |
| I15 | [阿里云 IDaaS CIAM 社交认证源](https://help.aliyun.com/zh/idaas/ciam/user-guide/social-media) | 登录、身份标识、权限或复用边界 |

微信开发者原站部分页面本轮无法直接抓取，身份范围用微信支付官方说明、腾讯官方授权接口及阿里云认证源文档交叉核验。实际网站/公众号应用资质、回调域、scope 与商户绑定仍须开通时确认。腾讯 OneID 页面有 scope 描述冲突，Keycloak 旧段落有 GitHub 刷新能力旧说明；实现以相应身份提供方现行文档和选定版本测试为准。

## agents

| 编号 | 资料 | 用途 |
| --- | --- | --- |
| A01 | [Cursor BYOK](https://cursor.com/help/models-and-usage/api-keys) | 客户端配置、限制及导入机制 |
| A02 | [Cloudflare 官方 Cursor 集成](https://developers.cloudflare.com/ai-gateway/integrations/coding-agents/cursor/) | 客户端配置、限制及导入机制 |
| A03 | [OpenAI 官方 Cursor 使用说明](https://help.openai.com/en/articles/20001506-using-openai-models-in-cursor) | 客户端配置、限制及导入机制 |
| A04 | [TRAE 中国官方自定义模型](https://docs.trae.cn/ide_custom-models) | 客户端配置、限制及导入机制 |
| A05 | [TRAE 海外官方模型文档](https://docs.trae.ai/ide/models) | 客户端配置、限制及导入机制 |
| A06 | [Qoder 独立应用](https://docs.qoder.com/qoder/custom-models) | 客户端配置、限制及导入机制 |
| A07 | [Qoder CN 独立应用](https://docs.qoder.cn/qoder/custom-models) | 客户端配置、限制及导入机制 |
| A08 | [Qoder IDE](https://docs.qoder.com/user-guide/chat/custom-models) | 客户端配置、限制及导入机制 |
| A09 | [Qoder CLI 官方发布记录](https://changelog.qoder.com/cli) | 客户端配置、限制及导入机制 |
| A10 | [Qoder CLI CN 当前指南](https://docs.qoder.cn/en/cli/custom-models) | 客户端配置、限制及导入机制 |
| A11 | [WorkBuddy 中国官方模型设置](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model) | 客户端配置、限制及导入机制 |
| A12 | [WorkBuddy AI 海外官方模型设置](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model-Configuration) | 客户端配置、限制及导入机制 |
| A13 | [Cursor 官方 deeplink](https://cursor.com/docs/reference/deeplinks) | 客户端配置、限制及导入机制 |
| A14 | [Qoder IDE 官方 deeplink](https://docs.qoder.com/user-guide/deeplink) | 客户端配置、限制及导入机制 |

A02 是 Cloudflare 对 Cursor 的官方直接集成指南，模式与协议结论仍需按实际 Cursor 版本验证。TRAE 海外文档正文与 Qoder 部分国际 CLI 页面本轮提取不足，不能据此给出已验证标签。中国与海外 WorkBuddy 的配置文件描述不完全相同，首版使用 GUI 指引。

## models

| 编号 | 官方资料 |
| --- | --- |
| D1 | [官方文档](https://api-docs.deepseek.com/) |
| D2 | [官方文档](https://api-docs.deepseek.com/api/list-models/) |
| D3 | [官方文档](https://api-docs.deepseek.com/updates/) |
| D4 | [官方文档](https://api-docs.deepseek.com/api/create-response/) |
| D5 | [官方文档](https://api-docs.deepseek.com/api/create-message/) |
| D6 | [官方文档](https://api-docs.deepseek.com/quick_start/pricing/?model_version=DeepSeek-V4-Pro-0813) |
| G1 | [官方文档](https://docs.bigmodel.cn/cn/guide/start/model-overview) |
| G2 | [官方文档](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3) |
| G3 | [官方文档](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash) |
| G4 | [官方文档](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.2) |
| G5 | [官方文档](https://docs.bigmodel.cn/api-reference/模型-api/对话补全) |
| G6 | [官方文档](https://docs.bigmodel.cn/cn/guide/start/pricing) |
| G7 | [官方文档](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction) |
| G8 | [官方文档](https://docs.bigmodel.cn/cn/guide/develop/claude/introduction) |
| G9 | [官方文档](https://docs.bigmodel.cn/cn/guide/develop/responses/introduction) |
| G10 | [官方文档](https://docs.bigmodel.cn/cn/coding-plan/notice/api-key-management) |
| G11 | [官方文档](https://docs.bigmodel.cn/cn/coding-plan/usage-notes) |
| G12a | [官方文档](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5v-turbo) |
| G12b | [官方文档](https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image) |
| G12c | [官方文档](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-ocr) |
| G12d | [官方文档](https://docs.bigmodel.cn/cn/guide/models/sound-and-video/glm-asr-2512) |
| G12e | [官方文档](https://docs.bigmodel.cn/cn/guide/models/sound-and-video/glm-tts) |
| G12f | [官方文档](https://docs.bigmodel.cn/cn/guide/models/video-generation/cogvideox-3) |
| G12g | [官方文档](https://docs.bigmodel.cn/cn/guide/models/embedding/embedding-3) |
| Z1 | [官方文档](https://docs.z.ai/api-reference/introduction) |
| Z2 | [官方文档](https://docs.z.ai/guides/vlm/glm-5.3-flash) |
| Z3 | [官方文档](https://docs.z.ai/api-reference/llm/chat-completion) |
| Z4 | [官方文档](https://docs.z.ai/devpack/overview) |
| Z5 | [官方文档](https://docs.z.ai/guides/llm/glm-5.3) |
| Z6 | [官方文档](https://docs.z.ai/guides/overview/pricing) |

D6 搜索索引与 canonical 抓取页面不完全一致，不用其单独决定现行价格。DeepSeek 部分历史公告对 Pro 路由有修订，当前目录按现行首调/模型列表并保留实际账户验证门槛。BigModel 价格页保留历史型号；Z.ai 型号页与标准 API 文档存在 coding/standard 基址差异，都须按实际采购凭据确认。

## payments

| 编号 | 官方资料 | 用途 |
| --- | --- | --- |
| PAY-01 | [微信支付产品](https://pay.wechatpay.cn/doc/v3/merchant/4012068590) | Native 与 JSAPI 场景 |
| PAY-02 | [微信 H5 支付](https://pay.wechatpay.cn/doc/v3/merchant/4012791832) | 外部手机浏览器与准入条件 |
| PAY-03 | [支付宝官方 Easy SDK API](https://github.com/alipay/alipay-easysdk/blob/master/APIDoc.md) | 电脑/手机网站支付、查询和退款接口 |
| PAY-04 | [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment.md?ui=full-page) | 付款确认、webhook 与重复履行 |
| PAY-05 | [Stripe Checkout](https://docs.stripe.com/payments/checkout) | 托管收银台与支付集成 |

## deployment

| 编号 | 官方资料 | 用途 |
| --- | --- | --- |
| DEP-01 | [阿里云通用网站 ICP 备案](https://www.alibabacloud.com/help/en/icp-filing/basic-icp-service/product-overview/icp-filing-requirements-for-a-regular-website) | 大陆服务器网站的备案与主体/接入信息 |
| DEP-02 | [GitHub deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) | 环境、秘密与发布约束 |
| DEP-03 | [GitHub Actions OIDC](https://docs.github.com/en/actions/concepts/security/openid-connect) | 与支持的云提供方交换短期凭据 |

## suppliers

0.3 补充核验：2026-11-06。以下支持供应管理的数据与接口设计，不证明已取得采购折扣、商用转售范围、保留容量或合同 SLA。

| 编号 | 官方资料 | 已核实的设计输入 |
| --- | --- | --- |
| SUP01 | [DeepSeek 限流与隔离](https://api-docs.deepseek.com/quick_start/rate_limit/) | 账户/模型共享并发、多 Key 不扩容、扩容入口、租户隔离与心跳 |
| SUP02 | [DeepSeek 余额 API](https://api-docs.deepseek.com/api/get-user-balance/) | 正式 GET /user/balance；币种、充值余额、未过期赠金及资金可用性 |
| SUP03 | [DeepSeek 错误码](https://api-docs.deepseek.com/quick_start/error_codes/) | 凭据、余额不足、限流、服务器错误及过载分类 |
| SUP04 | [DeepSeek 状态页](https://status.deepseek.com/) | 公共服务状态与事件入口，不能代替平台账户/地区实测或合同 SLA |
| SUP05 | [DeepSeek 当前价格](https://api-docs.deepseek.com/quick_start/pricing/) | 输入缓存命中/未命中、输出、峰谷时段与扣减顺序；具体价格以采购和生效时间核实 |
| SUP06 | [智谱错误码](https://docs.bigmodel.cn/cn/api/api-code) | HTTP 与业务码双层含义；1113 欠费、1302 速率、1305 过载；SSE 中途异常 |
| SUP07 | [智谱速率限制](https://docs.bigmodel.cn/cn/api/rate-limit) | 账户模型/权益限制、账户额度查询、扩容申请、账户限流与平台过载区分 |
| SUP08 | [智谱 API 定价](https://docs.bigmodel.cn/cn/guide/start/pricing) | 输入、缓存、输出、缓存存储与长度阶梯；限时免费不是永久零价 |
| SUP09 | [智谱费用问题](https://docs.bigmodel.cn/cn/faq/fee-issues) | 资源包适用和到期顺序、控制台财务、汇总账单下载与退款边界 |
| SUP10 | [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) | 原始 usage、缓存与输出明细关系，避免重复计量 |

本轮确认了 DeepSeek 公开余额 API 的文档，尚未以采购凭据实测。智谱已核实控制台查看费用与下载账单，未核实通用标准 API 的公开余额或全账户账单查询接口；先采用人工快照/官方文件导入，不使用未经确认的控制台私有接口。实际采购授权、合同报价、账户容量、账单格式/粒度、数据处理条件和支持承诺仍需取得正式证据。

DeepSeek 文档页脚公开支持邮箱，限流页有扩容申请；智谱速率和费用页提供相应控制台与申请入口。本轮没有联系供方、提交扩容、签约、充值或调用付费接口。

已完成：官方文档研究、需求重排、界面路径及数据/状态设计、仓库文档更新。尚未完成：真实模型调用、客户端版本矩阵测试、第三方登录应用审核、真实支付/退款、云部署及当地上线批准。已验证标签在实际证据具备后才能使用。
