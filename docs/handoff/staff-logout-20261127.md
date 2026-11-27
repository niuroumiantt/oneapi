# Semifly 员工退出修复（2026-11-27，m5）

线上版本 352c7fd 的员工与个人退出操作在服务端返回后引用了已移除的 employeeIssuedKey，导致账户菜单和当前路由没有重置。旧页面点过退出后，可刷新以重新检查登录状态。停用员工 Key 后的列表刷新也被同一引用中断。

web/identity.js 改为在退出时清理当前实际使用的一次性个人 Key 状态，并在停用员工 Key 后直接重新加载状态。服务端退出接口及 Authentik 准入规则沿用现有配置。

server/test/identity-logout-ui.test.mjs 通过真实前端点击处理函数复现并覆盖员工退出、个人退出、停用员工 Key 后刷新。三项修复前均失败，修复后通过。发布后以 Semifly 的 release.json、api/status 和实际浏览器退出结果记录最终验收。
