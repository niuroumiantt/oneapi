# 模型广场价格对照与 Skills 广场交接（2026-11-28，m5）

## 已完成

- 三款模型并排显示厂商官方 API 价与 Semifly 个人余额促销价。DeepSeek Flash 高峰和空闲切换同时更新两列。模型对比表同步展示两组金额，价格卡可直接打开个人充值页。
- 价格快照只公开广场内已配置的个人消费折扣，从与个人钱包扣费相同的 `CUSTOMER_MODEL_USAGE_PRICES` 读取，按网关单价计算。厂商新快照和网关定价基准有差异时，两列仍各取实际数据，隐藏折数标记。
- Skills 广场移除顶部核验条与分页，保留固定栏目标签，目录 40 项连续渲染。全部详情页提供 WorkBuddy、Qoder 桌面版、Qoder IDE、Codex 等工具的安装和调用指引。

## 验证与上线前事项

- 五折配置的本地 API 预览已在桌面和手机验证价格、标签切换、目录和安装说明。未在 WorkBuddy 或 Qoder 安装全部 Skills，未发生实际付款或模型扣费。
- 上海生产 API 容器的 `CUSTOMER_MODEL_USAGE_PRICES` 为空。普通个人余额的上线折扣需确认。如果五折限定优惠码，应按相应的充值条件展示。此次未修改生产配置或部署。
- 官方文档：[DeepSeek 定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) · [智谱定价](https://docs.bigmodel.cn/cn/guide/start/pricing) · [WorkBuddy Skills](https://www.tencentcloud.com/zh/document/product/1316/84503) · [Qoder 桌面版](https://docs.qoder.com/qoder/skills) · [Qoder IDE](https://docs.qoder.com/extensions/skills)。

## 入口

- `web/model-explorer.js`、`web/model-showcase.css`、`server/src/official-price-watch.mjs`
- `prototypes/skills/index.html`、`prototypes/skills/skills.js`、`prototypes/skills/skills.css`
