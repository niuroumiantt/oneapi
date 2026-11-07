# DeepSeek 测试 Key 首次真实调用交接

日期：2026-11-07。工作分支：`codex/phase-one-launch-design`。旧平台 `api.glocalstorage.cn` 未改动。

## 已完成

- 客户目录 `#catalog` 已把选型与预付余额计费关系讲清楚；示意费率单独试算，不作为正式报价。
- 用户自己的 DeepSeek 测试 Key 由用户在本机交互式保存为 `~/.local/share/oneapi/deepseek-test-key`，权限 `0600`。Key 未进入 Git、聊天、网页、阿里云或数据库。
- `scripts/probe_deepseek.mjs` 对 DeepSeek 官方 `GET /models` 返回 `deepseek-flash`、`deepseek-v4-pro`；`deepseek-flash` 的真实 Chat 调用成功，`finish_reason=stop`，上游 usage 为输入 7、输出 1、合计 8 token。此前一次真实 POST 返回 500，受限重试成功。
- 前台已把 DeepSeek 两个精确型号和各自的验证状态分开：Flash 已调用，V4 Pro 仅账户可见；客户售价和接入关闭。

## 当前边界

这只是**本机直连上游的技术验收**，不是客户通过 semifly.ai 平台 Key 调用。`/api/status` 中 `payments_enabled=false`、`inference_enabled=false` 仍正确。没有商户收款、真实钱包、平台 Key、用量双账；也尚未核实测试 Key 的商业转售条件。不能把本机 Key 直接复制到生产容器或暴露给客户。

完整测试中依赖本机 PostgreSQL 的身份集成用例因 `127.0.0.1:55438` 无服务而无法运行；语法检查与无需数据库的 14 项用例通过。此前模型目录更改已用本地浏览器检查过布局、弹窗与计费试算。

## 下一步顺序

1. 核对这枚 DeepSeek Key 的账户和商业使用范围，并取得测试账户的采购价格或账单；对 `deepseek-v4-pro` 做单独限额调用。
2. 在独立 OneAPI 后端实现受限供应凭据、平台自己的客户 Key、模型白名单与权限，先内部使用，再公开。生产密钥从受限配置或密钥管理服务读取，禁止客户端与普通日志接触。
3. 建真实人民币钱包、订单和支付回调；先充值再调用，企业与个人共用计量内核但钱包隔离。没有商户回调前只能保持模拟区，不能把测试余额混为真实资金。
4. 在调用链中预留余额、核对上游 usage、结算客户与采购两套账，并在客户页面显示余额和每次用量。失败与超时要有幂等处理和费用回补。

供应商技术验收细节见 `docs/phase-1/19-deepseek-real-key-smoke.md`。
