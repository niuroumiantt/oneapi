# DeepSeek 与智谱 GLM 官方目录快照

核验日期：2026-11-06。范围：供应商官方公开文档。以下是文档核验结果，不是已经取得转售授权、账户权限或真实接口测试通过的声明。任何型号是否在 OneAPI 可售，还取决于具体地区、采购方案、授权、价格与实际验收。

## 目录使用规则

1. 前台只保留两个入口：DeepSeek、智谱 GLM。这里是用户选择的品牌/家族入口，不能把供应商目录里出现的第三方模型也算成 GLM。Vidu 不纳入这次范围。
2. 2026-11-06 官方目录的主力已更新：DeepSeek 是 deepseek-flash 与 deepseek-v4-pro；智谱最新为 glm-5.3、glm-5.3-flash、glm-5.3-flashx。不要仍以 deepseek-chat、deepseek-reasoner、GLM-4.x 作为默认最新型号。
3. 全面建档与全部上架分开。前台建议先推荐五个型号，其他官方当前目录中的型号放入“全部模型/专业能力”，通过采购和接口验收后启用。
4. 当前两家都有 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 相关接口。三种协议不是一个“OpenAI compatible=true”标志；多轮工具、流式事件、图像、文件、存储和取消语义分别核对。
5. GLM-5.3 及 5.3 Flash 系列不能关闭思考；错误发送 thinking.type=disabled 会失败。DeepSeek 可用思考及非思考模式。模板需要按具体模型生成。
6. 智谱标准 API 与 Coding Plan 是不同产品。2026-10-16 后新建标准、个人套餐、团队套餐 Key 分开管理，切换 URL 不改变新 Key 的计费用途。个人 Coding Plan 明确禁止共享、倒卖和中转。平台应采购获授权标准 API/企业服务，并给客户签发平台自己的 Key。
7. 官方当前 BigModel 定价页明确保留历史型号价格，所以“有价格行”不能证明型号当前可调用。目录元数据要记录证据来源、核验日期和实际账户测试状态。

## A. DeepSeek 当前主目录

| 上游 API model_id | 当前文档指向 | 输入/输出 | 文档限制 | 适合怎样展示 |
| --- | --- | --- | --- | --- |
| deepseek-flash | DeepSeek-V4.1-Flash-1017 | 文本、图片 → 文本 | 1M 上下文；最大输出 384K；思考强度 low/high/max，默认 high | 通用、编程、视觉输入的默认候选 |
| deepseek-v4-pro | DeepSeek-V4-Pro-0813 | 文本 → 文本 | 1M 上下文；最大输出 384K；思考强度 low/high/max，默认 high | 另一文本模型候选，按实际任务与成本测试后推荐 |

