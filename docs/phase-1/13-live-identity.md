> **最终配色纠正（20:05 用户提供原稿）：Logo 原样使用正式 SVG，semi 与 ai 为红，fly 与点为品牌蓝；禁止给 Logo 字母重着色。标语 It’s Your API. 的 A、I 红，其余文字品牌蓝。下方此前给 semifly 整体改蓝的记录已被此规则替代。**

> 最新命名：semifly.ai；标语 It’s Your API.。正式 SVG 原样保留 semi/ai 的红色和 fly/分隔点的蓝色；标语的 A、I 红，其余文字蓝。此前“拼API”为历史称呼，不再用于对外界面。内部仓库、服务标识和域名仍为 oneapi。

# 第一期真实身份与权限

2026-11-06。拼API独立域名 oneapi.glocalstorage.cn；旧 api.glocalstorage.cn 保留。

## 已实现

- 客户：公开邮箱注册、邮箱验证后登录、密码恢复、修改密码、会话查看、退出其他设备和退出登录。Better Auth 1.7.18 管理密码哈希及会话，不自行实现密码协议。
- 企业：同一客户身份可创建或加入多家企业。新成员只有企业代表人和企业员工两种身份；旧库中的细分角色仅保留兼容读取。代表人生成一个可重复使用、七天有效的共享链接，接收者以任意已验证邮箱申请，代表人逐人审批。获批员工默认零预算、零模型权限。最后一位代表人不可被停用或移除。
- 成员停用/移除立即影响企业访问，不删除个人账户。加入申请、审批、角色修改与链接撤销留下审计记录。
- 员工：公司 Authentik 的独立 OIDC client，精确回调、PKCE S256、state、nonce、MFA；独立 host-only Cookie。每次员工请求重新验证 IdP access token，本地权限变更撤销员工会话。
- 岗位：平台管理员、运营、供应运营、财务、客户支持。新员工通过公司身份登录后待授权；客户不能自注册成公司员工。
- 首位管理员：sales@glocalstorage.com 对应的不可变 Authentik UUID subject，配置于生产私有文件。邮箱字符串不能用于抢占平台管理员。该账号需本人完成指定员工开通流程。
- 平台管理员可以批准员工岗位，停用/恢复客户账户，查看身份审计；运营和支持只能查看客户列表，供应与财务没有客户列表权限。

## 数据与接口

Node 24 / Express 5，独立 PostgreSQL 16。核心表：Better Auth user/session/account/verification/rateLimit；organizations、memberships、organization_join_links、organization_join_requests、audit_events；staff_members、staff_sessions、staff_oidc_states；mail_outbox、request_limits。

客户 /api/auth；个人与企业 /api/platform；员工 /api/staff。所有业务数据访问均在服务器校验身份和组织成员关系，前端隐藏按钮不构成权限边界。

/api/status 为实时能力状态。/healthz、/release.json 为静态前端版本。充值、余额、Key、模型调用与促销仍未启用；企业预算原型不是实际资金账本。原有预算核心测试继续保留作为后续账本约束的参考。

## 邮件与保护

验证与恢复邮件入库后由独立队列发送。待发正文 AES-GCM 加密，成功或超时后清除正文；凭据只在生产私有配置。企业代表人自行分享加入链接，平台不再发送逐邮箱邀请邮件。使用公司已有 SMTP 发件账号，sales 邮箱仅接收，不作为发件登录。

固定可信 Origin、HttpOnly/Secure/SameSite Cookie、Caddy 请求体限制、数据库速率限制、明确 endpoint allowlist；邮件验证必须先于加入申请。

## 本机验证

**[m5]** 在独立 *_test PostgreSQL 数据库设置 TEST_DATABASE_URL 后运行 npm test。测试不连接生产，邮件只进入内存测试传输器。覆盖真实数据库、OIDC/JWKS/PKCE、跨租户越权、共享链接重复使用与逐人审批、链接撤销与过期、最后所有者、密码恢复令牌单次使用与旧会话撤销，以及原有预算不变量。

浏览器联调从真实登录进入个人和企业空间，显示测试库中的成员。生产账号的密码、邮件验证码与 MFA 由用户本人完成，不代设或代收。

## 下一阶段

供应商与产品验证 → 模型广场的真实商品/路由 → 支付与不可变资金流水 → 促销和返佣。企业购买后的成员额度分配/收回/调配需连到账本后开放，不能用当前演示预算代替。

## 正式品牌文件

用户提供 semifly-brand-kit-20261106-v1。web/pinapi-wordmark.svg 原样复制官方 horizontal-color SVG；pinapi-mark.svg 和 favicon.svg 来自同一品牌包的 symbol-color 与 UI favicon。完整横版标志已含图形，导航不再额外拼接图标。官方朱红 #E43C2F、海军蓝 #1C2541；不使用字体近似或 CSS 滤镜重绘标志。

## 生产构建备用路径

Dockerfile 是固定官方 Node 24.22.2 digest 的标准构建。Dockerfile.cached-runtime 供大镜像层下载不可用时使用：明确传入已检查的本地 Node/Alpine 镜像 ID，依赖安装禁用生命周期脚本；最终 FROM scratch 只复制 Node 可执行文件、许可证、动态库、CA 与本仓库产物，不继承缓存来源的应用、环境、数据或启动命令。运行前必须验证数据库、TLS/SMTP、OIDC 和非 root 配置。
