# Skills 目录与每日榜单更新

用户已授权公网发布。生产部署与每日调度见 `scripts/skills-deploy/README.md`。更新器只刷新公开数据，不推送源码、不安装 Skill、不修改精选名单。

## 双榜含义

- **semifly 精选**：编辑选择的 10 个代表条目，优先办公、设计与排版。名单在 skills.js 的 featuredIds；综合用途、原作者质量和公开安装量，不冒充客观下载排名。
- **GitHub Top 10**：https://github.com/trending?since=daily，全语言日榜的原始前 10 个仓库。保留官方顺序，不按自己计算的 stars 排序，不筛选成“Skill 榜”。显示今日新增 stars 与总 stars；均非下载量。
- 完整目录 40 项；其中 13 项文档与办公、11 项设计与排版，另有 3 项数据分析。新增 25 项只核对来源和许可，未运行；原四项样本证据继续保留。

## 运行

```sh
cd /Users/m5/code/oneapi
python3 prototypes/skills/scripts/update-market.py
python3 prototypes/skills/scripts/test_market.py
node prototypes/skills/check-catalog.cjs
```

仅 Python 标准库，不需 token、GitHub 登录或 Vercel 项目。工具抓取公开 HTML，不调用需 OIDC 的 skills.sh API。网络需能访问 github.com 和 skills.sh。首次与本次更新已实际执行成功。

输入：market-sources.json（必须与 catalog.js + catalog-extra.js 一致）。
输出：market-data.json（先写同目录临时文件，再原子替换）。

安装量来自 skills.sh 公开页面的 **Installs**，是 Skills CLI 记录的安装统计，并非 GitHub 文件下载次数、独立用户或本站安装量。统计覆盖该 Skill 的多个版本，不是本目录固定 commit 的安装量。K/M 为来源四舍五入展示值；countApprox 仅用于近似排序。rank 仅在公开全时榜直接显示时记录，未出现时为 null，不用条目顺序推算。

参考：https://skills.sh/docs 与 https://skills.sh/docs/api 。未来正式服务可申请官方 API 权限，当前本地版不创建账号或读取凭据。

## 失败和新鲜度

- GitHub 必须解析到前 10 条不同仓库及今日 stars；布局变化、挑战页或不足 10 条均视为失败。
- 每个数据源独立保留最后成功的内容和原采集日期，失败只改 status/lastAttemptAt/error。
- 某 Skill 无数据时展示“—”，不将缺失值写成 0。HTTP 404 无旧值记 unavailable，有旧值记 stale。
- 页面标识失败或超过 36 小时的 GitHub 快照；Skill 卡片也标记旧安装量。
- 仅展示外部原文，所有动态文本做 HTML 转义，外链限制 HTTPS 的 GitHub / skills.sh 域名。
- 不自动把热榜仓库收入免费 Skill 目录；来源、许可与安装文档需另行人工审核。

## 每日调度

2026-11-17：生产服务器的 `oneapi-skills-update.timer` 已接管更新，每天09:00 Asia/Shanghai运行，首次抓取成功。数据独立存放于 `/srv/sites/oneapi-skills-data/market-data.json`，通过 `/skills/market-live.json` 公开。以下本机调度已暂停，作为历史记录保留；公网更新不依赖开发电脑或 Codex。

已通过 Codex 桌面自动任务工具创建并查看：`semifly-skills`，名称“更新 semifly 本地 Skills 榜单”，状态 ACTIVE，每天本地时间 09:00（当前本机时区 Asia/Shanghai）。附着当前对话，仅更新本地 market-data.json 并运行校验；不 commit、不 push、不部署。

本机和 Codex 必须运行且网络可达。没有常驻线上调度服务；机器离线不保证准点更新，页面保留采集时间。未来用户明确授权上线时，才接入生产调度及监控。本仓库中没有启用会发布站点的 CI 工作流。

## 回归测试

test_market.py 使用合成 HTML 测试官方顺序、单位转换、挑战页/不足 10 条、失败保留旧日期、缺失值不当作零、原子落盘。不会联网或刷新真实数据。check-catalog.cjs 核对 40 个目录条目、固定 commit、实际 Skill 名称、许可证据与统计请求清单。

新增 lark 系列命令带配套 lark-shared / workflow 依赖；仍需独立配置 lark-cli 和资源权限。宝玉的图像类 Skill 可能调用收费生成服务。brand-guidelines 仅为 Anthropic 自有品牌参考，不描述为通用品牌生成器。
