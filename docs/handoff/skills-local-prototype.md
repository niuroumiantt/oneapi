# Skills 广场本地目录交接

2026-11-17。用户认可初版方向，要求补齐真实免费 Skills、增加个人娱乐、丰富介绍和图标图片。仅本地，不上线。

## 文件与启动

目录：`prototypes/skills/`。仓库根目录运行：

```sh
python3 -m http.server 4175 --bind 127.0.0.1
```

广场：`http://127.0.0.1:4175/prototypes/skills/`。
娱乐详情：`http://127.0.0.1:4175/prototypes/skills/#skill/dungeon`。
旧的 `#skill/story` 自动展示真实的 AI 跑团主持。初版原创占位条目已退出目录。

沿用 semifly.ai 标志、浅底、海军蓝文字、红色操作。生产 web 入口和打包白名单未改，无发布、推送或 API 调用。

## 数据与信源

15 个真实 Skills、7 个分类、4 个原作者仓库。个人娱乐 5 个：agent-dungeon-master、dungeon-master-assistant、algorithmic-art、slack-gif-creator、canvas-design（最后三个是个人创作玩法）。

- `catalog.js`：中文介绍、适用对象、输入输出、功能、依赖、边界、任务示例。
- `source-refs.js`：原始目录及核对时的不可变 commit。
- `source-audit.json`：来源原文片段、许可依据、核对日期与测试边界。
- `skills.js` / `skills.css`：目录、筛选和详情交互。
- `assets/scenes.jpg`：imagegen 内置工具生成的 6 格用途插画。保留原 PNG，生成提示在 assets/README.md。
- `check-catalog.cjs`：检查条目唯一性、实际 Skill 名称、commit、许可证据及必要编辑字段。

原始仓库：

- https://github.com/anthropics/skills — 10 条；逐项读取 LICENSE.txt，当前核对版本为 Apache-2.0，包括四种文档 Skills。不要沿用历史上“文档 Skills 必定专有”的判断。
- https://github.com/vercel-labs/agent-skills — 2 条；MIT 依据为固定版本 README，React Skill 前置元数据也声明 MIT。CLI 实际 Skill 名称是 vercel-react-best-practices，不是目录名 react-best-practices。
- https://github.com/NylasDev/nylas-dungeon-master-skills — 2 条；根目录 LICENSE 与两个 Skill 元数据均为 MIT。
- https://github.com/K-Dense-AI/scientific-agent-skills — 1 条；LICENSE.md 与 Skill 元数据均为 MIT。旧 claude-scientific-skills 仓库已经迁移，不再使用旧路径。

安装说明依据 Vercel Skills CLI 官方 README / docs/commands.md；已确认 v1.9.0 release 存在。命令固定 CLI 为 skills@1.9.0，来源固定核对 commit，默认仅当前项目；可切换 Claude Code / Codex / Cursor / OpenCode。要求 Node.js >=22.20 与 Git；未执行安装命令。

## 首轮来源核验结论与限制（实测状态见下方更新）

每项均读取原始 SKILL.md 和许可依据，核对了安装参数与文档。安装、代表任务运行、OneAPI 模型兼容均未验证，页面分别标识。没有“安全认证”、虚构星级或下载量。

K-Dense 条目核心证据分析不需网络；可选科学绘图依赖 OpenRouter 和额外费用，已说明默认不启用。办公类 Skill 的上游预装依赖不可假定在用户本机存在。

配图只表达用途；任务示例、交付结构由本站编辑，均非实测输出。

## 页面验证

- JS 语法与 check-catalog.cjs 通过：15 个条目、5 个娱乐条目、源名称与 commit 对齐。
- Chrome 逐一打开 15 个详情页，每页有 3 个原始来源/目录/许可链接及安装命令；未捕获 console error/warn。
- 娱乐筛选得到 5 个；叠加 Anthropic 来源得到 3 个；返回保留筛选。
- 切换 Codex 后命令参数正确，复制安装命令反馈正常。
- 搜索无结果与清除恢复正常。
- 390px 手机广场、分类展开与 GIF 详情视觉检查，页面宽度无横向溢出。
- 实际安装、Skill 生成效果、浏览器跨平台完整回归不在本轮通过项。

后续实测已完成下列范围，仍未获得上线授权。


## 2026-11-17 代表 Skill 实装与实测更新

用户要求优先跑团与 GIF，再测 PDF 和代码审查；仅本地。四项已经通过 skills@1.9.0 安装固定提交到临时项目，并由 Codex CLI 0.160.0 实际读取已安装 Skill 执行样本任务。

| Skill | 实际结果 | 边界 |
| --- | --- | --- |
| agent-dungeon-master | 三轮上下文回放人工检查通过 | 不是长战役或跨会话持久记忆测试 |
| slack-gif-creator | 首次缺 imageio；补齐原依赖后生成 128×128、20 帧、2 秒循环橘猫 GIF | 原 Skill 未修改，未上传 Slack |
| pdf | 三页中文文字样本的 12 个字段与预留标准答案一致 | 缺日期保持 null；不含 OCR/复杂表格 |
| vercel-react-best-practices | 命中 3 个预植入问题，正常 JSX 无 XSS 误报 | 静态审查，无构建或性能测量 |

新增 `prototypes/skills/test-results.js` 与 `tests/`：真实原始输出、输入、生成脚本、安装日志、锁文件、SHA256 验证记录、4 张浏览器报告截图。GIF 同时展示实际动画。报告明确是本站排版的真实产物，不冒充原生客户端界面。失败与修复过程保留。详情页和卡片状态更新，其他 11 项仍未运行。

当前 15 个固定版本均可按开源许可免费获取使用：10 Apache-2.0、5 MIT。许可计数限定当前快照；运行涉及模型/订阅/第三方服务，不能承诺零费用。页面增加费用 FAQ。重新分发须保留许可、版权与适用 NOTICE 等要求。

环境：macOS M5，Python 3.12.14，Node 22.23.3，现有 Codex 登录。未记录确切服务端模型 ID，未取得金额账单；未验证 OneAPI 具体模型组合。临时项目 `/private/tmp/oneapi-skill-tests-20261117`；复现细节见 tests/README.md。

验收：4 项报告人工视觉检查；详情页截图正常加载；GIF 详情 390px 无溢出；广场费用说明与状态正确；浏览器未捕获 error/warn。`check-evidence.py` 核对 27 个产物哈希、4 张截图、PDF 标准答案；目录检查与 JS 语法通过。仍仅本地，未推送或部署。
