# 员工工作台发布（2026-11-26，m5）

## 授权与基线
- 用户已明确要求「请 commit 上线」，替代此前仅本地评审限制。
- 发布集成工作树：`/Users/m5/.worktrees/oneapi/employee-workspace-release-20261126`；分支 `codex/employee-workspace-release-20261126`。
- 基于远程 main `dd02fde`（PR #152），保留最新个人用量图、导航缓存、模型选择和 VIP 活动/账单功能；原主工作区及其未跟踪资料未改动。

## 最终行为
- 员工仅客户推广、VIP 推广、本人客户跟进与服务；两组分别显示概览、推广码和申请。老板为独立 platform_admin 身份。
- 服务端白名单与客户归属校验限制实际访问，旧 finance_access / technical_access 不扩大员工权限。未分配的 CRM 客户由老板明确分配，不自动迁移真实归属。
- 左侧分组展开状态按身份保存，切换页面不全部展开。
- 员工「我的 API」直接复用个人 identity.js / identity.css、模型/密钥/接入/用量模板与个人对比页。最新每日用量图与热力图也共用渲染器，只通过 endpoint 参数切换数据。
- 公司额度独立于个人现金账户，无员工购买、充值、支付、退款路径。公司已验证邮箱对应账号、有效公司成员和预分配额度必须同时存在；不自动开户、加入公司或增发额度。
- 客户推广申请沿用真实审批接口；本地预览错误拦截已修复，预览只在内存模拟，不触及生产。

## 验证与发布
- 使用独立临时 PostgreSQL *_test 数据库执行全部 server/test 测试：314 项通过，0 失败、0 跳过。包含身份、公司额度、客户归属、推广、个人/VIP 界面、用量、退款和月结回归；真实支付、模型调用和员工 OIDC 登录不在本轮执行。
- 浏览器确认员工共享概览渲染公司额度、API 接入、每日图和热力图，无支付入口。
- 发布通过 scripts/publish_shanghai.sh，携带核验过的前后端基线 SHA；服务器锁内再次校验，执行备份、迁移、健康检查及失败回滚。
- 发布完成后在本文件追加实际提交与检查结果。

## 实际发布结果
- 功能提交 `b94b14d`，PR #153 已合并（合并提交 `06661a6`）。随后同步 PR #154 的发布脚本修复和 VIP 文案，最终上线主分支 `97045916efc3e14d96a3b28ae61951e833d0bea3`。
- 全量上传缓慢，改用完整 SHA256 清单验证的差量传输：复用 190 个内容相同的静态文件，验证完整 211 文件发布包；保留完整 server 源码与原 activate_release.sh 备份、迁移、锁内基线检查和回滚流程。
- 首次激活因另一项个人/VIP 发布刚把线上推进到 `dd02fde` 被基线保护拦截，未修改服务。核对该版本为本次祖先后，重新以 `dd02fde` 为基线发布最新 `9704591`，成功。
- 发布目录：`/srv/oneapi-data/oneapi-cutover-q72dymap/releases/06661a60b961.delta-4a742fbd`。目录名前缀是最初合并版本；目录内完整清单、运行镜像、SOURCE_SHA 和前端 release.json 均为最终 `9704591`。
- 发布自动备份、数据库迁移、API 容器 healthy、前端与 API SHA 验证全部通过。公网 `/release.json` 和 `/api/status` 均返回 status=ok、同一最终 SHA。
- 公网个人页和 employee-api.html 共同引用 `identity.c6e47b43e21c.js`、`identity.9273e3a1f98c.css`、`personal-usage-charts.05a9b422a5a7.js` / `.ebb555a45ceb.css` 和 `navigation-data.a9a819f1240e.js`，实际共享模板与样式已核对。
- 员工 `/self-api/status` 与 `/self-api/usage/chart` 无登录均返回 401；生产公司额度配置已存在。本轮未登录真实员工、增发额度或执行付费调用。
- 主集成回归 314 项全部通过；后来 VIP 单行文案与脚本增量另验证 11 项 VIP UI 测试及脚本语法通过。
- 临时测试 PostgreSQL 和 3338 验证服务已停止；原 3326 本地示例服务保留。原主工作区及无关资料未改动。
