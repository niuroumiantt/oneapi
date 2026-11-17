# Markdown 转 HTML 实际运行报告

## 执行过程

- 已读取 `.agents/skills/baoyu-markdown-to-html/SKILL.md`（版本 1.117.3），使用其原始 `scripts/main.ts`。
- 使用原始虚构材料 `input.md`；未修改输入或 `.agents/skills`，未预先格式化 Markdown。
- 按明确选择使用 simple 主题、red（`#A93226`）、16px 正文，保留首个标题，启用文末引用，禁用 Mermaid 渲染。
- 实际执行 `sh run-conversion.sh`，其中调用：

```sh
npm_config_cache=/private/tmp/oneapi-skill-tests-20261117/npm-cache npx --offline bun .agents/skills/baoyu-markdown-to-html/scripts/main.ts input.md --theme simple --color red --font-size 16px --keep-title --cite --no-mermaid
```

## 成功结果

转换进程退出码为 0，生成 `input.html`。原脚本标准输出保存为 `conversion.json`，诊断输出保存为 `conversion.stderr.log`，无备份路径返回。元数据中的标题、作者、摘要与输入一致，图片和 Mermaid 图片数组均为空。

使用指定 Python 执行 `verify-output.py`，退出码为 0，9 项检查全部通过；结果保存为 `verification.json`：

- 首个 H1 标题、中文正文及尚未收集满意度问卷的限定表述仍在。
- 18,000 元、16,420 元、1,580 元金额仍在。
- HTML table 元素及四项预算名称和金额仍在。
- pre/code 代码块及三行 Python 代码、1580 注释仍在（高亮使用 span，空格编码为 HTML 不换行空格）。
- 正文有 `[1]` 上标，文末“引用链接”含原始 URL `https://daringfireball.net/projects/markdown/`。原脚本也保留了正文锚点的 href。
- HTML 包含 red 对应色值和 16px 正文字号。

## 失败与限制

本次实际转换和静态内容检查未发生错误，未遇到依赖缺失。验证限于生成的 HTML 源码与解析文本，未验证视觉渲染、Microsoft Office 或微信编辑器兼容表现。未使用浏览器自动化，未复制到微信、上传、发布或创建线上文档，未执行 Mermaid 渲染。

保留运行脚本 `run-conversion.sh` 和验证脚本 `verify-output.py`。未读取 `expected.json`、父目录或其他测试目录内容。
