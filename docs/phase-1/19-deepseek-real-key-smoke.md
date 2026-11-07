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
| 可用型号 | 待 `GET /models` 实测 |
| 首次真实调用 | 待 Key 本机保存后执行 |
| 供应资格 / 客户转售授权 | 待供应合同或官方条款核对 |
| OneAPI 客户 RMB 价格 | 待成本、毛利、税费和规则定价 |
| 客户充值、平台 Key、用量账本 | 未开放，不能以本次探测结果冒充端到端闭环 |

官网当前目录所列型号与价格属于公开文档快照；页面只展示选型方向，直到该账户的可用性、费用和合规条件核实。运行后将探测结果写入独立验收记录，不写入密钥。
