# DeepSeek / GLM 模型广场与八折参考价交接

## 已完成

- 2026-11-09 将个人空间改为紧凑工作台，含模型市场、我的接入、API 密钥、用量账单四个原位切换栏目；余额读取真实个人账本，空用量保持空态。
- 模型广场只展示 DeepSeek Flash、DeepSeek V4 Pro、GLM-5.3、GLM-5.3-Flash 四个官方公开型号。标明模型 ID、适用能力、上下文、速度验收状态、供应验收状态。
- 价格源为 DeepSeek 中文定价文档与智谱中文 API 定价文档；按各计费项官网人民币价乘 0.8 显示平台参考价，单位元 / 1M Token。DeepSeek 高峰、空闲时段分列；输入缓存命中、未命中与输出分列。示例计算器复用同一模型价表。
- 去掉内部付费准备页中已过时的美元示例价。
- 前端代码版本 `9f2f52e14a98ba24fe61a29a9bf162797ca09274` 已推送到 `codex/phase-one-launch-design`，静态站点通过 infra 发布器部署到 oneapi.glocalstorage.cn；公开 `release.json` 已核对为该 SHA，哈希脚本包含新型号和折扣逻辑。

## 验证

- `node --check web/app.js`、`node --check web/identity.js`、`git diff --check` 通过；静态发布包构建通过。
- 本地浏览器截图检查过个人工作台与模型广场布局。
- `npm test` 的 10 项无数据库测试通过；15 项服务测试因本机 PostgreSQL 未启动而 `ECONNREFUSED 127.0.0.1`，未发现本次前端变更引起的测试失败。
- `/api/status` 仍为 `payments_enabled=false`、`inference_enabled=false`；本次只发布静态页面。

## 继续前必须完成

1. 核对上游合同允许转售这些型号，验证实际模型版本、能力、速度与官方基线；不能先宣传“与官网完全一样”。
2. 用上游采购价核算 8 折售价的毛利，并确定价格版本、变更生效时间、缓存统计及高峰时段判定。
3. 接通并验收商户、收款、订单、逐笔用量与扣费账本后，再开放购买和平台 API Key。
4. 上线真实调用后，从交易记录生成逐模型速度、成功率和用量，不在市场页面填演示数字。

官方来源：<https://api-docs.deepseek.com/zh-cn/quick_start/pricing/>；<https://docs.bigmodel.cn/cn/guide/start/pricing>。
