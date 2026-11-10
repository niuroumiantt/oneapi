# 服务器真实观察、Key 更换和客户统一入口

2026-11-10。本阶段基于 8cd7f05，主仓库 oneapi，分支 codex/phase-one-launch-design。

## 客户身份

个人和企业使用同一 Better Auth 用户及登录表单；旧企业登录链接仅保留目标空间，界面不再提示另注册企业账号。个人与企业页面共用 customerHeader 和个人控制台外壳，通过空间选择器切换。员工管理入口依赖服务端 permissions.manageMembers，组织成员资格和资金权限仍由后端逐次校验。企业不是平台管理员升级；平台 staff OIDC 授权保持独立。没有开放企业真实调用/充值，也没有改变个人试点的两账号限制。

## 服务器观察

入口 `/api/staff/console#technical/servers`，接口 `/api/staff/observability` 仅 requireTechnical。
Host collector: scripts/collect-oneapi-metrics.py；systemd oneapi-monitor.service/timer 每次完成后 15 秒采样。
读取 /proc/stat、/proc/meminfo、默认路由网卡计数、根文件系统空间；Docker inspect 仅固定 api/db/shared Caddy 的状态、启动、重启次数、镜像字段，不读环境/日志。主机内 HTTPS 健康检查经域名 SNI 到 127.0.0.1，再到应用和数据库；不调用模型。
`/srv/oneapi-runtime/metrics/snapshot.json` 原子替换，数据目录只读挂入 `/run/oneapi-observability`，应用不挂 Docker socket，不接任意命令。
计数状态 `/var/lib/oneapi-monitor/counters.json` 权限 0600；服务与配置由 scripts/install-oneapi-monitor.sh 安装。超过 60 秒标记过期；重启、计数回退、接口变化不算出负流量或假零值。CPU/内存/网络是共享整机口径，不代表 OneAPI 独占。显示实际 Mbps，不假设套餐带宽上限。
旧 admin-plan.html 已退役；旧 plan URL 重定向真实后台。无自动仓库更新、软件升级或服务重启入口。

## Key 更换

Migration 023 仅新增 replaces_credential_id 和 rotation_completed_at，无删除。
供应商页「更换 Key」和凭据列表的同名按钮共用一弹窗；仅填写一次新秘密，明确选择型号，新建凭据/端点版本，保留旧费率与 offer 引用，不复制验收结论。新版本可测试，旧版本暂保留。
`POST credentials/:id/replacement` 校验供应商、重复密钥/别名、型号归属以及现有替换版本。
`POST credentials/:id/complete-replacement` 要求每个新端点最新完成测试有 200、无错误、型号字段与计量自洽；拒绝正在运行的任务，原子停用旧 Key，保留全部历史。仅代表接入验证，不代表模型真实性、完整质量验收或账单一致。旧报告不会自动批准新端点。
更换仅作用于验收台，未与客户生产路由自动绑定。没有替换当前 KerAPI 实际 Key，没有新付费调用。

## 验证与上线

应用 32 项测试、采集 2 项测试；浏览器 1440×900 检查服务器页面一屏（内容底部约653px/可用840px）、新 Key 模型默认不勾选、个人/企业共用页眉、员工不显示管理入口，未发现脚本异常。浏览器使用隔离临时配置与明确的夹具数据；真实采集在发布后另核验。
新发布前备份数据库及 overlay/env，安装只读采集 timer，为 API 加只读挂载，执行 additive migration 023，再更新 API 和静态同一源码版本。失败恢复原 overlay/image；原数据保留。

## 后续边界

上游对账仍缺 KerAPI 12:27:34–12:27:41 同 Key 的原始账单；4笔测试输入202/输出145，采购费率未知仍不按0元估价。监测不是持续模型探测，页面轮询不耗 Token。模型持续质量与生产客户逐笔用量属于后续独立接入，不能用本台测试样本冒充。
