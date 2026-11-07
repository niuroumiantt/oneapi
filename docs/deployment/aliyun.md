# 阿里云独立部署

2026-11-06 用户明确：保留旧平台，OneAPI 独立建设，新入口使用 **oneapi.glocalstorage.cn**。旧平台 api.glocalstorage.cn、现有 Next.js/New API 容器及数据库保持原有归属，不迁入本项目。

## 当前发布范围

当前站点已有客户注册、企业成员权限与独立员工身份；供应资料、型号验收、商品价格和促销可在内部保存草稿。客户选型、余额、付费、接入、用量和退款只在明确标注的 `demo_*` 隔离环境中演示。真实收款、可调用平台 Key、上游 API 调用、优惠兑换与佣金仍关闭。以 `/api/status` 的实时能力状态为准，阶段记录见 [产品链路实施](../phase-1/18-product-flow-implementation.md)。

`web/` 为当前部署入口；`design/spectrum/reference/` 保留原始参考快照。`server/` 提供身份、内部草稿与隔离演示 API。页面不会读取旧平台数据。

## 发布机制

前端复用 infra 的 `scripts/push_static_candidate.sh` 和 `manual-static-publish`，按源码 SHA 归档、校验 SHA256、用独立应用锁原子切换静态目录。后端运行在独立 `oneapi-identity` 容器与 PostgreSQL 中：发布前备份专用数据库和配置，再只覆盖镜像中的本仓库 `server/`，运行加法迁移并检查健康状态。两部分使用同一源码 SHA。

| 项目 | 位置 |
| --- | --- |
| 站点 | https://oneapi.glocalstorage.cn |
| 健康与阶段 | /healthz |
| 源码版本 | /release.json |
| 静态根 | /srv/sites/oneapi（发布器管理的符号链接） |
| 不可变版本目录 | /srv/sites/oneapi- 加源码 SHA 前 12 位 |
| 归档与清单 | /srv/releases/oneapi/ |
| 发布回执 | /var/lib/infra-release/deployed/oneapi.json |
| Caddy 配置源 | infra/hosts/mainland/Caddyfile.public |

`/healthz` 只表示服务可访问；`/api/status` 的 `business_ready=false`、`payments_enabled=false`、`inference_enabled=false` 表示真实交易未开放。客户与员工身份接口已启用，内部草稿与演示接口各自受权限控制；`/v1` 仍不能作为正式调用网关。

当前没有自动发布定时器；每次按具体提交手动发布。真实供应凭据和支付商户仍未接入。

## 验证与回滚

发布后核对 HTTPS 首页、脚本与样式、`release.json`、`/api/status`、数据库和 API 容器健康、匿名权限门禁，以及旧域名和原容器状态。浏览器检查广场、个人/企业演示、内部商品和促销入口。

静态内容回滚通过同一发布器重新发布已保存的旧源码 SHA 及归档，并使用更高发布序号；不手改回执，不删除历史版本。首次站点注册同时保存 Caddy 配置备份；需要撤销该入口时只移除 OneAPI 管理块，经校验后按当前 Caddy 2.11.4 的 SIGUSR1 方式热重载（admin off 保留），不重启其他容器。后续若有其他配置变化，不能整份覆盖旧备份。

密钥、OAuth 应用凭据和支付商户资料不进入静态产物或 Git。生产数据保存在独立的 `/srv/oneapi-data/postgresql`，与旧平台数据库隔离；`demo_*` 仅用于模拟流程。

本次已部署及逐项验证结果见 [部署交接](../handoff/oneapi-aliyun.md)。热重载前需核实 Caddy 版本和启动方式，参考 [Caddy 官方信号说明](https://caddyserver.com/docs/command-line#signals)。
