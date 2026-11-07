# 供应商引入进度台交接

2026-11-07，oneapi。用户明确：AutoKernel 只是理解流程的样本；供应商首页应一屏看到供给类型、阶段、负责人、待解决问题及最近测试，点击再看产品和证据。不要把样本信息伪造成已经引入的供应商。

## 已上线

- `#ops/supply` 是员工可见的供应商进度台。每家供方显示这五项，窄屏保持全部字段；`#ops/supply/<supplier-id>` 展示主体、供应产品、七项人工资料核验、测试记录和内部客户商品草稿。商品只展示当前供方的来源。
- 供方可记录供给类型、来源关系、负责人、下一步待办。负责人缺省为建档员工；API 变更负责人仅接受有效供应运营或平台管理员。供应产品可登记连通性、响应、计量账单、容量四种测试结果，必须有 HTTPS 证据链接及实际时间。结果属于人工登记，不能自动授权销售。
- 进度台的最近测试来自持久化记录；失败时显示“测试失败”。无记录则显示“未登记测试”，不生成演示成功数据。目前生产库有 0 家供应商和 0 条测试记录，等待授权员工按真实资料建档。
- 数据库迁移 `005_supplier_intake.sql` 和 `006_supplier_test_records.sql` 为加法；供应商、核验与测试接口均要求员工会话，供方改动写审计。`sale_ready=false`、`business_ready=false`，订单、支付、推理和商品公开仍关闭。

## 发布与验证

源码 `aeddd78d7601a33308b0cea01715bedaca335dfe` 已推送到 `codex/phase-one-launch-design` 并部署。生产镜像 `oneapi-identity:aeddd78`；迁移前专用数据库备份 `/srv/oneapi-backups/oneapi-before-test-records-aeddd78.dump`，前一步备份 `/srv/oneapi-backups/oneapi-before-supplier-intake-256598a.dump`；配置备份在 `/srv/oneapi-config/compose.before-aeddd78.env` 与 `identity.before-aeddd78.env`。静态包 SHA256 `5d8aebb582b7526ec24703780a452a750d70ac74906e1d7affb1b82e1c5b40a8`，发布器返回 deployed。

隔离 PostgreSQL 下 `npm test` 27/27 通过；语法及差异检查通过。公网 `/release.json` 与 `/api/status` 均为相同源码 SHA，供应接口匿名请求 401，旧 `api.glocalstorage.cn` 首页 200。生产员工登录后视觉效果仍需授权员工实测；未假造登录会话。

## 下一步

1. 取得真实供应商合同、销售权、机型/API 文档、SLA、计量与账单样本，在此进度台建档并填入具体待办。真实探测应由受控凭据和自动探针生成，人工记录只能作为证据来源之一。
2. 衔接模型商品审批、成本与客户价格版本、公开模型广场；然后做订单、支付回调验签、不可重复入账的账本和调用计量，再把促销草稿接到真实交易事件。企业预算和员工用量在资金及调用闭环前仍不得显示虚构实数。

## 后续同日：模型商品进度页

前端提交 `8079bf1e52e61cfcac370238d936fee31b9f1ede` 新增内部 `#ops/products`，汇总每款商品的来源供方、资料进度、定价状态、发布状态与下一步；点击回到供方详情。原 `#ops/models` 指向此页，供应商详情中也有入口。静态包 SHA256 `69189af30b093392f2c03bd68f40bb8d4fce606e303f1615ae5c247a7cccf522`，发布器返回 deployed；后端沿用相同代码镜像并更新 `SOURCE_SHA`，前后端公网版本一致。旧域名 200。浏览器中现有员工会话已过期，页面转员工登录，未能以生产员工身份完成实际视觉验收；静态脚本和语法已验证。
