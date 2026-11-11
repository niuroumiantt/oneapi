# 支付宝当面付（扫码充值）接入与上线

2026-11-11。代码已经支持个人和企业账户的支付宝扫码充值。默认是关闭的：配置了支付宝商户参数并打开开关之后，充值页才会显示付款码。

## 流程

1. 客户在 `#billing/personal` 或 `#billing/organization/<id>` 选择金额（¥5.00–¥50,000.00），然后点击“生成支付宝付款码”。
2. 服务端在 `payment_orders` 中建一笔金额固定的订单，再调用 `alipay.trade.precreate` 拿到 `qr_code`，渲染成 SVG 二维码返回给页面。付款码有效期 15 分钟。同一个幂等键重复提交时，返回的是同一笔订单。
3. 客户用手机支付宝扫码付款。
4. 有两条确认途径，最终都走 `creditPaidOrder` 同一个函数，同一笔订单只会入账一次：
   - 支付宝异步通知：`POST /api/payments/alipay/notify`。服务端验证 RSA2 签名、`app_id`、`seller_id`、订单号和金额。
   - 页面每 3 秒查询一次 `GET /api/billing/alipay-orders/:id`，服务端随之主动调用 `alipay.trade.query`。所以就算异步通知丢了，也不会漏掉入账。
5. 入账在一个数据库事务里完成：增加 `billing_accounts.cash_balance_fen`，追加一条 `billing_ledger` 充值记录（`reference_id` 为订单 id，带唯一约束），把订单标记为已付款，再写一条审计事件 `billing.recharge.alipay_paid`。

以下情况一律不入账：签名不对、商户不对、金额不一致。服务端记录日志并返回 `failure`，支付宝会继续重试通知。

## 商户侧准备（支付宝后台操作）

1. **商家平台 b.alipay.com → 产品中心**：签约 **当面付**。
2. **开放平台 open.alipay.com**：
   - 创建“网页/移动应用”，并绑定这个企业账号的 PID。
   - 添加“当面付”能力。
   - 接口加签方式选 **公钥模式 RSA2**：用支付宝密钥工具生成应用私钥/公钥，把应用公钥上传，再下载“支付宝公钥”。
   - 提交审核，上线后拿到 APPID。
3. 先在开放平台的 **沙箱** 里用沙箱 APPID、沙箱密钥和沙箱买家账号把流程走通。

## 服务器配置

密钥只放在服务器文件里，不进 git，也不写进镜像。文件内容可以是 PEM，也可以是密钥工具导出的裸 base64；私钥支持 PKCS#8 和 PKCS#1 两种格式。

| 环境变量 | 说明 |
| --- | --- |
| `ALIPAY_ENABLED` | 填 `true` 才启用；没填时充值入口保持关闭 |
| `ALIPAY_APP_ID` | 开放平台应用 APPID |
| `ALIPAY_PRIVATE_KEY_FILE` | 应用私钥文件路径 |
| `ALIPAY_PUBLIC_KEY_FILE` | **支付宝公钥**文件路径（不是应用公钥） |
| `ALIPAY_SELLER_ID` | 商户 PID（2088 开头）。配置后，通知里的 `seller_id` 必须与它一致；正式环境必须填 |
| `ALIPAY_GATEWAY` | 不填时用正式网关；沙箱填 `https://openapi-sandbox.dl.alipaydev.com/gateway.do` |
| `ALIPAY_ALLOWED_EMAILS` | 逗号分隔的邮箱。填了就只有这些账户能看到并使用支付宝充值，适合正式开放前小范围实测；留空表示所有登录用户都可以用 |

异步通知地址固定为 `APP_ORIGIN + /api/payments/alipay/notify`，所以 `APP_ORIGIN` 必须是公网可访问的 HTTPS 地址。这个路径不做同源检查，只靠签名校验。如果前面有反向代理，要确认 POST 能透传到这里。

新的数据库迁移是 `031_payment_orders.sql`，按原有流程执行 `npm run migrate` 即可。

## 上线前检查

- [ ] 沙箱环境里：扫码付款、异步通知入账、断开通知后靠查单补账、付款码过期，四种情况都已验证。
- [ ] 正式 APPID 用 `ALIPAY_ALLOWED_EMAILS` 限定内部账号，真实付一笔 ¥5，与商家平台账单核对一致。
- [ ] 退款流程（`alipay.trade.refund`）尚未实现。在它上线之前，退款只能人工在商家平台操作，并另行记账。
- [ ] 按 [支付、促销码与返佣](../phase-1/03-payments-and-promotions.md) 的要求，正式对外开放前还需完成商品售价、供应、用量账本的验收。
