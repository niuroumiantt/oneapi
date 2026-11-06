# 供应商模块首步交接

2026-11-07，oneapi。用户要求从企业权限继续到供应商模块；旧 api.glocalstorage.cn 保持独立。

本阶段实现内部供应管理台：供应商档案、供应产品草稿、七项人工资料核验、岗位隔离与审计。`#ops/supply` 是真实数据库页面；原 `#supply` 仍是公开说明。员工岗位 supply/platform_admin 可改，operations/finance 可读；客户不可访问员工接口。数据库迁移 `002_supply.sql` 幂等，不包含供应商密钥。产品不可标记为正式销售；`sale_ready=false`。

角色补丁同时允许企业代表人将企业员工改为代表人，再改回员工，保留最后一位有效代表人保护。企业员工预算、模型授权和 Token 消费仍须真实资金/调用系统接入。

测试：使用本机隔离 PostgreSQL 的 `npm test`，包含供应商权限、草稿、核验、阻止暂停供方新增产品与审计。上线后核对 `/api/status`、`/release.json`、员工管理台以及旧域名健康。下一步按 `docs/phase-1/07-supplier-operations.md` 建正式供方账户、合同授权、受控凭据、真实模型探测、采购计量/账单、商品发布门禁。

## 已部署与验证

源码提交 `c0d00fbb83e222d59531888cd0206748694d2d75` 已推送到 `codex/phase-one-launch-design`。生产后端从保留的 `oneapi-identity:c436ed6` 镜像构建仅覆盖本仓库 `server/` 的新镜像 `oneapi-identity:c0d00fb`（镜像 ID `sha256:f894a1b92e22e115aa1f9f687fe58c29208b01da1157ab93f15a22e84ca09e82`）。发布前 oneapi 专用数据库备份为 `/srv/oneapi-backups/oneapi-before-supplier-c0d00fb.dump`，29,801 字节；旧 compose/身份配置分别保存在 `/srv/oneapi-config/compose.before-supplier-c0d00fb.env` 与 `identity.before-supplier-c0d00fb.env`。迁移成功，新 API 容器健康。旧镜像仍可回滚；新增表是加法迁移，回滚应用时保留表和数据。

前端静态归档 SHA256 `bc3f6108ab5d16640783930a3c9f49b4eedc1f6b4d823d29078874b658fd634d`，infra 发布器返回 deployed。公网 `/release.json` 与 `/api/status` 均显示该源码 SHA、business_ready=false，支付及推理仍关闭；静态身份脚本包含供应管理台；匿名供应 API 返回 401；旧 `api.glocalstorage.cn` 首页返回 200。浏览器匿名直开 `#ops/supply` 正确显示公司身份登录，当前会话没有员工身份，因此未对生产员工登录后的界面做人工视觉验收。

`npm test` 25/25 通过；本地数据库位于一次性 PostgreSQL 测试实例，结束后关闭。下一阶段需取得正式供方资料，再由授权员工建立候选档案。不要将无真实采购资格的候选数据发布到客户广场。

## 首位员工登录澄清（2026-11-07）

用户截图显示 Authentik 已登录 `admin` 并进入 TOTP 初次绑定页。线上只读核对：`sales@glocalstorage.com` 对应独立 `oneapi-sales` 用户，处于 inactive、activation_pending=true 且属于 OneAPI Staff；截图中的 `admin` 与该邮箱不符，也不属于 OneAPI Staff。oneapi 的 `staff_members` 尚无首次登录记录。首位管理员没有预设密码，须本人使用公司邮箱开通链接验证、设置密码及 MFA，随后再从 `#staff` 登录。截图中的二维码可能包含 TOTP 种子，不能作为公开教程传播；若已据此绑定 Authentik admin 的验证器，应在身份中心撤销并重新绑定。员工入口文案补充了账号切换和 MFA 使用提示。
