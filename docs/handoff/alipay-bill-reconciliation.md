# 支付宝账单自动核对

2026-11-15，m5。复用收款与退款页，不增加独立财务页面。

- `alipay.data.dataservice.bill.downloadurl.query` 查询 trade 日账单，RSA2 验签、HTTPS 下载、禁止跳转、16 MiB 限制、ZIP CRC 校验、UTF-8/GB18030 CSV 按表头解析。
- 北京时间 09:00 后每小时检查；按本地收款/退款日期补查，未取得的账单每 6 小时重试，近期 7 天重查，每轮最多 8 天。跨进程 advisory lock 防重入。
- 三重匹配商户单号、支付宝交易号、金额，校验收款日；只将实际收款服务费写入已有公司渠道成本。重复同步不累加，不修改客户余额、退款金额或交易次数。
- 手工登记保留优先级。未匹配、金额差异、未知格式保留待核对。非零退款服务费暂不自动处理正负方向，显示退费调整待核对；不能把未知费用记成零。
- `063_alipay_bill_reconciliation.sql` 为增量迁移。保存日状态、摘要 SHA256、费用来源和差异日期；费用变更进 audit_events。不保存临时下载地址或整份含其他客户数据的账单。
- 本地完整测试 93 项通过；Chrome 虚构数据页面验证同步入口及弹窗，无运行异常。
- 真实商户接口已只读调用并验签，但尚未取得首份可下载交易账单。不能声称真实手续费已经完成对账。上线后应核对第一份实际表头与退费列，必要时扩展已测试的格式；不猜费率或符号。

官方依据：
- https://help.alipay.com/enterprise/knowledgeDetail.htm?knowledgeId=201603401890
- https://opendocs.alipay.com/apis/api_15/alipay.data.dataservice.bill.downloadurl.query
- https://github.com/alipay/alipay-sdk-php-all/blob/master/v3/docs/Api/AlipayDataDataserviceBillDownloadurlApi.md

回滚可使用上一版 API/静态资源，保留增量字段与审计记录。发布前后核对客户账本及历史退款总额未变化。
