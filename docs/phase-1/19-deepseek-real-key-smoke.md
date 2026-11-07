# DeepSeek 测试 Key 的首次真实调用

目标：用用户自己的 DeepSeek 测试 Key，核对该账户可用型号并完成一次低输出量调用。此步骤只验证上游连接、响应和 usage，不代表 OneAPI 公网网关、客户计费或转售授权已经通过。

## 本机操作

在 Mac 终端运行：

```bash
bash /Users/m5/.worktrees/oneapi/phase-one-launch-design/scripts/save_deepseek_test_key.sh
node /Users/m5/.worktrees/oneapi/phase-one-launch-design/scripts/probe_deepseek.mjs
```

第一个脚本交互式读取 Key，写入 `~/.local/share/oneapi/deepseek-test-key`，目录权限为 `0700`，文件权限为 `0600`。不要把 Key 放进聊天、Git、URL、浏览器表单或命令参数。第二个脚本只请求 DeepSeek 官方 `GET /models` 和一次 `POST /chat/completions`，使用 `deepseek-flash`、16 个输出 token 上限；只打印模型 ID、完成状态和上游 usage，不打印 Key 或响应正文。

## 验收记录

| 项目 | 状态 |
| --- | --- |
| Key 所属 | 用户自己购买的 DeepSeek 测试 Key；具体账户权限待接口验证 |
| 可用型号 | 2026-11-07 测试账户 `GET /models` 返回 `deepseek-flash`、`deepseek-v4-pro` |
| 首次真实调用 | `deepseek-flash` 已返回正文，`finish_reason=stop`；上游 usage 为输入 7、输出 1、合计 8 token |
| 供应资格 / 客户转售授权 | 待供应合同或官方条款核对 |
| OneAPI 客户 RMB 价格 | 待成本、毛利、税费和规则定价 |
| 客户充值、平台 Key、用量账本 | 未开放，不能以本次探测结果冒充端到端闭环 |

官网当前目录所列价格属于公开文档快照。页面可展示本次核对过的准确型号和验证状态，但客户售价与购买入口继续关闭，直到供应资格、费用和交付条件核实；验收记录不写入密钥。

本次探测先因脚本把 POST 误发为 GET 收到 HTTP 405，修正后一次真实 POST 收到 HTTP 500，受限重试成功。脚本现用 Node HTTPS 明确发送 POST，并仅输出非敏感结果。`deepseek-v4-pro` 只完成列表核验，尚未实际调用。测试 Key 保留在本机文件，未上传到阿里云或 Git。
