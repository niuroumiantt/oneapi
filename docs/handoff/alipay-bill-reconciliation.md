# 支付宝账单自动核对

2026-11-15，m5。复用收款与退款页，不增加独立财务页面。

- `alipay.data.dataservice.bill.downloadurl.query` 查询 trade 日账单，RSA2 验签、HTTPS 下载、禁止跳转、16 MiB 限制、ZIP CRC 校验、UTF-8/GB18030 CSV 按表头解析。
- 北京时间 09:00 后每小时检查；按本地收款/退款日期补查，未取得的账单每 6 小时重试，近期 7 天重查，每轮最多 8 天。跨进程 advisory lock 防重入。
- 三重匹配商户单号、支付宝交易号、金额，校验收款日；只将实际收款服务费写入已有公司渠道成本。重复同步不累加，不修改客户余额、退款金额或交易次数。
- 手工登记保留优先级。未匹配、金额差异、未知格式保留待核对。非零退款服务费暂不自动处理正负方向，显示退费调整待核对；不能把未知费用记成零。
- `063_alipay_bill_reconciliation.sql` 为增量迁移。保存日状态、摘要 SHA256、费用来源和差异日期；费用变更进 audit_events。不保存临时下载地址或整份含其他客户数据的账单。
- 本地完整测试 93 项通过；Chrome 虚构数据页面验证同步入口及弹窗，无运行异常。
- 已取得实际 trade 账单并确认服务费扣款以负数表示。收款服务费仅接受零或负数且绝对值不超过收款额，转换为正的公司渠道成本；正数异常不盲目取绝对值。非零退款费用仍保持待核对。
- 符号修复测试覆盖负手续费、零费用、异常正数/超额、收款加退款的重复同步、费用版本及审计不重复、客户余额不变；完整 93 项测试通过。生产验收应复查订单费用来源、经营成本汇总、差异清除，以及两次同步后的费用版本和审计条数一致。

官方依据：
- https://help.alipay.com/enterprise/knowledgeDetail.htm?knowledgeId=201603401890
- https://opendocs.alipay.com/apis/api_15/alipay.data.dataservice.bill.downloadurl.query
- https://github.com/alipay/alipay-sdk-php-all/blob/master/v3/docs/Api/AlipayDataDataserviceBillDownloadurlApi.md

回滚可使用上一版 API/静态资源，保留增量字段与审计记录。发布前后核对客户账本及历史退款总额未变化。
