# 本地代表任务实测 · 2026-11-17

四个 Skill 均通过 skills@1.9.0 安装固定上游提交至临时项目；未全局安装、未上线。版本见各目录 skills-lock.json 与 verification.json。原始临时工作区 `/private/tmp/oneapi-skill-tests-20261117`，不依赖它即可浏览本目录记录。

- dungeon：三次 Codex 临时会话，依次传入真实前轮文本；人工检查玩家选择、物品归属与暂停。不能据此证明持久记忆。
- gif：Agent 生成 make_gif.py，调用原版 GIFBuilder。首次缺 imageio；隔离 venv 安装上游 requirements.txt 后原脚本成功。真实文件 128×128、20 帧、2 秒，独立文件检查通过；没有上传 Slack。
- pdf：合成三页中文文字 PDF，预先保留 expected.json；Agent 只读取输入 PDF，生成提取脚本。12 个字段精确匹配，缺失日期保持 null。标题缺字分隔符修正后使用同一提取脚本重跑，最终文件哈希在 verification.json。
- react：合成 React 样本，预先保留 expected.json；识别 3 个预植入问题，无 Greeting XSS 误报。静态审查，不是构建或性能基准测试；竞态问题对应的上游规则是较宽泛的 SWR 规则。

## 复现方法

先查看各目录 prompt*.txt、skills-lock.json、安装日志和结果。独立临时目录中安装对应固定版本：

```sh
DISABLE_TELEMETRY=1 npx --yes skills@1.9.0 add OWNER/REPO@COMMIT --skill NAME --agent codex --copy --yes
codex exec --ignore-user-config --ephemeral --skip-git-repo-check --sandbox workspace-write --json -C PROJECT -o result.md - < prompt.txt
```

OWNER/REPO、COMMIT、NAME 取锁文件，PROJECT 为对应临时项目。跑团安装在临时根目录，其他在各自子目录。脚本中的临时绝对路径需替换为复现机器路径。跑团和代码审查原运行用 read-only sandbox；GIF/PDF 使用 workspace-write。模型生成非确定性，不能保证再次输出逐字一致。

GIF 需用独立 Python venv 安装原 Skill requirements.txt，再运行 make_gif.py；本次 Pillow 13.0.0、imageio 2.38.2、imageio-ffmpeg 0.8.1、numpy 2.5.5。PDF 采用 Python 3.12.14、pdfplumber 0.11.9、pypdf 6.21.4，输入构造用 ReportLab，页面渲染用 pdftoppm。

截图 screenshot.jpg 是真实输出在本站报告页的浏览器截图，不是原生聊天界面；GIF 为实际动画。完整 CLI 原始运行日志留在临时目录，网页只附筛选后的调用证据，避免带入本机运行状态。

使用现有 Codex 登录，CLI 0.160.0 默认模型；确切服务端模型 ID 与金额账单未取得。未验证 OneAPI 上的任何具体模型组合。Skill 内容免费不等于运行零费用。

## 证据完整性检查

```sh
python3 prototypes/skills/tests/check-evidence.py
node prototypes/skills/check-catalog.cjs
```
