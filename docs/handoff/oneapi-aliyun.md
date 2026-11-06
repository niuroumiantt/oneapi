> 最新状态见 [真实身份上线交接](live-identity.md)。以下为历史设计与部署记录。

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


## 当前版本：欢迎页再设计

2026-11-06 最新发布源码 a3247f88349337cea6593405190853cb88899df7，infra 发布配置 45c0a0509fe8bfe50ffb54827b89151f05c810c4，归档 SHA256 d63cc5fb18f38425792587facbedde9c75249a25616aa370c84e9011e4b2c280。替代上一版双卡片登录入口，以本节和 /release.json 为当前状态。

用户明确要求年轻、科技、跳动、欢快。欢迎页采用品牌大字、淡紫/浅绿背景与橙色原创轨道插画，个人和企业在同一区域切换，统一主按钮；管理台仍在右上角。桌面 1440px、手机 390px、客户/员工三条路由、切换文案和跳转、暂停动效验证通过。发布器返回 deployed，线上欢迎页显示新版，浏览器未捕获错误。14 个归档文件与入口资源引用已校验。

欢迎页是 #login，首页仍 #market。没有真实登录、付款或模型调用；没有修改旧 api 平台。后续遵循 design/spectrum/brand-and-icons.md 最新欢迎页规则，不恢复被用户否定的双大卡片。

## 当前版本：宇宙方案独立预览

2026-11-06 发布源码 752ca81538b27907ce7b0b53a235d8a1d8b33805；infra 配置 45c0a0509fe8bfe50ffb54827b89151f05c810c4；归档 SHA256 66b0807a4a3489924227c2086db17077b9248aea387f74ec2966e4ac186c2e50。发布器返回 deployed，线上宇宙页面无捕获的浏览器错误。16 个归档文件及资源引用检查通过。

新增 https://oneapi.glocalstorage.cn/#universe，程序化星系、暖橙太阳、行星和轨道动态。用户刚认可的 #login 轻快版继续保留，原版/宇宙版返回和客户切换、暂停动画、390px 手机构图已验证。尚待用户评价此视觉方向，不要把独立预览说成全站已统一成宇宙风格。原五模块业务状态不变。

## 当前版本：完整天体明显公转

2026-11-06 发布源码 f845fec05dad8630b93e1c411963996255f33e2a；infra 配置 45c0a0509fe8bfe50ffb54827b89151f05c810c4；产物 SHA256 e0351e93f5f8f18fc7134a61a29d5ac13a37f05c6f9838dff812fa01120d407f。发布器返回 deployed。#universe 补全太阳、八颗行星、冥王星和月球，改为明显的独立公转与地月运动，支持 0.5×/1×/2×/4×、暂停/恢复。

线上连续读取确认十个运动天体均位移（一次检查各自约 76–245px，太阳固定在中心）；本地暂停后所有 transform 保持不变。390px 布局无横向溢出，11 个天体名称完整，浏览器未捕获错误；16 个打包文件与引用校验通过。系统减少动态偏好默认暂停，播放按钮仍可用。周期、距离和大小是视觉示意。业务功能状态未变化，已认可的 #login 轻快版保留。

## 当前版本：模型广场设计统一与慢速选项

2026-11-06 发布源码 70d040bcbbf9735dbfdf7b5fedc35ed3fe57fed3，infra 配置 45c0a0509fe8bfe50ffb54827b89151f05c810c4，归档 SHA256 778989c97cbfbab5e9e9fba6324a846c63176d1f5aad42026ac3b1dcb0c3734d。发布器返回 deployed，线上 /release.json 核对一致。

#market 改为与欢迎页统一的宇宙首屏、暖橙操作、明亮四款模型目录、用途快捷入口、淡彩行星插画和工具接入区域。模型搜索、家族与场景组合筛选、无结果清除、指定模型接入均验证。模型和价格仍为演示，业务不开放。宇宙页新加入 0.1×/0.2×，首次加载默认 0.2×，线上选项与默认已确认；本地 0.1× 下天体持续移动已确认。

1440px 桌面与 390px 手机检查通过，无横向溢出。新增两个 Lucide 图标已从固定包加入并确认完整显示；生产采用内容哈希资源避免本地预览曾遇到的旧缓存。17 个产物文件与入口引用校验通过。原 #login 及其他工作台保留，所有新设计规则见 design/spectrum/brand-and-icons.md。

## 当前版本：拼API 品牌与五模块首页

2026-11-06 最终发布源码 `4b6fb217c8ddfee7a7090251a1e55b7eba52eb08`，infra 配置 `45c0a0509fe8bfe50ffb54827b89151f05c810c4`，产物 SHA256 `1cadc28d644a0b4b6c3f47fe4bf67e4b14402b1cfb366948a473fbed5b4493d1`。发布器返回 deployed，线上 release.json 与关键脚本/样式 200 校验一致。22 个归档文件，入口引用无缺失。PR 1 保持草稿，已更新本轮最终描述。

用户最新明确纠正：这是拼API品牌，采用所提供参考图的朱红、深海军蓝与暖白，不能继续用旧企业橙色 Logo。已新增拼合方块标识、临时衬线排字 semifly.ai 和“拼API”产品名。色值与几何图形依据参考图重建；字标不是原始矢量母版，收到正式源文件后替换。具体规范见 design/spectrum/brand-and-icons.md 末节，较早品牌橙规则不再适用。

太阳与完整太阳系轨道现在共同缓慢漂移，行星保持独立公转，月球保持绕地关系；默认速度为用户选定的 0.1×。已验证太阳位置随时间变化，暂停后 transform 保持不变，手机布局无横向溢出。

`#ops/overview` 运营总览及 customers、team、supply、verification、models、payments、promotions、audit、settings 可直接访问。新增搜索与筛选、商品草稿、活动草稿、重复码拦截、暂停/恢复新兑换、模拟验证、内存审计记录；供应运营原有功能保留，通知按钮从其他模块跳转供应事件页。所有交互仅本标签页有效，刷新恢复。

本地 1440px / 390px 浏览器检查通过；全部模块手机导航与页面宽度验证；商品编辑、活动重复码和保存、活动状态、客户搜索、资金状态筛选、验证与审计联动通过；企业预算核心 10 项测试通过。线上确认品牌、0.1×、各首页与最终通知跳转，未捕获浏览器错误。本地预览服务器已停止。截图临时路径：/private/tmp/pinapi-operations-live.jpg、/private/tmp/pinapi-universe-live.jpg。

仍为 `ui-preview / business_ready=false`。真实认证、支付、调用、供应测试、商品发布及权益发放均未接通。旧 api.glocalstorage.cn 保持独立。下一阶段继续五模块后端，不把界面上线等同业务开放。
