# OneAPI 阿里云部署与企业工作台交接（2026-11-06，m5）

## 当前阶段：企业工作台交互预览（2026-11-06）

最新上线源码：3322a99dde4fd41f003b601fb88aa8ddfc740b61；infra 发布器配置：629959b22f25df841e5f551446c33177d6a1f555。
产物 SHA256：0e2938d16f516ba91b2f449b3aad6d1305ee42990ad4a359af1b42cc15982e6d。

三入口 /#login、个人 /#personal 和企业 /#enterprise 已完成交互预览。企业成员筛选、批量预算、调拨、暂停/移除、待加入草稿、申请/审批、角色范围与用量页面可操作。10 项规则测试通过；浏览器验证合法/超额调拨、本人/部门范围、申请与 390px 布局；线上页面无捕获的控制台错误，全部五个 CSS/JS 资源 200。旧 api 首页 200，本次未修改 Caddy 或旧业务服务。

所有状态仅在页面内存；刷新恢复。邀请不发送、金额不持久化，未启用真实登录、收款和模型调用。客户端角色切换不构成生产授权。最新五模块主线和下一步验收见 docs/phase-1/10-implementation-tracker.md；它替代下文首次部署时“尚未实现企业 UI”的状态说明。

下一步进入真实认证、服务端组织授权和供应验证，并按五模块串联支付、调用、计费与促销。先完成界面不代表五模块业务已完成。


## 目标与已定规则

- 旧 api.glocalstorage.cn 及 niuroumiantt/api 平台保留，oneapi 独立建设；新版 oneapi.glocalstorage.cn。
- 主体深圳市格洛可半导体有限公司；正式业务首轮直接公众注册；目前只开放明确标注的静态演示。
- 客户主入口为个人、企业工作台；本公司员工经右上角“管理台”进入独立员工预览页。customer / staff 为身份域，owner 为组织内所有者角色。
- 企业客户自主成员管理及预算分配；用户示例 ¥1,000 / 10 人各 ¥100。研究建议未自动变成已上线功能或用户批准的商业条款。

## 已完成

- 阿里云 HTTPS 首页、模型广场、供应运营及详情交互可访问，浏览器无捕获的错误日志。
- 部署源码 SHA：651526543a715c0eb93a1cba5e3d0e5f4664f064；infra 发布配置 SHA：629959b22f25df841e5f551446c33177d6a1f555。
- 产物 SHA256：42b88914e74dadd245e0183781a461986f688d443ff17840e6a0545c2290b65c。
- /healthz 与 /release.json 200，CSS/JS 200；HTTP 308→HTTPS；/v1/models 与 /api/customer/v1/me 503；/login 404（未实现）。
- 旧域名首页 200；model-marketplace-web/newapi/postgres 三容器 ID、StartedAt 未变化，仍 running。
- Caddy 保留原内容，只追加 OneAPI 块；Caddy 2.11.4 的 admin off 保留，以 SIGUSR1 重载，未重启业务容器。
- 企业工作台交互预览已实现成员、预算调拨、暂停/移除与申请审批；后端尚未实现。设计见 docs/phase-1/09-enterprise-workspace.md。

## 部署位置与回滚

静态入口 /srv/sites/oneapi → 版本目录；归档 /srv/releases/oneapi；回执 /var/lib/infra-release/deployed/oneapi.json。

生产 Caddy /srv/infra/oa-cn/hosts/mainland/Caddyfile.public；当前 SHA256 7af5fb990afefe07c056012059965df6a345e2ef3683a30f0cd7c309b4733b90。
备份 /var/lib/infra-release/backups/Caddyfile.before-oneapi.20261106091032。回滚只撤回本管理块，若有其他改动不能整份覆盖旧备份。静态版本按 infra 发布器更高序号回滚，保留历史归档。

## 下一步

1. 客户双入口、企业预算原型、semifly 原版 Logo 与 Lucide 图标已部署；继续落实五模块真实业务，见 docs/phase-1 中的实施进度表。
2. 实现真实认证、组织 Membership、授权作用范围，再接企业钱包、预占结算及成员用量；不能把静态演示当验收。
3. 落实真实商户与采购账户、价格和模型/客户端版本；不在聊天或 Git 收集秘密。
4. 实现供应验证、模型调用、支付和促销，完成 docs/phase-1/08、09 的全链路验收后公开业务。

## 工作区与工具

源码 ~/code/oneapi；本任务分支 codex/phase-one-launch-design 位于 ~/.worktrees/oneapi/phase-one-launch-design；PR https://github.com/niuroumiantt/oneapi/pull/1。
infra 分支 codex-oneapi-aliyun 位于 ~/.worktrees/infra/oneapi-aliyun；两个常驻 checkout 未切分支、未覆盖。

m5 的 aliyun SSH 别名仍配置旧密钥，部署显式使用 ~/.ssh/id_ed25519；没有修改全局 SSH 配置。静态发布使用 MAINLAND_SSH_IDENTITY 和 STATIC_PYTHON=/Users/m5/.local/bin/python3.12，复用 infra/scripts/push_static_candidate.sh。

参考：docs/deployment/aliyun.md、docs/phase-1/09-enterprise-workspace.md、design/spectrum/README.md。网站 https://oneapi.glocalstorage.cn 当前源码版本与后续纯文档提交可能不同，以 /release.json 为准。

## 最新界面发布验证

2026-11-06：桌面与 390px 手机双入口、右上角管理台、动态 Lucide 图标检查通过；企业额度 10 项测试通过，浏览器未捕获错误。归档 13 个文件，发布状态 deployed，业务仍为 ui-preview / business_ready=false。品牌和 Figma 对应规范见 design/spectrum/brand-and-icons.md。Figma 旧约定未找到，未连接 Figma 服务。
