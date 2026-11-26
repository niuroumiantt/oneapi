# 我的模型选择与 Key 接入（2026-11-26，m5）

## 用户要求

备选模型每行「一键接入」后跟「+ 加入」，加入即移到已选区。已选区增加「一键生成 Key」并保留清除；支持全选、挑选部分、单个专用模型三条创建路径。延续当前个人界面的上线授权。

## 改动

- 已开放模型在已选/备选区均可直接进入专属 Key 配置；待开放型号保留加入清单，不能创建不可调用的 Key。
- 使用已有 plus 图标替换心形加入；保留添加/移除后焦点行为。
- 已选区新增「一键生成 Key」：将账户清单与当前已开放付费模型取交集，传入现有共享 Key 页面；无可调用选择时禁用。
- 顶部改为「全选生成 Key」，沿用现有全模型初始化；页面明确单模型、部分多模型、全部模型的关系。创建时仍显示用途、模型范围及消费上限。
- 后端、密钥权限修改和额度规则无变更。清除清单不撤销已有 Key。

## 验证

- 19项模型旅程/导航回归通过；新增从清单选择到实际创建请求的模型范围测试，覆盖待开放过滤、空选择、账户隔离。
- 仅本地模拟创建端点完成三次真实界面提交：两个模型 [deepseek-flash,glm-5.3]、全部3个已开放模型、单个 [glm-5.3-flash]。未创建生产Key或进行付费模型调用。
- 1163×582 已选/备选列表一屏，主区域clientHeight=scrollHeight=457；动作列无溢出。390×844手机纵向排布、无横向溢出。加入/清除、返回及生成结果通过。
- Impeccable detector无发现。截图：`/private/tmp/oneapi-dashboard-preview/models-selection-{desktop,mobile}.jpg`。

## 发布基线

静态 `2d83a3b52677f0e345a4358f49f96149b128de68`，API `95a365b20755889b65e774702817e56f84c853b4`。本轮只需更新静态前端。

## 发布完成

- 独立界面复核 disposition=ship，无本轮需修复项。PR #149 已合并：https://github.com/niuroumiantt/oneapi/pull/149 。
- 静态版本 `f94b66fb41c48bdafb4d34e1760e990efa77d434`，API仍 `95a365b20755889b65e774702817e56f84c853b4`。增量169479字节、5个文件；基线/逐文件校验和/服务健康均通过。
- 回滚前端 `/srv/oneapi-data/oneapi-cutover-q72dymap/releases/f94b66fb41c4-static.fb04Ev/previous-web`。
- 正式已有登录账号页面验证：4个已开放模型均显示一键接入与+加入，2个待开放只允许加入，6个加入图标均为plus；全选生成与已选区生成入口存在。静态JS为 `identity.7724c3397914.js`。未修改生产模型清单、未创建生产Key。
- 日志 `/private/tmp/oneapi-dashboard-preview/models-publish.log`。本发布回执为文档后续提交，不再次部署。

## 去重与排版优化（用户同日追加）

- 用户指出全选状态的两个生成按钮结果相同。移除顶部「全选生成 Key」，只在已选区保留一个深色主按钮「为已选模型生成 Key」。全选、清除作为同栏次级动作；模型广场和管理 Key 置于标题栏。
- 已选标题显示可用于 Key 与待开放数量。全选后直接收起空备选区，避免「备选模型0」占据整块空间。桌面表格适当增大行距，短窗口单独压缩；手机生成动作独立成行。
- 19项模型旅程/导航回归通过；部分选择仍只传入选中的开放模型。新独立复核依据用户反馈截图及本地桌面/手机截图，disposition=ship。
- 静态发布基线 `f94b66fb41c48bdafb4d34e1760e990efa77d434`，API仍为原版本。无生产 Key 创建。

### 去重排版版发布回执

- PR #150 已合并：https://github.com/niuroumiantt/oneapi/pull/150 。静态 `2a02ce618511259b722378c4c3b96f5c6699186a`，API保持不变；5个静态文件170161字节，通过基线与全部资源SHA256检查。
- 前端回滚目录 `/srv/oneapi-data/oneapi-cutover-q72dymap/releases/2a02ce618511-static.eXpkEF/previous-web`。
- 正式用户全选6个模型：只显示一个「为已选模型生成 Key」主按钮，提示4个可用于Key、2个待开放，空备选区已收起；主区域clientHeight=scrollHeight=598。短窗口本地最终验证部分选择亦457=457。未修改生产清单或Key。
- 发布日志 `/private/tmp/oneapi-dashboard-preview/models-polish-publish.log`。本回执仅文档，不再次部署。

## 提交、上线与本地清理收尾核验

用户明确要求提交、合入main、公网上线并删除本地无用分支。PR #146–150及全部回执已在远程main；公网静态仍为2a02ce6，API为95a365b，首页HTTP200，两份identity资源SHA256与文件名一致。本轮无需重复部署文档。

清理前核验：本任务工作树无未提交/未跟踪文件，唯一忽略项node_modules为指向主目录依赖的符号链接；已停止本任务5个预览进程并移除该链接（依赖本体保留），没有LaunchAgents、配置或Codex项目路径依赖。任务分支与两个未被工作树占用的旧分支codex/customer-api-compare、codex/readable-ui-system均完整包含在origin/main，相应PR已合并，可使用不带force的git worktree remove和git branch -d清理。

主目录/Users/m5/code/oneapi的main有7个独立提交、落后远程18个提交，并有其他任务的未跟踪文件，保留原样。其余被工作树占用或未完全合并的分支不在此次删除范围。
