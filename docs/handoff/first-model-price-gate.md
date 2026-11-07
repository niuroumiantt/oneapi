# 首发型号内部价格复核交接

2026-11-07，源码 `5252678571fc73f4861f2d9cdf5fa5121b1b0758` 已推送并部署到独立的 `oneapi.glocalstorage.cn`。后端镜像 `oneapi-identity:5252678`，静态包 SHA256 `75bdae1b9d3abd918130c8d78d40f4ae64a8663ca694a479832f081684ed7150`。

## 已完成

- 内部新增价格草稿的独立复核。仅平台管理员或财务可审批，草稿作者不可自审；复核必须绑定最新商品复核、供给资料与通过的验收报告。结论和操作者进入审计记录。
- 内部商品页可看到最新价格状态并提交复核；付款准备页显示 DeepSeek 官网美元成本参考，明确不是 semifly.ai 客户价。
- 迁移前 oneapi 专用备份 `/srv/oneapi-backups/oneapi-before-5252678.dump`，配置备份 `/srv/oneapi-config/compose.before-5252678.env`、`identity.before-5252678.env`。迁移 `015_price_decisions.sql` 只新增表和索引，旧镜像保留。
- 隔离 PostgreSQL 集成测试 28/28 通过。公网 `/release.json` 与 `/api/status` 同为本次源码 SHA；新 API 容器健康；匿名内部价格接口 401；旧 `api.glocalstorage.cn` 返回 200。

## 当前边界与下一步

用户确认微信/支付宝商户尚未开通，DeepSeek Flash 客户人民币单价尚未确定。因此真实收款、真实平台 API Key 和客户推理仍关闭，`payments_enabled=false`、`inference_enabled=false`、`business_ready=false`。内部价格审批不自动公开报价或开启订单。下一步先确认供应授权及客户单价，再建设客户可见的单型号价格和真实预付账本；商户开通后接支付回调与退款，最后开放客户 Key 和调用。

原始价格依据和门禁见 `docs/phase-1/19-first-model-pricing.md`。
