# 模型价格草稿与付费准备交接

2026-11-07，oneapi，分支 `codex/phase-one-launch-design`。

## 本阶段已上线

- 内部员工页 `#ops/products` 读取真实模型商品和供方核验数据，显示最新价格草稿状态及输入/输出价；“查看价格草稿与依据”列出历史版本和来源链接。平台管理员和财务可设计草稿；供应运营、运营只读；客户不能访问。
- 新表 `model_price_proposals` 保留每版草稿的整数分金额、人民币币种、商品关联、HTTPS 依据、说明、创建人和时间。后端仅有新增和读取接口，每次新增写审计。
- 内部 `#ops/payments` 是一屏付费准备台，显示商品、价格和促销草稿数量及四步上线依赖。员工工作台入口已指向真实页面，取代原付款预览链接。
- 没有公开价格、订单、收款、退款、余额、真实调用或返佣功能。`business_ready=false`、`payments_enabled=false`。

## 发布与验证

提交 `bd9f314c334aae1af1e83d2894bae81e40c4880d` 已推送并部署到独立 `oneapi.glocalstorage.cn`。静态包 SHA256 `79caa7ed5f084f4d98a8ef06eb85b46769c964070200dfff7c76b2cab9395141`；后端镜像 `oneapi-identity:bd9f314`。迁移前备份：`/srv/oneapi-backups/oneapi-before-price-bd9f314.dump`、`/srv/oneapi-config/compose.before-bd9f314.env`、`/srv/oneapi-config/identity.before-bd9f314.env`。

隔离 PostgreSQL 下 `npm test` 27/27 通过；包括匿名及客户身份拒绝、金额精度、HTTPS 依据、停用供应时拒绝定价。线上 `/release.json` 与 `/api/status` 的源码版本一致；匿名价格接口为 401；旧 `api.glocalstorage.cn` 返回 200。员工登录态未提供给本会话，因此尚未以生产员工身份进行视觉验收。

## 接下来

1. 取得供方正式授权、可验证的采购报价和真实接口测试结果，在供应进度台建立资料并复核价格草稿。
2. 设计价格审核和公开版本，统一人民币分、token 计量单位及有效期。只有已核验供给和已批准价格才可进入客户目录。
3. 商户与账户到位后接订单状态、支付回调验签与幂等、资金账本、退款及对账，再接调用计量和促销兑换/计佣。未完成前不开放客户购买按钮。
