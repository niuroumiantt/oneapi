# 微信支付 Native（扫码充值）接入与上线

2026-11-12。代码已支持个人和企业账户用微信扫码充值，商务后台可以原路退款。订单表、退款表和资金账本与支付宝共用，见 [支付宝当面付](alipay-f2f.md)。默认关闭：配好下面的商户参数并打开开关后，充值页才会出现“微信支付”选项；支付宝和微信都开通时，客户可以选择其中一种。

## 流程

1. 客户在充值页选择“微信支付”和金额，点“生成微信支付付款码”。
2. 服务端建一笔金额固定的订单（`provider = wechat_native`），调用 `POST /v3/pay/transactions/native`，拿到 `code_url` 后渲染成二维码。`time_expire` 设为 15 分钟后，过期后无法再付款。
3. 客户用手机微信扫码付款。
4. 两条确认途径都调用 `creditPaidOrder`，同一笔订单只入账一次：
   - 微信支付通知 `POST /api/payments/wechat/notify`。服务端先用“微信支付公钥”验证请求头签名（同时检查公钥 ID，并要求时间戳在 5 分钟以内），再用 APIv3 密钥对 `resource` 做 AES-256-GCM 解密，最后核对商户号、AppID、订单号、渠道和金额。成功时返回 204，失败时返回 4xx/5xx，微信支付会重试。
   - 付款页每 3 秒轮询一次，服务端调用 `GET /v3/pay/transactions/out-trade-no/{no}` 主动查单。即使通知丢失，也不会漏入账。
5. 微信支付返回的每个应答都必须带有效签名。没有签名或签名不对的应答，只当作错误记日志，不会改变订单或余额。

## 退款（商务后台 → 财务 → 收款与退款）

规则与支付宝相同：只能退已付款订单，可以分多次部分退，必须填写原因，退款金额不能超过账户现金余额。发起时先从余额中扣出这笔钱，然后调用 `POST /v3/refund/domestic/refunds`，`out_refund_no` 用退款请求号。

- 微信退款一般先返回“处理中”，结果通过同一个通知地址回传（`REFUND.SUCCESS` / `REFUND.CLOSED` / `REFUND.ABNORMAL`），系统会自动完成。员工也可以点“确认退款结果”：系统先按退款单号查询，只有微信那边查不到时，才用同一单号重新提交。
- 退款成功（`SUCCESS`）：完成。
- 退款关闭（`CLOSED`），或者微信明确拒绝（`NOT_ENOUGH` 余额不足、`INVALID_REQUEST`、`PARAM_ERROR` 等）：自动写一条“冲正”，把钱加回余额。
- 退款异常（`ABNORMAL`，通常是用户的银行卡已注销）：保持“处理中”。这种情况要在商户平台的 **交易中心 → 退款管理** 里处理。
- 退款优先从未结算资金中扣，不够时扣基本账户。基本账户余额不足会返回 `NOT_ENOUGH`，系统会自动冲回余额，员工可以充值后重新发起。

审计事件为 `billing.recharge.wechat_paid`、`billing.refund.requested`、`billing.refund.wechat_succeeded`、`billing.refund.wechat_rejected`。

## 商户侧准备（pay.weixin.qq.com）

1. **产品中心 → 我的产品**：开通 **Native 支付**。
2. **产品中心 → AppID 账号管理**：关联一个与商户同主体的 AppID（服务号、小程序或网站应用都可以），并在 AppID 一侧确认授权。Native 下单必须带这个 AppID。
3. **账户中心 → API 安全**：
   - 设置 **APIv3 密钥**（32 位字符）。
   - 申请 **商户 API 证书**，用证书工具得到 `apiclient_key.pem`（商户私钥）和证书序列号。
   - 在 **微信支付公钥** 中下载 `pub_key.pem`，并记下公钥 ID（`PUB_KEY_ID_` 开头）。本系统只支持“微信支付公钥”验签模式；如果商户号还在用平台证书，需要先在这里申请切换到公钥模式。
4. 回调地址不需要在后台配置。下单和退款时会带上 `APP_ORIGIN + /api/payments/wechat/notify`。

## 服务器配置

所有密钥只放在服务器文件里，不进 git，不写入镜像，也不要发到聊天里。

| 环境变量 | 说明 |
| --- | --- |
| `WECHATPAY_ENABLED` | 填 `true` 才启用 |
| `WECHATPAY_MCH_ID` | 商户号 |
| `WECHATPAY_APP_ID` | 已关联的 AppID |
| `WECHATPAY_CERT_SERIAL` | 商户 API 证书序列号 |
| `WECHATPAY_PRIVATE_KEY_FILE` | `apiclient_key.pem` 的路径 |
| `WECHATPAY_PUBLIC_KEY_ID` | 微信支付公钥 ID（`PUB_KEY_ID_…`） |
| `WECHATPAY_PUBLIC_KEY_FILE` | `pub_key.pem` 的路径 |
| `WECHATPAY_API_V3_KEY_FILE` | 存放 APIv3 密钥的文件路径，文件里只写这 32 位密钥 |
| `WECHATPAY_GATEWAY` | 不填时用正式地址 `https://api.mch.weixin.qq.com` |
| `WECHATPAY_ALLOWED_EMAILS` | 逗号分隔的邮箱。填写后只有这些账户能用微信充值；留空表示所有登录用户都能用 |

通知路径不做同源检查，只靠签名校验。前面如果有反向代理，要确认 POST 请求和请求体原样透传到这里。

数据库迁移为 `051_wechat_pay.sql`，按原有流程执行 `npm run migrate`。

## 上线前检查

- [ ] 用 `WECHATPAY_ALLOWED_EMAILS` 只开放给内部账号，真实付一笔 ¥5，余额到账，并与商户平台的交易订单核对一致。
- [ ] 对这笔订单做一次部分退款，确认微信收到退款、退款通知自动把状态改为“已退回”，并与退款管理核对一致。
- [ ] 验证通过后，清空 `WECHATPAY_ALLOWED_EMAILS` 对所有用户开放。
