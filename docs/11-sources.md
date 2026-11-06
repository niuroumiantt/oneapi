# 资料与核验来源

检索日期为 2026 年 11 月 6 日。以下均为政府、服务商或项目官方资料。法规适用、供应商合同和软件许可需要结合实际经营与锁定版本确认；动态页面不代表为本项目提供了个别许可。

## S01

互联网信息服务管理办法，司法部行政法规库。[官方文本](https://xzfg.moj.gov.cn/front/law/detail?LawID=1756)。用于区分经营许可与非经营备案，不能单独确定本项目业务分类。

## S02

生成式人工智能服务管理暂行办法，国家网信办。[官方文本](https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm)。用于公众服务适用、API 方式、内容与用户权益等基本义务。

## S03

2026 年 7 月至 8 月生成式人工智能服务备案公告，2026 年 9 月 14 日发布。[官方公告](https://www.cac.gov.cn/2026-09/14/c_1791136833136332.htm)。说明调用已备案模型能力的应用/功能登记及相关信息展示。

## S04

人工智能生成合成内容标识办法，国家网信办等部门。[官方文本](https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm)。用于显式、隐式标识与导出等设计边界。

## S05

促进和规范数据跨境流动规定，国家网信办。[官方文本](https://www.cac.gov.cn/2024-03/22/c_1712776611775634.htm)。不同数据及主体情形适用不同出境机制，部分豁免不代表免除全部个人信息义务。

## S06

禁止传销条例，司法部行政法规库。[官方文本](https://xzfg.moj.gov.cn/front/law/detail?LawID=148)。用于审查加入资格收费、发展人数计酬及上下线业绩计酬等渠道结构。

## S07

开具发票时购买方需要提供哪些信息，国家税务总局青岛市税务局。[官方问答](https://qingdao.chinatax.gov.cn/ssfg2019/cjwt/zzs/202501/t20250109_92048.html)。用于个人与企业开票资料区别，不推导本项目具体税率或开票时点。

## S08

Stripe Determine and configure the merchant of record。[官方文档](https://docs.stripe.com/connect/merchant-of-record)。以实际商业关系确定交易责任主体，然后匹配支付配置。

## S09

Stripe Billing credits。[官方文档](https://docs.stripe.com/billing/subscriptions/usage-based/billing-credits)。预付/促销额度的用途限制及账单确定时应用的行为，不等同每请求实时余额守卫。

## S10

Stripe Receive events in your webhook endpoint。[官方文档](https://docs.stripe.com/webhooks)。签名、重复投递、乱序、重试和异步处理。

## S11

Stripe Idempotent requests。[官方文档](https://docs.stripe.com/api/idempotent_requests)。出站请求幂等与其适用边界。

## S12

美国司法部 Data Security Program。[项目说明](https://www.justice.gov/nsd/data-security)；[官方 FAQ](https://www.justice.gov/nsd/media/1415006/dl)。用于相关数据、访问和交易限制的判断，不能简化为所有中美 API 请求禁令。

## S13

Stripe Collect tax in the United States。[官方文档](https://docs.stripe.com/tax/supported-countries/united-states)。销售税关联、地区登记与配置流程；具体税务结论由适用州规则和专业判断确认。

## S14

California Privacy Protection Agency FAQ。[官方问答](https://cppa.ca.gov/faq)。CCPA 适用条件、企业联系人/员工及服务提供者义务。

## S15

BIS Entity List。[官方清单](https://www.bis.gov/node/17028)。已核对北京智谱华章及 Zhipu AI 别名条目。仅支持对实际交易进行 EAR 核查，不等同 OFAC 全面制裁判断。

## S16

DeepSeek Open Platform Terms of Service。[官方条款](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)。API 集成与下游责任、账号和密钥等条款；不能代替本项目具体转售范围确认。

## S17

Z.ai Terms of Use 及 API 附加条款。[官方条款](https://docs.z.ai/legal-agreement/terms-of-use)。国际平台主体及服务安排，应与大陆智谱平台合同分别核查。

## S18

DeepSeek API 文档。[官方入口](https://api-docs.deepseek.com/)。精确型号、参数及价格以接入时实际文档和合同为准。

## S19

GLM 接入资料。[Z.ai 标准 API](https://docs.z.ai/api-reference/introduction)；[智谱大陆快速开始](https://docs.bigmodel.cn/cn/guide/start/quick-start)。区分标准 API 与个人/团队编码订阅产品。

## S20

LiteLLM。[核心许可证](https://raw.githubusercontent.com/BerriAI/litellm/main/LICENSE)；[企业目录许可证](https://raw.githubusercontent.com/BerriAI/litellm/main/enterprise/LICENSE.md)；[企业功能说明](https://docs.litellm.ai/docs/enterprise)。核心与企业目录许可分开，实际采用需锁定版本。

## S21

New API。[官方项目与许可说明](https://doc.newapi.pro/en/wiki/project-introduction/)；[许可证](https://github.com/QuantumNous/new-api/blob/main/LICENSE)。AGPL、商业条款及品牌相关要求需结合实际版本审核。

## S22

Keycloak。[官方功能介绍](https://www.keycloak.org/)；[许可证](https://raw.githubusercontent.com/keycloak/keycloak/main/LICENSE.txt)。用于 OIDC、身份联邦和 MFA 候选能力。

## S23

UI 组件许可。[shadcn/ui](https://raw.githubusercontent.com/shadcn-ui/ui/main/LICENSE.md)；[TanStack Table](https://raw.githubusercontent.com/TanStack/table/main/LICENSE)。用于成熟界面和表格组件复用。

## S24

广东省通信管理局，在线数据处理与交易处理业务。[官方业务分类说明](https://gdca.miit.gov.cn/bsfw/bszn/jyxk/dxywflml/art/2021/art_5d50bf1fa6174629874fdc1227ecb07d.html)。用于区分 EDI 等业务概念，不直接认定本项目必需或无需某许可。

## S25

非银行支付机构监督管理条例。[官方转载文本](https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2024/art_770e9bc7aba246f78c8f2cf1d614a364.html)。用于支付业务和许可边界；平台预付安排仍需结合其他规则判断。

## S26

FTC Disclosures 101 for Social Media Influencers。[官方说明](https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers)。用于推广佣金、免费权益等利益关系的清晰披露。

## 已完成与尚未完成的验证

已完成：用户需求与截图核对、官方资料研究、架构和业务规则交叉审阅、设计文档整理。未完成：真实供应商商业合同审阅、实际账号接入测试、负载测试、支付商户生产审批、个别法律/税务意见、生产安全验证。
