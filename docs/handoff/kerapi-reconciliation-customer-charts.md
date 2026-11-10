# KerAPI 逐笔核账、供应商总览与客户图表

2026-11-10，承接 server-observation-key-rotation.md。工作树 phase-one-launch-design，分支 codex/phase-one-launch-design。

## 本阶段实现

- /api/staff/console#technical/supplier 默认技术入口，全部已登记型号、最新实测时间与过期提示、按 Key/模型汇总上游用量与实扣。更换 Key、单次验收共用现有凭据。初始页面一屏；逐笔记录按需展开。
- technical/billing 按 credential + upstream request ID 对账输入/缓存/输出/金额，技术权限保护。technical/upstream 展示已同步 Key 的原始日志与 other 全部字段、计费表达式、摘要；JSON/Excel CSV 导出，秘密脱敏、CSV 公式转义。
- 固定 https://kerapi.cn/api/log/token 只读同步，每5分钟一次及手动同步，不生成模型请求。记录当前证据和不可覆盖历史版本。接口返回范围不等于完整账户账单。
- 严格白名单识别本次 KerAPI 分时表达式，用整数精度复算 quota 取整与 CNY 金额；未知公式/字段/边界保持待核。规则复算通过不等于合同价确认，也不等于质量或模型真实性验收通过。
- 阿里云服务器页按运行总览、风险待办、服务版本分层；资源账单独立页签。支持加密录入 RAM 只读连接及固定 DescribeInstances/ListInstances/QueryAccountBill 操作；不提供任意远程命令。
- 客户 /#personal/usage 显示个人最近24小时按模型 Token 柱图、调用趋势、RPM/TPM、最近50笔。数据按 owner_id 限定；现阶段试用不扣客户余额，不把上游采购金额当客户账单。

## 真实证据与边界

KerAPI 首批 4 笔：202 输入 +145 输出，其中缓存0，总347。实际扣款依次0.000126、0.000196、0.000238、0.000224元，总0.000784元。质量3/4（中文输出截断），与计量匹配是不同结论。请求号见生产记录。
上游观察到工作日上海时区9–12、14–18时段2倍规则；12:27四笔不触发。不能把上游动态规则自动覆盖客户售价。采购合同价仍待书面确认，新增KerAPI商品不能据此自动上架。旧聚合人工核账接口因交付工作流依赖保留，技术页改为逐笔证据。
阿里云当前缺 RAM 凭据，云费用/购买带宽未实连；主机采集始终来自 Aliyun，不是 AWS。云接口仅夹具测试，待只读授权后生产核验；费用范围标为整个云账户。AWS 临时代码已删除，不部署。
当前图表为真实个人试点；企业真实计费、正式支付、e签宝认证尚未开放。本阶段不声称完成这些依赖外部账户/协议的接入。没有增加付费测试、修改模型路由或客户销售费率。

## 验证

37项测试通过（含身份隔离、同步权限、秘密脱敏、分时和取整、云授权边界）。独立浏览器1440×900核验服务器、供应商、逐笔核账、全部字段页面均无外层溢出；客户图表一屏且无脚本异常。上线前数据库备份、追加migration024，保留旧镜像回滚；静态/API发布相同代码SHA。

## 后续必须完成的外部依赖

1. 平台管理员在服务器页配置阿里云RAM只读资源和账单权限；然后同步验证，未知费用不可当0。
2. 与KerAPI确认合同基价、缓存、分时、取整、生效时间；业务复核客户价后再上架，不能无通知传导上游涨价。
3. 支付/e签宝生产账号、企业正式调用与计费需后续接通；本轮未自动启用。

## 生产发布回执

已部署代码 `7ca8c21945a47567e26777c6058e9ea58643b147`（镜像 oneapi-identity:7ca8c21），公网 /api/status 与 /release.json 一致；客户页面已引用新 identity.da94ff3149d9.js。API healthy，oneapi-monitor.timer active。发布前备份 `/srv/oneapi-backups/oneapi-20261110T070451Z.dump`。
2026-11-10 15:06 CST 生产只读同步成功，27条、5型号；本台原4笔全部 matched、差额0，仍只有4笔测试，没有新增付费调用。云连接配置数0，资源账单尚待凭据。
已同步窗口按型号金额（不是整个账户账单）：DeepSeek Flash 9笔/0.001862；GLM-5.3-FlashX 4笔/0.003360；GLM-5.3-Flash 5笔/0.001204；GLM-5.3 5笔/0.017066；DeepSeek Flash-0910 4笔/0.001120。原始日志19字段、该最新记录other17字段，其他记录可有额外字段，均可展开。
未登录云观察、上游核账、个人试点统计接口均401。payments_enabled=false、inference_enabled=false、pilot_inference_enabled=true，原有两账号试点边界保持。

快捷入口：
- https://oneapi.glocalstorage.cn/api/staff/console?supplier=272261eb-b55a-431b-acb8-37f0976d7bb5#technical/supplier
- https://oneapi.glocalstorage.cn/api/staff/console?supplier=272261eb-b55a-431b-acb8-37f0976d7bb5#technical/billing
- https://oneapi.glocalstorage.cn/api/staff/console?supplier=272261eb-b55a-431b-acb8-37f0976d7bb5#technical/upstream
- https://oneapi.glocalstorage.cn/api/staff/console#technical/servers
- https://oneapi.glocalstorage.cn/#personal/usage

业务侧仍以技术人员明确交付报告为准；当前4题质量未全部通过、合同价未确认，不自动转为可上架商品。若需要业务直接预览实时核账摘要，需在后续工作中提供不包含上游原始敏感信息的只读视图。
