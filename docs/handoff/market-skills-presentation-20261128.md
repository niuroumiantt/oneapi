# 模型广场与充值试算交接（2026-11-28，m5）

## 已完成

- 首页和模型广场的公开促销入口显示「限时促销」，链接到个人充值页。模型广场保留厂商官方 API 价、模型对比和 DeepSeek 高峰／空闲选择。公开价格接口仅提供官价观察快照。
- 个人充值页在金额和付款区下方展示本次实付、赠送、到账，以及每个模型折合的官价额度。各模型列出未命中输入、缓存命中、输出的官网单价与实付折算单价。DeepSeek 可切换空闲／高峰。
- 单价对比依据模型目录。官价额度及实付折算依据现有登录后充值报价。通用赠送和通用余额用量折扣共同影响折算结果。模型专属码使用报价的到账额度，避免重复折扣，且只显示对应模型。无效码提示回退到无代码报价。
- Skills 广场移除顶部核验条与分页，保留固定栏目标签，目录 40 项连续渲染。详情提供 WorkBuddy、Qoder 桌面版、Qoder IDE、Codex 等工具的安装和调用指引。

## 验证与发布状态

- 桌面和手机浏览器使用本机测试报价验证 ¥25、¥30、¥50、高峰／空闲、通用赠送、模型专属码和无效码。五折测试报价下实付 ¥50 折合各模型官价额度 ¥100。
- 上海生产 API 容器上次只读核对的 `CUSTOMER_MODEL_USAGE_PRICES` 为空。试算仍按账号实时报价展示。本次未修改生产折扣、未发布、未发生真实付款或扣费。
- 官方文档：[DeepSeek 定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) · [智谱定价](https://docs.bigmodel.cn/cn/guide/start/pricing) · [WorkBuddy Skills](https://www.tencentcloud.com/zh/document/product/1316/84503) · [Qoder 桌面版](https://docs.qoder.com/qoder/skills) · [Qoder IDE](https://docs.qoder.com/extensions/skills)。

## 入口

- 公开页面 `web/welcome.js`、`web/model-explorer.js`
- 充值试算 `web/identity.js`、`web/identity.css`、`POST /api/billing/quote`
- Skills `prototypes/skills/skills.js`、`prototypes/skills/skills.css`

## 充值价格视觉调整

2026-11-28 用户确认功能后要求重新设计。增加放大的原厂 Logo，官方价和 Semifly 价格各自使用完整边框。每个实付折算单价下显示官价百分比，按本次报价动态计算。移除充值试算长色条。桌面和手机验证金额、赠送、模型专属码及高峰切换通过，仍为本地测试预览。
