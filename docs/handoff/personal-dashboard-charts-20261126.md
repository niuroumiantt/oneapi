# 个人 Dashboard 图表本地设计交接（2026-11-26，m5）

## 目标与已定规则

个人 Dashboard 增加按模型分色的每日 Token 柱状图：默认过去 7 天，展开过去 30 天；右侧过去 3 个月的使用状态热力图，参照用户的 GitHub contribution 截图。用户明确要求先本地设计给他看，再更新上网。

## 当前状态

- 从最新远程 `origin/main` 基线 `6d3d06a` 建立独立分支 `codex/personal-dashboard-charts-20261126`。
- 工作树：`/Users/m5/.worktrees/oneapi/personal-dashboard-charts-20261126`。主工作区已有其他任务的未提交修改，未触碰。
- 可交互原型完成，放在 `prototypes/personal-dashboard/`，通过本地预览服务向现有网页注入组件。未修改生产 web/server 文件。
- 本地地址：http://127.0.0.1:4196/#personal 。运行 `python3 prototypes/personal-dashboard/preview.py` 可重启。
- 全部数据为明确标注的固定示例，未连接真实账号、未进行生产调用、未上线或推送远程。
- 截图在 `prototypes/personal-dashboard/screenshots/`；细节与验证见该目录上一级 README.md。

## 下一步

1. 用户查看本地原型并反馈；确认前不发布。
2. 确认后按 README 的统计口径接入完整真实日聚合，去掉预览状态控件和 fixture；补齐加载态与数据测试。
3. 验证实际账号数据和响应式展示，再依用户授权走现有发布流程。

## 待用户决定

当前布局、配色及「展开 30 天后在下方显示长图」是否满意。
