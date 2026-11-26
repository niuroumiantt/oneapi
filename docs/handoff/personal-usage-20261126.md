# 个人用量与 Key 额度进度条 · 2026-11-26

## 范围与状态

用户要求先提交、上线已确认的概览、我的模型、通用/专属 Key 流程，然后同步研究用量；随后要求 Key 的消费上限和已用额度用进度条展示。

前一阶段提交是 `f0076f4a8bd0294bd69023a7767681e9f696d9f3`，已推送 origin/main；其发布回执见 personal-model-journey-20261126.md。用量和进度条已作为后续提交 `4441bb8940263839775183e9a3d814f6932850e6` 推送，并按用户确认发布到公网；发布回执见下文。

## 当前实现

- 用量只有「按模型 / 按 Key」两个视图，共用同一统计结果，总额不重复相加。
- 表格仅保留名称、输入 Token、输出 Token、费用；顶部本月、最近 7 天、累计。
- 普通桌面每页 5 行；窄屏或高度低于 680 CSS px 时每页 3 行，分页而不增加页面高度。
- Key 的名称、尾号、已停用状态用于区分；已停用 Key 的历史用量保留。
- API 密钥页把上限与已用合并为「额度使用」：准确金额 + 细进度条，80% 起橙色，满额显示「已达上限」。保留调整上限和停用按钮。
- 加载失败明确显示错误并可重试；空数据单独显示，不伪造费用。

## 数据口径

新增 GET /api/customer-credit/usage?period=month|week|all，使用 requireCustomer 和已认证用户 ID。

从 customer_calls 全量聚合所选时段的个人 API 调用，不依赖 status 接口最近 100 条记录。排除 purpose=compare 的比较专用 Key。本月按 Asia/Shanghai 月初；最近 7 天为滚动 7 天；按调用创建时间归属时段。

费用取已结算 credit_consumptions.cash_fen，即实付消耗，赠送额度不计入。未结算请求另提示条数。一次调用跨多个额度包扣款时先汇总金额，避免重复计算 Token。与 Key 页的官价额度上限/已用额度不是同一种金额，页面已标注口径。所有整数用 BigInt 汇总和格式化。

## 验证

- 独立 PostgreSQL 测试：超过 100 条记录、多个额度包、历史/近期时间范围、跨账号隔离、排除比较 Key、停用 Key 保留，以及大整数精度。
- personal-usage 与 personal-model-journey 共 16 项通过；JS 语法检查和 diff --check 通过。
- 浏览器验证本月/7 天切换、模型/Key 切换、上一页/下一页、空态、错误重试。
- 实测 CSS viewport 1309×818 / 1163×582 / 391×685；用量和五把 Key 的主要内容区 scrollHeight=clientHeight，未用 overflow:hidden 掩盖纵向溢出。
- 用户浏览器的缩放约 110%，viewport override 值与实际 CSS viewport 有差异；所有临时尺寸已重置。

## 本地预览

- 用量：http://127.0.0.1:4182/?scenario=existing#personal/usage
- 进度条：http://127.0.0.1:4181/?scenario=exhausted#personal/keys
- 4182 是 /private/tmp/oneapi-usage-preview/serve.py，显示模拟数据；服务直接读取 repo/web。
- 4181 是已有 journey-serve.py，保留用户已创建的模拟 Key。不要为刷新源码而重启它。
- 后端真实统计接口已实现并通过独立测试，预览页面本身没有连接生产用户数据。

## 发布基线已知问题

完整基线测试有 3 项既有失败（Alipay return URL 旧断言、退款 fixture、API 对比金额断言），已在改动前生产源码复现。此次没有修改支付结算逻辑。前一阶段完整测试为 214 项：193 通过、18 跳过、3 既有失败。


## 公网发布回执

用户确认「把用量页和进度条也上线，我们直接在公网测试」。标准 scripts/publish_shanghai.sh 完成传输校验、镜像构建、数据库备份、迁移、API 容器健康检查和前端静态发布，退出 0。

- 线上版本：4441bb8940263839775183e9a3d814f6932850e6。
- 发布及回滚目录：/srv/oneapi-data/oneapi-cutover-q72dymap/releases/4441bb894026.ziuWVz，保留 previous-compose.yml、previous-web 和发布包。
- 公网 /api/status 与 /release.json 均返回 status=ok，source_sha 与发布提交一致。
- 公网页面引用 identity.ff2d7c017627.js 和 identity.2b35d2ebca46.css，已读取核对用量 API 路径及进度条代码/样式存在。
- 未登录访问 /api/customer-credit/usage?period=month 返回 401，没有泄漏个人用量。
- 本次未代用户登录、生成生产 Key、调整生产上限或执行付费调用。登录后的真实账号数据由用户在公网测试。
- 用量入口：https://semifly.cn/#personal/usage
- 进度条入口：https://semifly.cn/#personal/keys
