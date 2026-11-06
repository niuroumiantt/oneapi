> **最终配色纠正（20:05 用户提供原稿）：Logo 原样使用正式 SVG，semi 与 ai 为红，fly 与点为品牌蓝；禁止给 Logo 字母重着色。标语 It’s Your API. 的 A、I 红，其余文字品牌蓝。下方此前给 semifly 整体改蓝的记录已被此规则替代。**

# semifly.ai 身份上线交接（2026-11-06，m5）

## 目标
先完成个人、客户企业和本公司员工的真实登录与权限，再接供应商验证、模型商品、支付、促销。

## 已定规则
- 对外品牌仅 semifly.ai，标语 It’s Your API.；“拼API”不再对外使用。正式 v1 SVG 保留轮廓，semifly 与点为 #1C2541，ai 为 #E43C2F，左侧图形保留原配色；不要恢复橙色旧 Logo 或临时字体字标。
- oneapi.glocalstorage.cn 独立建设，旧 api.glocalstorage.cn 保留。公众可注册。公司员工仅从低调管理入口进入，客户身份不能变成员工。
- 员工使用公司 Authentik OIDC/MFA；客户个人与企业共用独立客户身份。企业 owner/admin/department_admin/billing/member 的作用域由后端控制。
- 首位平台管理员 sales@glocalstorage.com，按身份中心不可变 UUID subject 绑定。不得凭邮箱匹配直接授予平台管理权。

## 进度
- **已上线**源码 092a9c8da134526cd3103fd6506a255df55d4db6；前端归档 SHA256 40274b1ef8fe88e2678a66bfdbe7cd2a836c125328faf2c3a14defef41762106；infra 发布配置 8c66a2046e84882ddec822f452443494a6a235e5。
- 真实邮箱注册/验证/登录/恢复/会话管理，企业创建/邀请/成员权限/停用/移除/审计，员工 SSO 与本地岗位授权、客户停用已实现。个人与企业入口均进入真实账户空间。
- 本机 21 项通过；最终生产镜像用临时独立测试库复测 11 项身份集成测试全部通过。生产 SMTP verify、OIDC discovery/PKCE、匿名 401、跨站 403、未知 API 404、未开通推理 503 通过。未发送真实测试邮件。
- 线上正式 SVG 与提交一致；浏览器实际登录页与管理员邮箱激活表单可见，无捕获的页面错误。旧平台与身份中心首页均 200。
- 独立 PostgreSQL 与非 superuser 应用角色；非 root/read-only API，无宿主机端口。每日备份已启用，首份备份已在临时库恢复（14 表）；测试库已清理。当前备份在主机本地，异地备份待纳入 infra 统一策略。
- 客户资金/Key/调用/促销未启用。企业 1000 元分配给员工的预算仍需接真实账本，不能沿用演示状态。

## 下一步
1. 用户本人到 https://login.glocalstorage.cn/if/flow/oneapi-staff-activation/ 用 sales@glocalstorage.com 验证邮箱、设置密码与 MFA，再从 /#staff 登录。首次真实员工 callback 尚待本人完成；不得代设密码或 MFA。
2. 推进供应商与产品验证的真实数据与采购凭据托管，再接模型商品/路由、支付账本和促销。采购账号和商户开通状态尚未确认，勿在聊天索取 Key。
3. 评审 oneapi PR #1、infra PR #400，当前未合并。网站版本以 /release.json 与 /api/status 为准，后续纯文档提交不会改变已部署 SHA。

## 入口文件与工具
- 本机工作树 /Users/m5/.worktrees/oneapi/phase-one-launch-design；分支 codex/phase-one-launch-design。infra 配置工作树 /Users/m5/.worktrees/infra/oneapi-aliyun；分支 codex-oneapi-aliyun。不要改动另有任务的主工作区。
- server/src、server/test/identity.test.mjs、web/identity.js、docs/phase-1/13-live-identity.md；品牌规范 design/spectrum/brand-and-icons.md。
- 阿里云运行目录 /srv/oneapi-runtime；私有配置 /srv/oneapi-config；数据 /srv/oneapi-data/postgresql；备份 /srv/oneapi-backups；Compose 项目 oneapi。密钥不能打印。
- 标准 Dockerfile 固定 Node 24.22.2 官方 digest。此次大镜像传输慢，使用 Dockerfile.cached-runtime，从已核对本地镜像仅复制 vendor Node/动态库/CA/许可证到 scratch，再放入本仓库产物；不继承旧平台代码、配置或数据。
