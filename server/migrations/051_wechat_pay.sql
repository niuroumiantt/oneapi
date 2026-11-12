-- WeChat Pay Native (扫码) recharge shares payment_orders / payment_refunds with Alipay.
-- out_request_no doubles as WeChat's out_refund_no; both are idempotency keys at the channel.
ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS payment_orders_provider_check;
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_provider_check CHECK(provider IN ('alipay_f2f','wechat_native'));
