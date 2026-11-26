# 个人 Dashboard 图表交接（2026-11-26，m5）

## 目标与授权

个人概览左侧按模型分色显示每日 Token：默认过去 7 天，展开过去 30 天；右侧过去 3 个月绿色使用热力图。用户已看过本地设计，并明确回复「好的，请上线」，允许本轮接入真实统计及发布。

## 实现

- 独立工作树 `/Users/m5/.worktrees/oneapi/personal-dashboard-charts-20261126`，分支 `codex/personal-dashboard-charts-20261126`，基于远程 `6d3d06a`。未修改有其他活跃任务的主工作区。
- `web/personal-usage-charts.js/css` 实现已确认版式、精确数值提示、月图展开、数值表、加载/空态/错误重试、手机横向滚动；identity 挂载/更新时连接组件，离开页面取消请求，不保留其他账号图表。
- `GET /api/customer-credit/usage/chart` 仅允许已认证个人账号。按账户 owner 聚合全量 customer_calls，保留停用 Key，排除 purpose=compare；不使用最近 100 条列表。
- 输入 + 输出 Token，缓存已包含在输入中；整数以字符串传输、BigInt 展示。未完整返回 Token 的请求单独提示，只统计已知值；不把费用表联入聚合，避免多额度包重复计数。
- 日期按 Asia/Shanghai；7/30 天含今天，热力图从「今天减 3 个自然月后加一天」到今天。月底由 PostgreSQL 自然月运算处理。空日期补零，热力图强度相对所选窗口峰值分四档。
- 正式静态构建清单已加入两份新资源；本地原型及 demo-data 不在发布清单里。

## 验证

- 独立临时 PostgreSQL 完整回归：256 项，237 通过、19 跳过、0 失败。修复两处导航测试缺失的模拟上下文；其中 comparePanel 缺失已在原远程基线独立复现。
- 新聚合 SQL 通过真实 PostgreSQL 测试：账号隔离、超过 100 次调用、停用 Key、比较 Key 排除、上海午夜/月底/跨年、大整数精度、空数据。
- 浏览器正式模块测试：7/30 根柱、92 日期格、模型 tooltip、展开与每日数值表、离开页面清理、加载/空态/错误重试；390×844 无整页横向溢出，月图内部横向滚动。桌面1440×1000复核；所有临时视口已重置。
- Impeccable detector 返回空发现。完整测试日志在 `/private/tmp/oneapi-dashboard-preview/full-database-tests-final.log`。

## 发布前基线

API source_sha=`728bd246feb0d0867c2c7b1948829aa1b1a80572`，静态 source_sha=`364ef0b128f8eac959e21e6ca36ac3e5acf0d6be`；原先只发布前端所以不同。当前基线完整包含两者，server/src 相比生产无其他未发布变化。

## 入口与后续

- 发布：`scripts/publish_shanghai.sh`，自带构建、数据库备份、健康检查及回滚。
- 正式页面： https://semifly.cn/#personal 。发布后核验 API/static SHA、新资源及未登录401。
- 本地正式模块验收（测试响应）： http://127.0.0.1:4197/#personal ，服务脚本 `/private/tmp/oneapi-dashboard-preview/production-preview.py`。
- 原始设计： `prototypes/personal-dashboard/`，只读样例预览4196；不要部署该服务。

## 公网发布回执

- PR #146 已合并：https://github.com/niuroumiantt/oneapi/pull/146 。生产代码版本 `95a365b20755889b65e774702817e56f84c853b4`。
- 直传全包速度过慢，在传输且未激活阶段停止；随后采用项目已有增量发布方法，仅上传 6 个变化静态文件及后端源码，共 771242 字节。
- 远端逐文件 SHA256 校验通过，重建完整 web.tgz 与本地正式包逐字节一致；同时核对旧前端及 API 版本仍符合预期，再执行标准 activate_release.sh。
- 镜像构建、数据库备份、迁移、服务重建及健康检查全部完成；发布退出0。
- 发布/回滚目录：`/srv/oneapi-data/oneapi-cutover-q72dymap/releases/95a365b20755.eZPV0X`，保留 previous-compose.yml、previous-web。
- 公网 `/api/status` 与 `/release.json` 均为 status=ok 且 SHA 与上面版本一致。新资源 `personal-usage-charts.d1a05b18ba77.js` 和 `personal-usage-charts.db293657d480.css` 已下载核对内容及哈希。
- 未登录请求新接口返回401。使用浏览器已有登录态查看个人概览，真实当前账号返回零用量空态；已验证7根柱占位、92日格、展开30根柱、收起，以及无预览控件。不伪造彩色使用记录，未生成生产 Key 或执行收费调用。
- 非空数据展示由本地正式模块响应测试及真实 PostgreSQL 聚合测试覆盖；本轮公网账号没有非零数据可供验收。
- 发布日志：`/private/tmp/oneapi-dashboard-preview/delta-publish.log`。这份发布回执属于文档后续提交，无需再次部署。

