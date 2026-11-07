# 商品与模拟交易链路交接（2026-11-07，m5）

## 本轮目标与边界

用户确认的产品链路：采购供应商 API Key → 发现并验证型号 → 设计品牌/型号商品与售价 → 客户选择多个型号 → 预付人民币额度 → 在额度内调用 → 记录用量、退款与促销。当前未取得正式供应凭据或支付商户资料，本轮只把可交互页面、内部草稿和隔离演示闭环落地。真实支付、真实 Key、推理与公开销售仍关闭。

## 已完成并上线

- 功能提交 `28d74f25a958f858ef1f44045c042644995ed025` 已推送到 `codex/phase-one-launch-design`，并发布到 `https://oneapi.glocalstorage.cn`。前端静态包 SHA256 为 `66f7059b427d9e525f620b4df843cbb81c47f7d7764a61b83793cdd8ab9220f7`；API 镜像 `oneapi-identity:28d74f2`，镜像 ID `sha256:fca4e2932c384cb00745728f1473e607e388d4feb5762a5cb368f899f951e2c1`。
- 内部 `#ops/products` 可创建供应型号或 semifly.ai 自有服务草稿，记录品牌、家族、版本、用途、能力、服务限制和技术参数；内部价格和促销草稿可关联自有服务。自有服务不能走供应商复核捷径，仍无公开销售开关。供应商进度和验收继续在 `#ops/supply`。
- 个人 `#demo/personal` 与企业 `#demo/organization/<organization-id>` 可多选演示型号，建立与型号解耦的充值单（¥5 起），模拟付款、演示接入、按型号计量扣费、查余额和流水、模拟未用余额退款。企业代表人可同时设置每个员工的演示额度和允许型号；员工只能创建获授权型号的演示接入，变更授权前必须停用相关接入。
- 模拟退款关联原模拟充值单并冲减未用模拟余额，手续费保持 0；真实的“15% 退款手续费、原路径退回”须经法务、财务及商户规则核准后另行实现。演示入口和接口均标注模拟，不产生可调用 API Key、不收款、不向上游发请求。
- 本地隔离 PostgreSQL 集成测试 28/28 通过；语法与 `git diff --check` 通过。线上 `/api/status` 与 `/release.json` 均为本轮提交，`payments_enabled=false`、`inference_enabled=false`、`business_ready=false`；API 与数据库容器健康。站点首页和新版脚本为 200，匿名内部商品及演示接口为 401，旧 `api.glocalstorage.cn` 为 200。尚未用生产客户或员工登录会话逐项做浏览器验收。

## 部署与回滚记录

- 发布前 OneAPI 专用数据库备份：`/srv/oneapi-backups/oneapi-20261107T070602Z.dump`。配置备份：`/srv/oneapi-config/compose.before-28d74f2.env`、`/srv/oneapi-config/identity.before-28d74f2.env`。新迁移 `012`、`013`、`014` 为加法；旧镜像仍保留。应用回滚保留新表及演示记录，不在回滚中删表。
- API 仅在独立 `oneapi` compose 服务上切换镜像；前端经 infra `push_static_candidate.sh` 原子发布。旧 `api.glocalstorage.cn` 未更改。
- 本轮静态资源、源码提交和接口状态与线上一致。服务器 `/srv/oneapi-runtime/release.json` 是旧手工元数据，不能代替公网 `/release.json` 和 `/api/status` 判定当前版本。

## 下一阶段

1. 供应商合同、转售授权、型号清单、采购价、SLA 和受控测试 Key 到位后，建立 KMS/受限凭据入口、轮换和审计，再做真实连接、计量与质量验收。
2. 给每个型号建立技术、商业、价格审批与自动撤架规则，公开目录只读正式发布商品；自有服务需另证实底层能力、授权与交付指标。
3. 商户资料到位后实现真实订单、验签回调、余额总账、原路退款、对账；真实资金与 `demo_*` 永不混用。
4. 完成正式平台 Key、客户/项目/型号权限、用量预留与结算及采购成本双账；之后才打开真实推理。促销最后接真实结算与核销账本。

实现顺序与验收条件见 `docs/phase-1/18-product-flow-implementation.md`。
