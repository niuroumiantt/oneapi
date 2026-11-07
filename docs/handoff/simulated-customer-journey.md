# 个人与企业模拟交易链路交接（2026-11-07，m5）

## 目标与已定规则

- 用户要求先把项目完整做出来：在没有真实供应、商户和调用案例时，个人与企业也要能走通选模型、下单、付款、接入、用量的模拟链路。
- 旧 `api.glocalstorage.cn` 独立保留；新平台部署在 `oneapi.glocalstorage.cn`。模拟数据必须明确标识，不能触发真实收款、生成可调用 API Key 或调用供应商。
- 企业身份仅企业代表人与企业员工。代表人管理采购和额度；员工在其额度内使用，个人空间与企业空间分开。

## 已完成

- 功能提交 `41ab511a4fa8c7177cb2758633b300b5124f21bf` 已推送到 `codex/phase-one-launch-design`，并部署到独立域名。个人入口 `#demo/personal`，企业入口 `#demo/organization/<organization-id>`；个人空间、企业总览/采购/预算、模型广场均有可见路径。
- 新增隔离 `demo_*` 表和 `/api/demo/*`。真实登录和企业成员身份作为访问门禁；模拟订单付款为幂等余额入账；演示接入只保存 ID 和状态；模拟调用按固定演示价扣款并留用量记录；企业代表人可为成员设置额度，超额、跨企业、未付款及未授权操作被拒绝。
- 28/28 全套测试通过。线上前后端均为功能提交 SHA；API 容器 `healthy`；匿名体验接口 401；`/api/status` 仍显示真实 `payments_enabled=false`、`inference_enabled=false`；旧平台首页 200。
- 迁移前备份 `/srv/oneapi-backups/oneapi-20261107T050515Z.dump`，配置备份 `/srv/oneapi-config/compose.before-41ab511.env` 和 `identity.before-41ab511.env`。新镜像 `oneapi-identity:41ab511`；新增表为加法迁移，应用回滚时应保留表和模拟记录。

## 下一步

1. 用个人和企业真实登录会话检查页面密度、移动端和完整点击流程；本阶段只做了自动化 API 测试与匿名线上检查，未使用用户账号进行生产浏览器验收。
2. 供应产品通过授权、技术验收和价格审批后，将内部商品绑定正式客户目录。演示模型和演示价格不能直接转为对外承诺。
3. 商户开通后另建正式订单与资金账本，验证支付回调、退款、幂等和对账；供应商可用后再接真实密钥、路由、调用计量和限额。正式账本与 `demo_*` 必须保持隔离。
4. 促销草稿只有在真实结算事件和优惠核销账本具备后才能对外发放和计佣。

## 入口文件

- `server/src/demo-journey.mjs`、`server/migrations/011_demo_journey.sql`、`server/test/identity.test.mjs`
- `web/identity.js`、`web/identity.css`、`web/index.html`
