# 个人用户模型额度展示（2026-11-27，本地待验收）

用户批准个人首页、模型、充值与账单、Key 提示配套新模型促销规则，明确先本地、不上线。四套全站主题继续共用。

## 工作区
- `/Users/m5/.worktrees/oneapi/personal-model-balances-20261127`
- 分支 `codex/personal-model-balances-20261127`，基线 `5942667`。
- 主工作区与生产未修改，未推送、合并或发布。

## 实现
- 个人首页和充值页标注额度合计，区分通用和专属，可展开模型明细、赠送到期和批次入口。
- 模型表分别显示开放状态和该模型额度（专属加通用），待开放型号保留目录。手机逐行呈现。
- Key 提示明确权限与余额范围独立；不修改创建、限额或计费规则。
- 付款确认显示模型、折扣、实付、赠送、额度和有效期。充值记录显示模型范围。消费账单带输入输出 Token、实付与赠送扣减，未知 Token 不估算。
- 新 `credit_scopes` 汇总全部批次，保留十位小数的分精度，不受历史明细100条限制；不含冻结退款包和过期赠送。该模型展示为余额，调用仍以预占与 Key 上限校验为准。
- 所有新样式用现有主题变量。没有迁移、提成算法或生产配置修改。

## 本地运行
```
LOCAL_PREVIEW_DATABASE_URL=postgresql://pack_preview@127.0.0.1:55492/personal_scopes_test node scripts/dev/personal-scopes-preview.mjs
```
地址 http://127.0.0.1:4299/#personal 。测试客户 `customer@example.test`，密码 `Preview-Pack!4297-Local`。复用既有本机 PostgreSQL，独立 `personal_scopes_test` 数据库。模型状态为本地 UI fixture，无供应商凭据，支付与调用模拟，不产生真实交易。

测试余额：通用20元，DeepSeek Flash专属60元、GLM-5.3专属60元，合计140元；Flash和GLM各显示80元可适用余额。Flash已消费40元额度，其中实付20元、赠送20元。测试码 `PRVWDSAA` 与 `PRVWGLMA` 只在此本地数据库有效。

## 验证
- 29项定向测试全部通过，包含真实SQL：账户隔离、超过100批次、过期赠送、冻结退款、小数精度、跨包消费及赠送单独消费。
- Chrome实看四套主题、390×844手机模型列表、桌面模型列宽、付款确认、消费账单。
- 静态设计检测无新增发现，JavaScript语法与git diff whitespace检查通过。
- 当前上游调用与真实支付不属于本地预览验收范围；预览中的模型状态不代表公网供应可用性。
