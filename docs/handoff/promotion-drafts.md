# 促销活动草稿交接

2026-11-07，oneapi。此阶段在 `#ops/promotions` 将浏览器演示活动替换为内部真实数据库草稿，关联已经登记的客户模型商品。活动仅支持创建和读取；数据库状态约束为 `draft`，不生成优惠码，不对客户公开，不产生付款、消费或返佣。

表 `promotion_campaigns` 由迁移 `004_promotion_drafts.sql` 创建。比例以整数百分比保存，优惠总预算以整数分保存；开始和结束时间必须有效且期限不超过一年。暂停的模型商品或来源供给不能创建活动。岗位：platform_admin、operations 可创建；finance 只读；其他员工及客户无权访问。创建写入平台审计。

已于 2026-11-07 部署：提交 `8711058`、后端镜像 `oneapi-identity:8711058`，静态包 SHA256 `ced9822e3655862cd58586b0c6b7685898de491ce85d36eb340da76a6a9408ef`。上线前数据库备份为 `/srv/oneapi-backups/oneapi-before-promotions-8711058.dump`。公开 `/release.json` 和 `/api/status` 的版本一致；27 项隔离数据库测试通过，匿名访问促销接口返回 401，旧 `api.glocalstorage.cn` 仍正常。`business_ready=false`，实际支付与交易仍关闭。

下一步先取得实际商户与供应资格，建立客户价格版本、订单与不可重复入账的账本，再实现活动发布审批、码与兑换、消费时价格快照、佣金及退款冲回。
