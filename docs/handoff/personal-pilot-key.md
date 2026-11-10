# 个人模型目录与受限真实调用

2026-11-10。个人空间的模型目录与右侧接入配置可拖动分栏，宽度仅保存在当前浏览器。DeepSeek Flash 测试通道仅允许 `sales@glocalstorage.com`、`niuroumian@163.com` 两个已验证账号创建测试 Key。每人最多 3 枚有效 Key、每天最多 10 次请求、同时 1 次请求；固定模型 `deepseek-flash`、纯文本非流式、最多 4000 输入字符和 256 输出 Token。Key 只展示一次，数据库只保存 SHA-256 摘要。停用即时生效。

测试调用使用平台服务器保存的 DeepSeek 上游 Key，经 `/v1/chat/completions` 转发。请求正文与回答不入库；逐次保存状态、实际输入/输出/缓存 Token、耗时、上游请求 ID 和保守估算上游成本。测试不扣客户现金账本，也不代表正式商用开通。其他 `/v1` 路径继续关闭。

部署顺序：备份 OneAPI 数据库；将上游 Key 保存为只允许容器用户读取的服务器文件，并只读挂载到 API 容器；配置 `PILOT_DEEPSEEK_KEY_FILE` 和 `PILOT_USER_EMAILS`；运行 `020_pilot_inference.sql` 迁移；发布 API 与前端；只将 `/v1/chat/completions` 转发到 OneAPI API 容器；验证非授权账号不可创建 Key、匿名请求 401、其他 `/v1` 路径 503。不得把上游 Key 放入代码、浏览器、镜像或日志。

此版的价格栏为目录参考信息，不能作为测试调用的客户结算凭据。微信、支付宝收款和正式客户计费仍待商户与供应准入完成。
