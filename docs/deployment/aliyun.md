# 阿里云独立部署

2026-11-06 用户明确：保留旧平台，OneAPI 独立建设，新入口使用 **oneapi.glocalstorage.cn**。旧平台 api.glocalstorage.cn、现有 Next.js/New API 容器及数据库保持原有归属，不迁入本项目。

## 当前发布范围

本次产物是明确标注演示的静态 UI 预览。真实客户注册、员工登录、供应验证、收款、API 调用、优惠与佣金尚未启用；公开注册是正式业务上线目标，不是本版本已完成的能力。

`web/` 为当前部署入口；`design/spectrum/reference/` 保留原始参考快照。正式业务开发以本仓库为源，按五模块计划落地。页面不会读取旧平台数据。

## 发布机制

复用 infra 的 `scripts/push_static_candidate.sh` 和 `manual-static-publish`，按源码 SHA 归档、校验 SHA256、用独立应用锁原子切换静态目录。无需新增运行容器或在服务器构建镜像。

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

`/healthz` 的 status=ok 只表示预览资源可访问；stage=ui-preview、business_ready=false 明确业务未就绪。`/v1` 与业务接口前缀返回 503 JSON，不转发旧网关。未实现登录路径返回 404，不模拟真实登录成功。

当前没有自动发布定时器；每次按审核后的具体提交手动发布。将来接入业务服务、数据库及自动发布时再登记新的运行方式。

## 验证与回滚

发布后核对 HTTPS 首页、带摘要的 CSS/JS、release.json、healthz、HTTP→HTTPS、未启用 API 的 503，以及旧域名和原容器状态。浏览器检查广场、后台、筛选与详情。

静态内容回滚通过同一发布器重新发布已保存的旧源码 SHA 及归档，并使用更高发布序号；不手改回执，不删除历史版本。首次站点注册同时保存 Caddy 配置备份；需要撤销该入口时只移除 OneAPI 管理块，经校验后 reload，不重启其他容器。后续若有其他配置变化，不能整份覆盖旧备份。

密钥、OAuth 应用凭据和支付商户资料不进入静态产物或 Git。生产数据目录在引入数据库时单独确定，本次不创建假数据库或复制旧站数据。
