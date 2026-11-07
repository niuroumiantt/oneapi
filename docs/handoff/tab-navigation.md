# 工作台标签切换交接（更新于 2026-11-07，机器 m5）

## 目标

消除企业管理台和内部运营台切换标签时整页闪白、停顿的问题。

## 已定规则

- `oneapi.glocalstorage.cn` 是独立站点；旧 `api.glocalstorage.cn` 继续运行。
- 企业代表人与企业员工共用企业空间，但企业管理权限只授予代表人。平台员工入口保持内部性质。
- 真实交易、支付、推理与用量尚未开放，不用演示数据伪装为业务记录。

## 进度

- 已完成：`web/identity.js` 的 `mount()` 在同一工作台内保留页头、侧栏与外框，只替换内容。企业侧标签直接使用已取得的企业数据绘制，再异步校对服务端数据。
- 已完成：内部运营台切换标签不再清空页面；复用已验证的员工上下文，已访问标签可立即显示缓存快照，然后在后台刷新。退出登录时清除缓存。
- 已完成：`web/identity.css` 为内部运营台异步刷新增加轻量进度条。
- 发布提交：`6745ca024c9ee4a9654abf5ab8a7e5908dcc3ddd`。静态包 SHA256 `80258fc419e52ff2caac738b6d507d95568e921975a6137ef3bc7012ce6a26e1`。公开 `/release.json` 与 `/api/status` 均指向该提交；新脚本 200，旧平台首页 200。
- 验证：`node --check web/identity.js`、`git diff --check` 通过；浏览器访问内部工作台时需要员工登录，未在已认证会话中人工体验标签切换。

## 下一步

1. 用有效员工会话实际切换 `#ops/supply`、`#ops/products`、`#ops/payments`、`#ops/promotions`，确认无闪白且内容更新。
2. 用企业代表人会话切换同一企业的总览、采购、员工、预算、安全标签，确认布局稳定和新数据可见。
3. 继续接入真实供应测试、商品发布、订单资金和促销兑换；开放前保持相应能力关闭。

## 入口文件与工具

- 前端：`web/identity.js`、`web/identity.css`、`web/app.js`。
- 构建：`scripts/build_static.py`；发布：infra 的 `oneapi-aliyun/scripts/push_static_candidate.sh`。
- 生产配置：`aliyun:/srv/oneapi-config/identity.env`；备份：`identity.env.before-6745ca0`。
