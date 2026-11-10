# KerAPI 企业采购 Key 接入交接

2026-11-10。用户确认待接入的 Key 属于已完成企业认证的 KerAPI 账户。**用户尚未将 Key 输入我们的验收台**；不得声称已经完成型号探测或真实调用，也不要通过聊天、Git 或静态页面接收明文。

## 已完成

- OneAPI 生产后端精确允许 `kerapi.cn` 与原有 `api.deepseek.com`，仍要求 HTTPS、无端口、无重定向。现有员工验收台 `/api/staff/lab/console` 的采购 Key 表单加密保存；每枚 Key 可独立发现型号、挂费率、运行固定题和记录逐笔用量。
- 发布源码 `b8d295c3e9f9ac4b63f8104af5ce92aac992b484`。生产镜像 `oneapi-identity:b8d295c` 健康；静态站和 `/api/status` 同 SHA。旧平台仍返回 200。未登录访问验收台重定向到 `/api/staff/login?next=lab`。
- 发布前 OneAPI 专用数据库备份 `/srv/oneapi-backups/oneapi-20261110T030531Z.dump`；配置备份 `/srv/oneapi-config/identity.before-b8d295c.env`、`compose.before-b8d295c.env`、`/srv/oneapi-runtime/pilot.override.before-b8d295c.yml`；旧镜像 `oneapi-identity:7725009` 保留。此轮无数据库结构迁移。
- 个人限量测试用量增加按模型、按个人 Key、最近 50 笔记录的展示。它读取现有 DeepSeek 试点记录，与 KerAPI 采购 Key **尚未打通**。客户余额、正式计费和公开平台 Key 仍关闭。隔离数据库集成测试 16/16 通过。

## 待用户输入 Key 后执行

1. 用户以员工管理员身份进入验收台，先在「供应商」建 `KerAPI`，再到「采购 Key」填写别名、`https://kerapi.cn/v1` 和实际 Key；不要把 Key 发到聊天里。该 Base URL 基于匿名 `/v1/models` 返回 401 的观察，尚需用真实 Key 验证。
2. 点击「探测型号」，确认上游返回的型号 ID 与 KerAPI 企业控制台及正式文档一致。为要测的型号登记输入、缓存命中、输出采购价及有效期/计价依据；平台不能凭截图推断客户售价。
3. 每个型号先用少量固定题做真实测试，核对 `response.model`、用量字段、缓存字段、耗时和请求 ID。测试会消耗上游额度。再以 KerAPI 控制台逐笔日志/账单核对；无法匹配时保持「待核」，不要开放客户销售。
4. 上游正式文档和合同还需确认限流、失败计费、账单导出颗粒度、SLA 与模型版本。客户侧接入与上游采购 Key 严格隔离，禁止把上游 Key 暴露给客户。

## 版本与回滚

生产当前前后端 SHA 均为 `b8d295c3e9f9ac4b63f8104af5ce92aac992b484`。静态包 SHA256 为 `3d569e838dcbc68cb23872c3dd62c00001d93d40bd9c5effbc3359111acaa18a`。后端失败可恢复上述三份配置并用 `docker compose` 只重建 OneAPI API 容器；静态回滚使用 infra 的 `push_static_candidate.sh` 重新发布旧 SHA。