上述能力来自官方首调、模型列表和价格表；最大值不是平台首期默认配额。列表样例给出具体数值 1,048,576 与 393,216，但这是文档样例，不是对客户账户执行 GET /models 的结果。[D1](06-sources.md#models)[D2](06-sources.md#models)[D3](06-sources.md#models)

别名及历史状态：

- deepseek-v4-flash 与 deepseek-v4-flash-vision-exp 仍作为兼容名称接受，但原模型已退役，当前请求转到 V4.1 Flash；不应当作三个不同模型商品销售。[D1](06-sources.md#models)[D3](06-sources.md#models)
- 官方更新日志曾宣布 deepseek-chat 与 deepseek-reasoner 于 2026-07-24 停用。它们曾先后指向不同代际和思考模式，不能把它们稳定等同于 V3 与 R1。[D3](06-sources.md#models)
- 2026-09-10 的早期发布文章曾宣布 V4-Pro 将被路由到 Flash，但当前更新日志又明确继续提供 V4-Pro 服务，现行首调与模型列表仍列 V4-Pro。因此当前目录使用现行首调/列表及修订后的日志，保留历史公告冲突说明。[D1](06-sources.md#models)[D2](06-sources.md#models)[D3](06-sources.md#models)
- R1、V2、V3 等历史模型名称、研究发布与开放权重应作为档案/其他部署资料记录，不能自动变成官方当前 API 的可售型号。自部署或其他供应商供应需另建采购方案。
- Search/Fetch 是独立工具 API，不是新增模型家族。其费用、权限与 Agent 集成单独管理。

## B. 智谱当前核心型号与产品区分

| 精确 model_id | 模态 | 文档限制/行为 | 首期建议 |
| --- | --- | --- | --- |
| glm-5.3 | 文本 → 文本 | 1M/128K；思考始终开启；low/high/max，默认 max | 编程与复杂 Agent 任务候选 |
| glm-5.3-flash | 文本、图片、视频、文件 → 文本 | 1M/128K；思考仅 enabled；流式工具可用 | 视觉与日常 Agent 的默认候选 |
| glm-5.3-flashx | 与 Flash 同类的多模态输入 → 文本 | 1M/128K；文档主打更高速度，实际速度另测 | 快速响应选项，是否首发按采购/成本验证 |
| glm-5.3-flashx-legal | 官方列出的法律专用变体 | 精确能力继承和专业场景需单独验收 | 专业目录，不作为通用编程默认 |
| glm-5.2 | 文本 → 文本 | 1M/128K；支持流式、工具、缓存、结构化输出 | 已有客户兼容或任务对比选项 |

核心来源：[G2](06-sources.md#models)[G3](06-sources.md#models)[G4](06-sources.md#models)；中国与海外分别核对，不从同名推导服务地区。GLM 官方宣称可以配合 Agent 完成文档、PPT 等，是模型与 Agent 工具共同完成的能力；基础模型输出仍标为文本，不能宣传为模型 API 原生直接返回 PPTX。[G3](06-sources.md#models)

### 中国区官方“全部模型”登记清单

以下覆盖本次核验的官方模型概览中与智谱自有模型有关的条目。这里只登记文档公开列出的名称与用途，不把它们全部承诺成 OneAPI 已上线服务。[G1](06-sources.md#models)

| 类别 | 型号/产品 | 接口与状态处理 |
| --- | --- | --- |
| 其他文本 | GLM-5.1、GLM-5、GLM-5-Turbo、GLM-4.7、GLM-4.7-FlashX、GLM-4.6、GLM-4.5-Air、GLM-4.5-AirX、GLM-4-Long、GLM-4-FlashX-250414 | 以 Chat Completions 等各型号支持范围登记；当前列目录不代表每个地区/Key 均已获准 |
| 官方免费文本档 | GLM-4.7-Flash、GLM-4.5-Flash、GLM-4-Flash-250414 | 免费是上游公开档位，平台仍须有调用额度、容量与自身价格/服务政策 |
| 视觉理解 | GLM-5V-Turbo、GLM-4.6V、AutoGLM-Phone、GLM-4.1V-Thinking-FlashX、GLM-4.6V-Flash、GLM-4.1V-Thinking-Flash、GLM-4V-Flash | 独立记录图片/视频输入、工具能力、窗口和端点；AutoGLM-Phone 为手机操作相关能力，不默认适用所有编程 Agent |
| 图文识别 | GLM-OCR | 文档/图像解析，专门的 layout parsing 接口 |
| 自有图像生成扩展 | GLM-Image、CogView-4、CogView-3-Flash | 图像端点；CogView 标“智谱专业扩展，非 GLM 编程模型” |
| 自有视频生成扩展 | CogVideoX-3、CogVideoX-Flash | 视频异步任务与结果查询；非 GLM 编程模型，不生成编程 Agent 配置 |
| 语音识别/合成 | GLM-ASR-2512、GLM-TTS、GLM-TTS-Clone | 转录、语音生成、音色管理分别适配，不当成聊天 Key 的一个按钮完成 |
| 实时音视频/对话 | GLM-Realtime、GLM-4-Voice | 实时连接与音频对话另做协议和计量验收 |
| 检索/补全 | Embedding-3、Embedding-2、CodeGeeX-4、Rerank | embeddings、代码补全、rerank 等专门用途，不自动变为 Cursor Agent 的聊天模型 |

中国 Chat API 文本枚举核实的精确 ID：glm-5.3、glm-5.2、glm-5.1、glm-5-turbo、glm-5、glm-4.7、glm-4.7-flash、glm-4.7-flashx、glm-4.6、glm-4.5-air、glm-4.5-airx、glm-4.5-flash、glm-4-flash-250414、glm-4-flashx-250414。[G5](06-sources.md#models)

单独型号文档核实的其他 ID：glm-5v-turbo、glm-image、glm-ocr、glm-asr-2512、glm-tts、cogvideox-3、embedding-3。[G12a–G12g](06-sources.md#models) 其余清单中的 ID、各协议能力和账户可用性仍需逐项从型号页与采购账户验收；不要把英文展示名简单转小写后发布成可用 API。

历史或待核对区：定价页另列 GLM-4-Plus、GLM-4-Air-250414、GLM-4-AirX、GLM-4-Assistant、GLM-Z1 系列、CogVideoX-2、部分旧视觉与实时型号等。因为定价页明确保留历史价格，它们先进入 archived_or_needs_verification，不直接加入默认可售清单。[G6](06-sources.md#models)

第三方排除：BigModel 概览/价格表中的 Vidu Q1、Vidu 2 不算这次 DeepSeek/智谱 GLM 两个家族。即便日后从同一采购平台取得，也必须另建真实模型归属。

### 海外 Z.ai 与中国 BigModel

- 标准 API 基址分别为 open.bigmodel.cn/api/paas/v4 与 api.z.ai/api/paas/v4。[G7](06-sources.md#models)[Z1](06-sources.md#models)
- Z.ai 最新资料同样列 GLM-5.3、Flash、FlashX；普通 Chat API 文本枚举列 glm-5.3、glm-5.2、glm-5.1、glm-5、glm-4.7、glm-4.6。[Z2](06-sources.md#models)[Z3](06-sources.md#models)
- Z.ai 价格页另有其他文本、视觉、图像、视频、ASR 档位；不把这些价格行当成完整实时可用清单。对外发布前，以对应地区供应商合同、账户和实测确定。
- 同名模型可以具有不同供应方案、商户、币种、数据条件和区域销售状态。海外域名本身不能证明推理数据在美国处理。

## C. 标准 API、Coding Plan 和凭据边界

智谱 2026-10-16 公告明确：新建标准 API Key、个人套餐 Key、团队套餐 Key 分开；新 Key 的额度类型由 Key 类型决定，换支持的调用端点不会改变计费用途。历史兼容 Key 有单独规则。[G10](06-sources.md#models)

个人 Coding Plan 限订阅人和指定工具使用，使用须知列出对账号共享、倒卖、中转、套利的限制。OneAPI 不应把个人套餐当成批发服务来源。[G11](06-sources.md#models)

Z.ai Coding Plan 当前支持 GLM-5.3 与 GLM-5.3-Flash，并将部分旧模型名自动映射到新模型；FlashX 当前未纳入该套餐。这只说明套餐产品行为，不能套用到标准 API。[Z4](06-sources.md#models)[Z2](06-sources.md#models)

客户在 OneAPI 点击“生成接入配置”后得到的是平台 Key、平台 Base URL、选定 model_id、Agent 模板与预算/权限。平台上游标准 Key 不发给客户。用户选择 Agent 不意味着购买了 Cursor/Qoder/智谱的官方订阅。

## D. 三种协议要分别做能力验收

| 供应路径 | Chat Completions | Responses | Anthropic Messages |
| --- | --- | --- | --- |
| DeepSeek | https://api.deepseek.com/chat/completions | https://api.deepseek.com/responses | https://api.deepseek.com/anthropic/v1/messages |
| BigModel | https://open.bigmodel.cn/api/paas/v4/chat/completions | https://open.bigmodel.cn/api/v1/responses | https://open.bigmodel.cn/api/anthropic/v1/messages |
| Z.ai | 标准 Chat 基址 https://api.z.ai/api/paas/v4 | GLM-5.3 文档列基址 https://api.z.ai/api/v1 | GLM-5.3 文档列基址 https://api.z.ai/api/anthropic |

这是上游调研表，客户页面展示 OneAPI 地区域名，不展示采购凭据。Z.ai GLM-5.3 型号页的 Chat 基址出现 /api/coding/paas/v4，而 API Introduction/Chat API 正文给标准 /api/paas/v4；必须按凭据产品类型与实际调用验证，不盲抄一处示例。[D4](06-sources.md#models)[D5](06-sources.md#models)[G7](06-sources.md#models)[G8](06-sources.md#models)[G9](06-sources.md#models)[Z1](06-sources.md#models)[Z3](06-sources.md#models)[Z5](06-sources.md#models)

具体差异：

- DeepSeek Responses 明确无服务端会话存储，每次需发送完整 input 历史；不能只发送 previous_response_id 当作已支持续聊。当前文档不支持 file inputs，deepseek-flash 可处理限定位置的 input_image。[D4](06-sources.md#models)
- DeepSeek Messages 需正确回传 thinking/tool_use/tool_result 等内容；若把不支持的 container、mcp_servers 等字段送入，上游可能直接忽略，平台不能因此宣称功能已执行。[D5](06-sources.md#models)
- BigModel Responses 默认 store=false；流式以响应事件完成而非 [DONE]；当前未提供 cancel。启用 store/previous_response_id 会改变数据留存，应按地区与客户明确授权。[G9](06-sources.md#models)
- 中国及海外 GLM-5.3 型号页都提示：有过 Coding Plan 订阅（含已过期）的账号，目前标准模型 API 的协议访问可能限 Chat Completions。这需要以采购专用账户和实际凭据验收。[G2](06-sources.md#models)[Z5](06-sources.md#models)
- 型号也有差异：DeepSeek Pro 不收图片；DeepSeek Flash 可收图片；GLM-5.3 仅文本，Flash 可收图片/视频/文件；GLM-5.3 系列 thinking 不能关。[D2](06-sources.md#models)[G2](06-sources.md#models)[G3](06-sources.md#models)

## E. 给产品与开发的建议（推导，不是供应商承诺）

模型注册表至少保存 model_family、display_name、upstream_model_id、resolved_version、model_status、input_modalities、output_modalities、context_limit、max_output_limit、thinking_modes、reasoning_levels、tool_calling、tool_streaming、structured_output、supported_protocols、data_policy、price_version、region、provider_product_type、credential_class、docs_checked_at、tested_at。

把“是否支持某 Agent”建成有版本的兼容记录：Agent/版本/地区/运行模式/协议/模型/采购凭据/需要的能力/模板版本/验证状态。不能用 supports_cursor=true 一项覆盖 Chat、Agent、Tab 和所有客户端版本。

前台采用两种自然入口：先选模型再选 Agent；先选 Agent 再推荐合适模型。第一屏只展示两家族和少量推荐；“全部型号”保留搜索与类别筛选。缺乏图像/工具能力或客户端不允许该协议时，显示原因与可用替代，不生成必然失败的配置。

“一键生成”可以一次签发受限项目 Key 并生成配置；“一键导入”只有客户端实际有导入协议且已验收才显示，否则准确写“复制配置/按步骤粘贴”。Agent 配置中不要偷偷把 GLM 标成 Claude 或把别名映射隐藏不告诉客户。

首期验收至少涵盖普通请求、流式、多轮工具循环、工具参数分片、思考参数、图片（如承诺）、文件（如承诺）、会话状态、usage/缓存/推理计量、错误与取消、区域/预算限制、模板导入，以及客户端版本变化后的回归。


完整来源编号见 [官方来源登记](06-sources.md#models)。当前快照只代表所列官方文档的核验状态，生产商品仍须取得授权并验证具体账户。
