# VIP 月账单与收件箱 · 2026-11-26

## 用户确认的口径

每月北京时间 1 日自动生成上月 PDF 月账单并放入 VIP 站内收件箱。账单包含脱敏的客户实付、实际消费、退款和提成明细，按推广码汇总。概览不再展示预计/解锁/提现中等多段彩条。

充值和消费按发生月份分别记账：本月消费了之前月份充值的实付额度，提成归本月。实际消费仅指实付额度消耗，不含赠送额度。提成取既有 used 佣金事件的实际金额；paid 产生的预计收益不计入，退款取消的未赚取预计收益也不重复扣减已消费提成。提现的原有结算、核验和税额流程未更改；自动出账不等于自动付款。

## 实现

- `web/cw.js` / `web/cw.css`：概览为本月实付/实际消费 + 最新月账单入口；推广码显示各码本月数据；收件箱替换主导航推广明细，支持分页、已读、PDF、修订历史。未开通或暂停用户仍能看历史账单。
- `server/src/vip-statements.mjs`：按北京时间自然月生成、存档、列举及鉴权读取 PDF；多 worker 事务锁和唯一键防重复；中断后补发；晚到的消费记录生成新版本，旧版保留。
- `server/src/index.mjs`：启动 15 秒后开始检查，此后每分钟最多处理 10 份。仅 CW 功能启用时执行。不是依赖用户登录的前端定时器。
- `server/migrations/090_vip_monthly_statements.sql`：逻辑账单、不可变版本 PDF/JSON/SHA256、已收录事件三个表。版本存于数据库 BYTEA，包含在数据库备份中。
- `server/src/vip-statement-pdf.mjs`：PDFKit 0.17.2，嵌入 Noto CJK 的 OFL 子集字体，A4 自动分页与重复表头。客户个人信息和原始订单 ID 不进入存档；使用月内匿名交易编号。
- API `/api/cw/statements`、`/:id/pdf?revision=N`、`/:id/read` 均核对登录客户的 partner 所有权；PDF 禁止缓存。
- 字体来源和授权见 `server/assets/fonts/README.md` 与 `OFL.txt`；新增中文 PDF 文案时需要扩充字体子集。

## 验证

43 项测试通过：20 项 PDF/个人 UI/导航测试、6 项月账单数据库集成测试、17 项既有 CW 后端回归测试。最终文本和月范围修改后再次通过 20 + 6。

覆盖北京时间月界、生成失败回滚、并发只生成一次、停机补发、晚到记录修订、旧版不变、新版未读、其他 VIP 无权读取、超大整数金额和多页 PDF 无遗漏。临时 PostgreSQL 为 127.0.0.1:55527，专用测试数据库，未接生产数据。

真实浏览器验证桌面概览和收件箱、点击 PDF 后已读状态；iframe clientHeight=scrollHeight=524px。当前浏览器的 viewport override 未作用于目标 tab，因此本轮不宣称完成手机实测。源码保留响应式分页。Impeccable 两文件正则扫描无发现，非完整可访问性审计。

样例 PDF 已渲染并逐项看图核对，为一页演示数据；70 条记录的多页测试提取文本后验证每个匿名编号均存在。

## 本地交付与发布边界

本地预览：http://127.0.0.1:4194/?scenario=existing#personal/vip
预览脚本：`/private/tmp/oneapi-vip-monthly-preview.py`，仅 mock，不连接生产。
演示 PDF：`/Users/m5/code/oneapi/output/pdf/vip-monthly-statement-demo.pdf`
截图：`/Users/m5/code/oneapi/output/vip-monthly-overview.jpg`、`vip-monthly-inbox.jpg`。

本轮仅在 `codex/vip-workspace-20261126` 独立工作树实现、验证和提交，未推送、未合并 main、未上线。未真实发送账单、支付、退款、签约或提现。

将来发布必须一起包含后端、迁移 090、依赖、字体和前端，不能只替换静态文件；合并时检查迁移编号是否与其他活跃分支冲突。不要发布 `/Users/m5/code/oneapi` 其他员工后台任务的未审改动。历史说明以本交接中月账单口径为准。
