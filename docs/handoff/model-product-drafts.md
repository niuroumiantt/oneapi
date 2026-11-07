# 客户模型商品草稿交接

2026-11-07，oneapi。此阶段接续供应商资料核验，把内部采购产品与面向客户的模型商品分开。旧 `api.glocalstorage.cn` 保持独立。

新增 `003_model_products.sql`、内部模型商品列表和创建 API。商品草稿包含唯一代码、名称、简介、地区、来源供应产品及创建人；来源供方或产品暂停时不能新增。只有 platform_admin 与 supply 岗位可创建，operations 与 finance 只读，客户不能访问。创建有审计记录。页面位于 `#ops/supply`，显示内部商品草稿；它不进入公开广场，不含售价、订单、支付、Key 或真实调用功能。

测试覆盖权限、创建、关联来源、重名代码、暂停供方、审计及 `public_catalog_enabled=false`。验证还需参照当前提交的测试回执。下一步需要供方授权与采购账户、真实模型探测、成本与售价审批、发布门禁，才能把商品放入客户广场。

## 发布回执

源码提交 `a58380592efd2437ef95e82be6310cd4784bde14` 已推送到 `codex/phase-one-launch-design`；隔离 PostgreSQL 测试 27/27 通过。生产后端镜像 `oneapi-identity:a583805`，镜像 ID `sha256:e21c724384cb24da3a5e9a0c3f56ac8e934d0312ebf7f86fd4eb66d94443aad5`。迁移前的 oneapi 专用数据库备份为 `/srv/oneapi-backups/oneapi-before-products-a583805.dump`（40,609 字节）；原环境配置保存在 `/srv/oneapi-config/compose.before-a583805.env` 和 `identity.before-a583805.env`。`003_model_products.sql` 迁移完成，API 与数据库容器均健康。

静态归档 SHA256 `cdd2919c62afcb7208e3dde0caf8638e4b3cba376c474f6fa61908e80280d15d`，infra 发布器返回 deployed。公网 `/release.json` 和 `/api/status` 均显示同一源码提交；付款、交易与推理仍关闭，`business_ready=false`；匿名访问商品草稿 API 返回 401；旧 `api.glocalstorage.cn` 首页返回 200。当前没有员工身份会话，因此生产管理台登录后的视觉效果还需授权员工实际查看。
