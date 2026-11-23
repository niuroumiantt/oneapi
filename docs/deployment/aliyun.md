# OneAPI 上海生产发布

OneAPI 的生产站点是 [semifly.cn](https://semifly.cn/)。GitHub 的 `niuroumiantt/oneapi` 主分支维护应用源码，`niuroumiantt/infra` 维护主机和路由登记。开发与验收使用本地工作树。发布从已经提交并核对的源码执行。

| 项目 | 当前入口 |
| --- | --- |
| 上海 ECS | 华东 2 上海 A，`47.101.153.99`，4 vCPU / 16 GiB |
| Compose | `/srv/oneapi-data/oneapi-cutover-q72dymap/production/compose.yml` |
| 应用、数据库、入口 | `oneapi-sh-api`、`oneapi-sh-db`、`oneapi-sh-edge` |
| 后端版本和健康 | `https://semifly.cn/api/status` |
| 前端版本和健康 | `https://semifly.cn/release.json`、`/healthz` |
| 旧域兼容 | 青岛共享 Caddy 转发 API 和签名支付回调，网页跳转到 `semifly.cn` |

## 发布

在 **[m5、m4 或有上海 SSH 权限的运维机]** 的 OneAPI 干净工作树执行 `scripts/publish_shanghai.sh`。使用标准 SSH 主机校验。需要经 m4 中转时，将 `ONEAPI_SHANGHAI_SSH` 指向支持标准 SSH 参数和 stdin 的本地包装器。SSH 凭据及临时连接路径不存入 Git。

发布器只面向上海 ECS。它从同一个提交打包前后端，校验传输包，更新前先生成数据库备份，按 Compose 运行迁移，只替换 API 容器。通过后先发布前端静态资源，再替换页面和版本回执。失败时恢复前一个 API 镜像、Compose 和前端文件。数据库迁移采用与上一版兼容的加法变更。每次发布的备份副本与源码包留在上海运行目录中的 `releases/`。

验收对照两个版本端点，检查客户登录、账户及 API 请求，确认旧域支付通知仍抵达上海的签名校验。生产余额与订单只由上海数据库写入。青岛中文官网、其他应用和独立的 `api.glocalstorage.cn` 仍走各自发布入口。

## 账号登录

短信登录使用阿里云号码认证 PNVS。仅在提供 `PNVS_ACCESS_KEY_ID`、`PNVS_ACCESS_KEY_SECRET`、`PNVS_SIGN_NAME`、`PNVS_TEMPLATE_CODE`、至少 32 字符的稳定 `SMS_PHONE_HASH_SECRET`，并显式设置 `SMS_LOGIN_ENABLED=true` 时启用。`PNVS_SCHEME_NAME` 可选。凭据仅配置在上海环境中，RAM 权限仅需发送和核验验证码。先用授权测试号码验证真实发送和核验，再公开入口。既有用户登录邮箱账号后可绑定中国大陆手机号。号码散列密钥变更会使既有手机号绑定失效。

[阿里云号码认证接入指引](https://help.aliyun.com/zh/pnvs/developer-reference/the-server-integration-1) · [上海切换记录](../handoff/semifly-cn-shanghai-cutover-20261123.md)

## 维护任务

上海的监控、备份和 Skills 使用 [systemd 单元](../../scripts/shanghai/systemd/) 中的 `oneapi-sh-*`。监控采集器由 [上海监控安装脚本](../../scripts/install-oneapi-monitor.sh) 安装。备份在上海数据盘 `/srv/oneapi-data/backups`，每日执行且在应用发布前额外执行。历史生成回执和恢复验证记录按数据盘原路径保留。[Skills 维护说明](../../scripts/skills-deploy/README.md)
