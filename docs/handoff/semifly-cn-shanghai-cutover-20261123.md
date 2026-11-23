# OneAPI 上海正式迁移

2026-11-23 · 北京时间

## 环境

- 源机为青岛 OneAPI `47.104.143.95`，操作入口是 m4 上的 `aliyun` SSH 配置。目标是上海 OneAPI `47.101.153.99`，ECS `i-uf6b0ral8kav1la89x8h`，应用数据盘挂载在 `/srv/oneapi-data`。
- 生产数据传输为青岛 → m4 → 上海。m5 负责操作和验证。快照及运行配置仅在各端受限目录中存放。
- 上海保留生产 API `8e53711f03ee56bd1d9cb2830f9a23c9439431a2` 和 PostgreSQL `16.10`。候选前端 `025d0cff7a244a37f520e9ee5b330053d7ebfb7c` 由 `scripts/build_static.py --domain semifly.cn` 生成。上海逐文件校验了 189 个静态文件。
- 阿里云控制台显示管局于 2026-11-23 11:56 审核通过。网站主办单位是上海艾泽可科技有限公司。首页底部居中挂 `沪ICP备2024050749号-3` 并链接工信部。充值页的备案域名与备案号随域名配置，收款方沿用原商户。按开通日期办理公安联网备案，取得编号后再挂对应的公安备案链接。

## 切换前的验收

- 最新线上快照在上海的恢复回执为 `/srv/oneapi-data/oneapi-rehearsal-c_4xxs_b/receipt.json`。恢复库与源端同一快照的账务摘要一致，其中包括钱包、订单、退款、账本、用量和佣金。隔离回执 `/srv/oneapi-data/oneapi-candidate-yzQCjn39/probe.log`。
- 上海在独立测试库运行生产同版 48 项集成测试，全部通过。包含客户及员工登录流程、API 认证与用量、签名支付通知、重复通知幂等、退款及对账。
- 上海用最新恢复副本验证了 `semifly.cn` 的客户登录和安全 Cookie、客户钱包及真实模型目录。隔离副本的同一把测试 API Key 在新旧 Host 下均可认证。支付宝和微信旧域 POST 均抵达签名验证。
- 上海直接向支付宝和微信签名查单，核对历史付款金额、交易状态和微信历史退款。另逐笔核对 11 笔待支付订单。验收未产生真实新扣款，也未要求支付商户重新发送成功通知。
- Authentik 的 OneAPI 专用 OAuth2 Provider 已增加 `https://semifly.cn/api/staff/callback` 精确回调，原回调继续可用。上海已核对真实 OIDC discovery。
- 上海安全组已放行公网 TCP 80/443。青岛到上海的旧域 TLS 连通性测试返回 204。阿里云 DNS 列表初始无记录。
- 青岛于 15:10:49 停止原 OneAPI API 和后台 worker，启动最终采集。切换前只有青岛是权威账本。源端设有 55 分钟回退计时器，运行权威转移标记出现后计时器禁止重新启动青岛 API。

## 运维记录

- 上海专用运行目录为 `/srv/oneapi-data/oneapi-cutover-q72dymap`。生产启动入口是其中的 `production/compose.yml`。数据库容器是 `oneapi-sh-db`，API 容器是 `oneapi-sh-api`，入口是 `oneapi-sh-edge`。
- 青岛 Caddy 候选与原配置的备份位于 `/var/lib/docker/volumes/mainland_caddy_config/_data/oneapi-cutover-dLDZoYHv`。保持旧域 `/v1/models`、`/v1/chat/completions` 和两个支付通知 POST 原样转发到上海。只替换 OneAPI 管理区块。上海取得新域公开证书后，旧代理以 `semifly.cn` 验证上海 TLS。
- 上海的 Skills 数据位于 `/srv/oneapi-data/oneapi-skills-data`，由 `oneapi-sh-skills.timer` 每天 09:00 更新。数据库备份为 `oneapi-sh-backup.timer`，每日北京时间 03:40 左右执行。
- 上海写入前，失败可恢复青岛原 API。上海开始写入后，回退应保持同一套账本；需要切回整机时，先停止上海写入，用上海末次备份反向恢复和对账，再切换流量。

## 正式结果

- 最终快照采集用时 1189.07 秒，SHA-256 校验通过。最终停写快照在上海恢复，账务摘要一致。回执为 `/srv/oneapi-data/oneapi-stage-be5otw6v/receipt.json`。15:39:04 记录权威账本转到上海，青岛旧 API 确认为 `exited`。
- 15:40:31 添加根域 `@ A 47.101.153.99`，15:41:46 添加 `www CNAME semifly.cn`，两条 TTL 都是 600 秒。已通过阿里云权威 DNS 核对。HTTPS 公网健康检查、新旧域 API Key 认证守卫、旧域支付 POST、`www` 跳转、Skills 和员工 OIDC 重定向均通过。
- Chrome 公网核对首页备案号可见，文字水平居中，链接指向 `https://beian.miit.gov.cn/`。青岛共享 Caddy 保持热加载前的进程启动时间。
- 线上观测定时器 `oneapi-sh-monitor.timer` 已运行，健康探测为真并记录实际前后端版本。上海 Skills 首次刷新成功。三项定时器均启用。
- infra 迁移分支提交 `024afee` 已保存旧域兼容路由，供后续共享入口发布沿用。该提交保留在本地迁移分支。
- 上海首份正式备份为 `/srv/oneapi-data/backups/oneapi-20261123T074208Z`。备份已从生产快照独立恢复，SHA-256 和账本摘要均已核对，完成回执为目录下的 `restore-verified.json`。48 小时线上观察从本次切换开始。
- 上海安全组的快捷表单为同一组 80/443 同时生成两条私网网段规则，范围已由两条公网规则包含。数据库和内部 API 容器运行在 Docker 私网，端口发布仅用于 Caddy 入口。
