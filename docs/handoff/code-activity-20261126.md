# 按优惠／推广码查看收支 · 2026-11-26

## 范围与状态

用户已明确“个人的码”指优惠／推广码，不含 API Key。当前实现保存在 `codex/vip-workspace-20261126`，基于月账单提交 c82860e。此次仅本地实现与验证，未合并 main、未上线、未触发真实付款、退款或通知。

## 已实现

- 共用 `/code-activity.html`：月份／全部时间，付款、使用、退款三个标签，汇总金额及按可用高度分页。
- VIP 推广码、自用码、本人付款码均可查看历史收支；停用码可查账。`task_codes` 仍只返回可用付款码，新增 `task_code_history` 仅用于历史列表，不恢复历史码付款能力。
- 员工直营码和所属 VIP 码可进入同一明细页；直营码列表增加实付消耗，生成码表单压缩为双列。
- 个人“充值与账单”增加“优惠码明细”入口，只能看到本人个人账单账户使用的优惠码订单，不能看到其他客户及 VIP 提成。
- 金额读取 payment_orders、credit_packs、credit_consumptions、customer_calls、payment_refunds 和 cw_commission_events；没有新建财务记账路径。
- 使用金额分别显示实付消耗、额度消耗；退款分别显示扣减本金、实际退回；提成取既有消费事件，正式结算继续以月账单为准。
- 服务端执行角色和归属校验；客户身份、订单和调用原始 ID 不返回，展示范围内稳定的匿名编号。无 Key、请求内容、联系方式。

## 验证

- code-activity + personal-vip-ui + vip-statements：16 项全部通过（包含 5 项按码权限／金额测试）。
- cw-partners：17 项全部通过。
- 补验按码第二页无重复、停用码仍可读取：5 项重新通过。
- JS 语法检查、git diff --check 通过。
- 浏览器实际检查：VIP 嵌入明细 1152×464、公共明细窄屏 390×442 / 短屏 900×400 均无内容区滚动；员工明细 1248×618；员工创建码表单在 723 高窗口中完整显示（表单高492）。个人下拉选码与退款标签正常。
- Impeccable 源文件 regex 扫描未报问题；不替代浏览器验证。

## 本地预览

- VIP：http://127.0.0.1:4286/?scenario=existing#personal/vip （推广码 → 收支明细）
- 个人：http://127.0.0.1:4286/code-activity.html?audience=personal
- 员工：http://127.0.0.1:4286/staff-preview
- 截图：/Users/m5/code/oneapi/output/code-activity-vip.jpg
- 预览脚本：/private/tmp/code-activity-preview.mjs；端口4286。采用临时数据库测试订单和模拟身份，不代表生产数据。其他壳页面依赖既有4194模拟预览。
- PostgreSQL：本地55527，数据根路径记录于 /private/tmp/oneapi-vip-bars-db-path；vip_statements_test 用于预览，code_activity_final_test 与 vip_code_metrics_test 用于回归。不要对生产库运行这些会清空 fixture 的测试。

## 集成注意

主工作区有另一项员工工作台改版，本分支的员工外壳较旧。自动审批曾拒绝把 main 整体合并到本分支，原因是可能混入其他活跃任务改动；未执行合并。没有通过复制主工作区等方式绕过该拒绝。后续发布时应在最新合适基线上定向整合本项提交并复验员工新外壳，尤其侧栏与短屏布局。本次没有修改用户截图3326对应的另一项员工预览。

未做生产规模查询性能测试；实际支付、退款和提现行为保持原有流程，本次只验证只读按码账目。
