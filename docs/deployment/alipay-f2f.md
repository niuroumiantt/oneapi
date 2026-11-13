# 支付宝电脑网站支付（账户充值）接入与上线

> 原文件名保留；产品已从「当面付」改为 **电脑网站支付**（线上网站收款，无需线下门店）。

2026-11-13。代码支持个人和企业账户用支付宝收银台充值（PC 跳转；收银台内可扫码）。默认关闭：配置商户参数并打开开关后，充值页才会出现「去支付宝付款」。

## 付款流程

1. 客户在账单页选金额，点「去支付宝付款」。
2. 服务端在 `payment_orders` 建一笔固定金额订单，用 RSA2 签发 `alipay.trade.page.pay` 请求（`product_code=FAST_INSTANT_TRADE_PAY`），把收银台 URL 存进订单并返回 `pay_url`。
3. 浏览器新开支付宝收银台；用户扫码或登录付款。付款链接有效期 15 分钟。同一幂等键重复提交返回同一笔订单。
4. 付款确认有两条途径，都只入账一次：
   - 支付宝异步通知：`POST /api/payments/alipay/notify`（验签、`app_id`、`seller_id`、订单号、金额）。
   - 页面轮询 `GET /api/billing/alipay-orders/:id`，服务端调用 `alipay.trade.query`。
5. 入账事务：增加 `cash_balance_fen` 与 `list_credit_fen`（当前 1:1），写 `billing_ledger` 充值，标记已付款，审计 `billing.recharge.alipay_paid`。
6. `return_url` 把用户带回账单页；是否到账以通知/查单为准，不以回跳为准。

签名不对、商户不对、金额不一致一律不入账。

## 退款

与原先一致：商务后台原路退，`alipay.trade.refund`；明确拒绝则冲正。规则见官价额度退款说明（未用占比 × 实付 − 15%；已开发票不退）。

## 商户侧准备（不要签当面付）

没有线下门店时，**不要**开通当面付。按线上网站收款签约：

1. **商家平台 b.alipay.com → 产品中心**：开通 **电脑网站支付**（需要时再开 **手机网站支付**）。
2. **开放平台 open.alipay.com**（网页/移动应用，如 AppID `2021007119640179`）：
   - 应用绑定「电脑网站支付」能力；提交审核并上线。
   - 接口加签 **公钥模式 RSA2**：上传应用公钥，下载**支付宝公钥**。
   - **应用网关**（及异步通知所用公网地址）指向：  
     `https://oneapi.glocalstorage.cn/api/payments/alipay/notify`  
     （代码里 `notify_url` 为 `APP_ORIGIN + /api/payments/alipay/notify`。）
   - 与商家平台收款主体绑定，记下 PID（`2088…`）。
3. 建议先在沙箱用沙箱 APPID/密钥把跳转、通知、查单、退款走通。

## 服务器配置

密钥只放服务器文件，不进 git。

| 环境变量 | 说明 |
| --- | --- |
| `ALIPAY_ENABLED` | `true` 才启用 |
| `ALIPAY_APP_ID` | 开放平台 APPID |
| `ALIPAY_PRIVATE_KEY_FILE` | 应用私钥路径 |
| `ALIPAY_PUBLIC_KEY_FILE` | **支付宝公钥**路径（不是应用公钥） |
| `ALIPAY_SELLER_ID` | 商户 PID；正式环境必填 |
| `ALIPAY_GATEWAY` | 默认正式网关；沙箱用 `https://openapi-sandbox.dl.alipaydev.com/gateway.do` |
| `ALIPAY_ALLOWED_EMAILS` | 逗号分隔；填了则仅这些邮箱可见支付宝充值 |

## 上线前检查

- [ ] 商家平台「电脑网站支付」已开通；开放平台应用已绑定并上线。
- [ ] 沙箱：跳转收银台、异步通知入账、断通知后查单补账、过期关单。
- [ ] 正式 APPID + `ALIPAY_ALLOWED_EMAILS` 内部试付 ¥5，与商家账单一致。
- [ ] 商务后台对该笔做一次部分退款，核对到账。

微信扫码充值见 [微信支付 Native](wechat-pay-native.md)。
