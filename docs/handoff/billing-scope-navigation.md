# 个人与企业资金空间、账单导航交接

2026-11-07，功能提交 `515b0a322158d16269bde9ba36b91c3813313e35` 已推送并部署到 `oneapi.glocalstorage.cn`。静态包 SHA256：`0f077b77a9c9760e23183fd1dc69b7d5e3faaf6699ada45ebfd75d3f1b47bfb2`。前端 `/release.json` 与 API `/api/status` 已同版；旧 `api.glocalstorage.cn` 返回 200。API 容器仍运行原后端代码，仅备份并更新 `SOURCE_SHA` 配置，备份在 `/srv/oneapi-config/identity.before-515b0a3.env`。

## 已完成

- 修复选过模型后进入 `#demo/personal` 或 `#billing/personal` 时，模型意图提示把布尔值当 DOM 元素调用导致的 `target?.querySelector is not a function`。已用用户当前 Chrome 会话复查两个页面可打开。
- 账单页明确显示当前是个人或企业资金账户，入口可切换空间；无企业成员关系的个人用户不会看到无效的企业资金链接。
- 在 [预付充值方案](../phase-1/20-recharge-system.md) 写明一个邮箱对应一个用户 ID，可加入多个企业；个人、各企业的余额与 API Key 按空间隔离。充值订单未来需分别记录入账账户、发起用户和商户确认的付款交易，不能用邮箱代替实际付款人。
- `node --check web/identity.js`、`git diff --check` 和独立企业预算测试 10/10 通过。完整 `npm test` 在当前沙箱因禁止监听 `127.0.0.1` 取消了服务端集成测试；后端代码未改动。

## 下一步

商户尚未开通，客户人民币模型价格尚未批准；真实充值、付款人记录、退款与调用仍不可用。按 `docs/phase-1/20-recharge-system.md` 建订单时，固定 `billing_account_id`，在支付成功通知验签和查单后记录商户交易及渠道允许保存的付款方标识，再在同一事务里入账。企业员工预算只限制企业账户消费，不另建可混用现金余额。退款关联原付款交易，按商户最终结果更新账务；15% 手续费尚未启用。
