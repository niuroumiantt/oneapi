/* Public documentation and FAQ at #docs. Content mirrors the live API: keep limits and error codes in step with server/src/employee-credit.mjs. */
(() => {
 'use strict';
 const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
 const BASE = () => location.origin + '/v1';
 const code = (text, lang = '') => `<div class="doc-code"><div class="doc-code-head"><span>${esc(lang)}</span><button type="button" data-doc-copy>复制</button></div><pre><code>${esc(text)}</code></pre></div>`;
 const note = (text, kind = 'info') => `<div class="doc-note ${kind}">${text}</div>`;
 const table = (heads, rows) => `<div class="doc-table"><table><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 const link = (page, text) => `<a href="#docs/${page}">${text}</a>`;
 // Same catalog as the 模型广场 and the gateway (model-catalog.js); models without a route are left out.
 const MODELS = (window.SemiflyModels || []).filter(m => m.verified);
 const curl = () => `curl ${BASE()}/chat/completions \\
  -H "Authorization: Bearer $SEMIFLY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "X-Semifly-Client: my-script" \\
  -d '{
    "model": "deepseek-flash",
    "messages": [{"role": "user", "content": "用一句话介绍你自己"}],
    "max_tokens": 512
  }'`;
 const python = () => `from openai import OpenAI
import os

client = OpenAI(
    base_url="${BASE()}",
    api_key=os.environ["SEMIFLY_API_KEY"],
    default_headers={"X-Semifly-Client": "my-script"},
)
reply = client.chat.completions.create(
    model="deepseek-flash",
    messages=[{"role": "user", "content": "用一句话介绍你自己"}],
    max_tokens=512,
)
print(reply.choices[0].message.content)
print(reply.usage)`;
 const node = () => `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE()}",
  apiKey: process.env.SEMIFLY_API_KEY,
  defaultHeaders: { "X-Semifly-Client": "my-script" },
});
const reply = await client.chat.completions.create({
  model: "deepseek-flash",
  messages: [{ role: "user", content: "用一句话介绍你自己" }],
  max_tokens: 512,
});
console.log(reply.choices[0].message.content, reply.usage);`;

 // Error codes the API returns today. Anchors are linked from error.doc_url.
 const ERRORS = [
  ['400', 'invalid_request', '请求格式不对：不是 JSON 对象；messages 为空或超过 500 条；n 不等于 1；max_tokens 不在 1–32768；同时传了 max_tokens 和 max_completion_tokens。', '否', '不要重试。按 message 里的提示修改参数。'],
  ['401', 'invalid_api_key', 'Key 写错、已停用，或者 Key 的主人已离开企业、账号被停用。', '否', '检查 Authorization 是否为 “Bearer ” 加完整 Key；到“密钥”页确认 Key 仍可用，必要时停用后重新生成。'],
  ['402', 'insufficient_quota', '公司额度不足以覆盖这次调用的预扣上限（输入长度 + max_tokens）。', '否', '调小 max_tokens 或缩短上下文；额度确实不够时，请企业管理者追加额度。'],
  ['403', 'model_not_allowed', '模型名不在开放列表里。', '否', '用 GET /v1/models 查看可用模型，确认 model 字段拼写。'],
  ['413', 'request_too_large', '单次请求超过 8MB。通常是 Agent 的对话太长、读入了大文件。', '否', '在 Agent 里新开对话，或让它压缩上下文；不要把整个仓库或大文件塞进一次请求。'],
  ['429', 'rate_limit_exceeded', '同一把 Key 一分钟内超过上限（默认 60 次）。响应头带 Retry-After: 60。', '否', '按 Retry-After 等待后重试；批量任务请加间隔，或请企业管理者在“员工”页调高这把 Key 的每分钟上限。'],
  ['429', 'concurrency_limit_exceeded', '同一个人同时进行的请求超过这把 Key 的上限（默认 3 个）。响应头带 Retry-After: 5。', '否', '降低并发，等前面的请求结束再发；自动化任务可请企业管理者调高这把 Key 的同时请求数。'],
  ['502', 'upstream_error', '上游模型服务调用失败或超时。', '否', '可以重试，建议指数退避（1s、2s、4s…，最多 3 次）。持续出现请换模型或提交工单。'],
  ['502', 'upstream_bad_response', '上游返回了无法解析的内容。', '可能', '可以重试一次；仍失败请把 request_id 发给我们。'],
  ['503', 'model_unavailable', '模型暂时不可用：上游未接通、已暂停或正在维护。', '否', '看工作台“模型状态”的红绿灯，换一个绿灯模型；稍后再试。'],
  ['503', 'service_unavailable', '服务暂不可用，例如企业的公司额度尚未开通。', '否', '联系企业管理者，或稍后再试。'],
  ['500', 'server_error', '我们这边出现了意外错误。', '否', '可以重试；持续出现请带上 request_id 提交工单。']
 ];

 const PAGES = [
  { id: 'quickstart', group: '开始', title: '快速开始', body: () => `
<p class="doc-lead">三步发出第一个请求。semifly 的接口与 OpenAI Chat Completions 兼容，现有的 OpenAI SDK 和大多数 Agent 工具改一下地址和 Key 就能用。</p>
<h2 id="step-1">1. 拿到 API Key</h2>
<p>登录工作台，进入企业空间的“密钥”页，填写用途名称后点“生成 API Key”。完整 Key 只显示这一次，请立即保存到密码管理器或环境变量。</p>
${note('企业员工使用公司额度调用，按模型官网价扣费；个人账号的调用将在供给、计费验收完成后开放。')}
<h2 id="step-2">2. 发出第一个请求</h2>
${table(['项目', '值'], [['接口地址（Base URL）', `<code>${esc(BASE())}</code>`], ['鉴权', '<code>Authorization: Bearer 你的 Key</code>'], ['模型', `<code>deepseek-flash</code> 等，见 ${link('models', '可用模型')}`]])}
<p>先把 Key 放进环境变量：</p>${code('export SEMIFLY_API_KEY="sf_emp_你的Key"', 'Shell')}
${code(curl(), 'curl')}${code(python(), 'Python')}${code(node(), 'Node.js')}
<h2 id="step-3">3. 接入你常用的工具</h2>
<p>WorkBuddy、Cursor、Cline、Roo Code 等工具的填写位置见 ${link('tools', '接入指南')}。遇到报错先看 ${link('errors', '错误码')}，每个错误都写了能不能重试、怎么处理。</p>` },

  { id: 'keys', group: '基础概念', title: 'API Key 与安全', body: () => `
<p class="doc-lead">API Key 就是调用接口的密码。谁拿到它，谁就能用你的额度调用模型。</p>
<h2 id="create">生成与查看</h2>
<ul><li>每人最多保留 5 把有效 Key，建议按用途分开，例如“WorkBuddy”“周报脚本”。</li><li>完整 Key 只在生成时显示一次；之后列表只显示尾号、创建时间、已接通时长、调用次数、Token 和金额。</li><li>Key 列表里的“最近来源”显示最近一次调用来自哪个工具。</li></ul>
<h2 id="safe">保管建议</h2>
<ul><li>放在环境变量或密码管理器里，不要写进代码仓库、截图、聊天记录或工单。</li><li>不同工具用不同 Key，出问题时只停用一把。</li><li>怀疑泄露：立即在“密钥”页停用，再生成新的。停用即时生效。</li></ul>
<h2 id="leave">员工离开企业时</h2>
<p>员工被停用或移出企业后，名下所有 Key 立即失效，已发生的调用记录保留。</p>` },

  { id: 'tokens', group: '基础概念', title: 'Token 是什么', body: () => `
<p class="doc-lead">Token 是模型处理文字的基本单位，计费按 Token 数计算，不按字数或次数。</p>
<h2 id="estimate">大致换算</h2>
${table(['内容', '大约'], [['1 个汉字', '0.6 – 1 个 Token'], ['1 个英文单词', '1 – 1.5 个 Token'], ['1000 个汉字的文章', '约 600 – 1000 个 Token']])}
${note('以上只是估算，不同模型的分词方式不同。实际用量以接口返回的 <code>usage</code> 为准。')}
<h2 id="kinds">三种 Token</h2>
${table(['类型', '含义', '计价'], [['输入（未命中缓存）', '你这次发给模型的全部内容：系统提示、历史对话、工具说明、文件内容', '输入价'], ['输入（命中缓存）', '和最近请求开头相同、模型复用了缓存的部分', '缓存价，通常远低于输入价'], ['输出', '模型生成的内容，包括思考过程', '输出价']])}
<h2 id="agent">为什么用 Agent 时 Token 特别多</h2>
<p>Agent 每发一句话，都会把系统提示、几十个工具说明和之前的整段对话一起发过去。对话越长，每一轮的输入就越大。一段长任务里单次输入几十万 Token 很常见。</p>
<ul><li>一件事做完就新开对话，比在同一个对话里一直聊省得多。</li><li>前缀稳定的长对话能命中缓存，缓存部分按低价计。</li></ul>` },

  { id: 'billing', group: '基础概念', title: '计费与额度', body: () => `
<h2 id="price">价格</h2>
<ul><li>企业员工按模型<b>官网价</b>从公司额度中扣除，价格见工作台“模型”页或 ${link('models', '可用模型')}。</li><li>DeepSeek 系列在工作日高峰时段价格为空闲时段的 2 倍，模型页可以切换查看两个时段的价格。</li></ul>
<h2 id="hold">预扣与结算</h2>
<ol><li>请求发出前，按“输入长度 + max_tokens”的上限先预扣一笔额度，保证并发请求不会超支。</li><li>模型返回后，按实际 <code>usage</code> 和官网价结算，多扣的部分立即退回。</li><li>没有返回用量时（例如流式中途断开），等上游账单到达后按实际金额结算。</li></ol>
${note('调用失败（4xx、上游失败）不扣费。逐笔扣费明细在“用量”和“密钥 → 调用历史”里可以看到。', 'ok')}
<h2 id="quota">公司额度</h2>
<p>员工加入企业后自动获得公司额度，管理者可以在“员工”页调整。额度用完时接口返回 ${link('errors/insufficient_quota', '402 insufficient_quota')}。</p>` },

  { id: 'limits', group: '基础概念', title: '速率与用量限制', body: () => `
${table(['限制', '数值', '超出时'], [['每把 Key 每分钟请求数', '默认 60 次，管理者可按 Key 调到最多 1200 次', `${link('errors/rate_limit_exceeded', '429 rate_limit_exceeded')}，Retry-After: 60`], ['每人同时进行的请求', '默认 3 个，管理者可按 Key 调到最多 64 个', `${link('errors/concurrency_limit_exceeded', '429 concurrency_limit_exceeded')}，Retry-After: 5`], ['单次请求大小', '8MB', `${link('errors/request_too_large', '413 request_too_large')}`], ['单次输出 max_tokens', '1 – 32768，默认 4096', '400 invalid_request'], ['messages 条数', '最多 500 条', '400 invalid_request'], ['每人有效 Key', '5 把', '生成时提示']])}
<h2 id="rpm">RPM 与 TPM</h2>
<p><b>RPM</b> 是每分钟请求数，<b>TPM</b> 是每分钟 Token 数。工作台显示的是最近 24 小时的平均值：24 小时总量除以 1440 分钟。平均值很平滑，所以我们同时显示<b>峰值 RPM</b>，也就是最忙的那一分钟有多少次请求。峰值接近 60 时就会被限流。</p>
<h2 id="retry">重试建议</h2>
<ul><li>429：按响应头 Retry-After 等待后重试。</li><li>502、503、500：指数退避重试，1 秒、2 秒、4 秒，最多 3 次。</li><li>400、401、402、403、413：不要重试，先修改请求。</li></ul>` },

  { id: 'privacy', group: '基础概念', title: '数据与隐私', body: () => `
<h2 id="store">我们记录什么</h2>
${table(['记录', '内容'], [['调用元数据', '时间、模型、Key、输入/输出 Token、金额、延迟、状态'], ['调用来源', '请求自带的客户端标识，例如 WorkBuddy、Python SDK，用来判断来自哪个工具'], ['提问摘要（可选）', '企业管理者开启后才记录：最后一条提问的前 60 个字']])}
<h2 id="not-store">我们不记录什么</h2>
<ul><li>不保存完整对话，不保存模型的回答。</li><li>提问摘要会自动隐去密钥、密码、邮箱、手机号、证件号和长数字，保存 30 天后删除；管理者关闭这项功能时立即删除。</li><li>员工只能看到自己的记录，管理者能看到本企业员工的记录。</li></ul>
${note('开启提问摘要的企业，员工在“密钥”页会看到黄色提示。按《个人信息保护法》，企业还应在内部制度中告知员工。')}` },

  { id: 'chat', group: 'API 参考', title: '对话补全', body: () => `
<p class="doc-lead"><span class="doc-method">POST</span> <code>${esc(BASE())}/chat/completions</code></p>
<p>与 OpenAI Chat Completions 兼容。下面列出常用参数；其他 OpenAI 标准参数（如 temperature、top_p、stop、response_format）会原样转发给模型。</p>
<h2 id="request">请求参数</h2>
${table(['参数', '类型', '必填', '说明'], [['model', 'string', '是', `模型 ID，见 ${link('models', '可用模型')}`], ['messages', 'array', '是', '1 – 500 条消息，每条包含 role（system / user / assistant / tool）和 content'], ['max_tokens', 'integer', '否', '最多生成多少 Token，1 – 32768，默认 4096。也可写作 max_completion_tokens，二选一'], ['stream', 'boolean', '否', 'true 时以 SSE 流式返回，最后一个数据块带 usage'], ['tools / tool_choice', 'array / object', '否', '工具调用（function calling），格式同 OpenAI'], ['temperature', 'number', '否', '采样温度，0 – 2'], ['n', 'integer', '否', '只支持 1']])}
<h2 id="response">响应字段</h2>
${table(['字段', '说明'], [['id', '本次补全的编号'], ['model', '实际处理的模型'], ['choices[].message', '模型回答；工具调用时含 tool_calls'], ['choices[].finish_reason', 'stop（正常结束）、length（达到 max_tokens）、tool_calls'], ['usage.prompt_tokens', '输入 Token'], ['usage.prompt_tokens_details.cached_tokens', '其中命中缓存的部分'], ['usage.completion_tokens', '输出 Token']])}
<h2 id="stream">流式输出</h2>
<p>设置 <code>"stream": true</code> 后返回 <code>text/event-stream</code>，每行 <code>data: {...}</code>，以 <code>data: [DONE]</code> 结束。我们会自动打开 <code>include_usage</code>，最后一个数据块包含用量。</p>
<h2 id="examples">示例</h2>${code(curl(), 'curl')}${code(python(), 'Python')}${code(node(), 'Node.js')}` },

  { id: 'models', group: 'API 参考', title: '可用模型', body: () => `
<p class="doc-lead"><span class="doc-method get">GET</span> <code>${esc(BASE())}/models</code> 返回当前这把 Key 可用的模型列表。</p>
${table(['模型 ID', '名称', '思考', '其他能力'], MODELS.map(m => [`<code>${esc(m.id)}</code>`, esc(m.name), esc(m.tags[0]), esc(m.tags.slice(1).join('、'))]))}
${note('“默认思考 · 可关”和“始终思考”的模型先思考再回答，思考内容也占用 max_tokens。max_tokens 设得太小时，content 会是空的、finish_reason 为 length。DeepSeek 可传 <code>thinking: {"type": "disabled"}</code> 关闭思考；GLM-5.3 系列不能关闭，最低可把 <code>reasoning_effort</code> 设为 <code>low</code>。')}
<p>列表里每个模型除了标准的 <code>id</code>、<code>object</code>、<code>owned_by</code>，还带三个字段，方便程序判断模型能做什么：</p>
${table(['字段', '含义'], [['name', '显示名称'], ['tags', '中文能力标签，与模型广场一致'], ['capabilities', '<code>thinking</code>（switchable 可关 / always 不能关 / none 不思考）、<code>reasoning_efforts</code>、<code>input</code> 和 <code>output</code>（text、image 等）、<code>tool_calling</code>、<code>parallel_tool_calls</code>、<code>json_output</code>、<code>json_schema</code>、<code>prompt_cache</code>、<code>context_window</code>、<code>max_output_tokens</code>']])}
${note('价格和实时状态以工作台“模型”页为准：红绿灯表示平台每 10 分钟实测一次的结果，绿灯可用，红灯失败或未接通，黄灯尚未实测。')}
${code(`curl ${BASE()}/models -H "Authorization: Bearer $SEMIFLY_API_KEY"`, 'curl')}` },

  { id: 'headers', group: 'API 参考', title: '请求头与响应头', body: () => `
<h2 id="request-headers">请求头</h2>
${table(['请求头', '必填', '说明'], [['Authorization', '是', '<code>Bearer 你的 Key</code>'], ['Content-Type', '是', '<code>application/json</code>'], ['X-Semifly-Client', '否', '自报调用来源，例如 <code>weekly-report</code>。管理者能在用量里看到。中文名请先做 URL 编码']])}
<h2 id="response-headers">响应头</h2>
${table(['响应头', '说明'], [['X-Semifly-Request-Id', '每个请求的编号，以 req_ 开头。排查问题或提交工单时请提供'], ['X-Semifly-Call-Id', '成功计费的调用编号，对应“调用历史”里的记录'], ['Retry-After', '429 时返回，单位秒']])}` },

  { id: 'errors', group: '错误码', title: '错误码', body: () => `
<p class="doc-lead">出错时返回 OpenAI 兼容的错误对象。程序请按 <code>error.code</code> 判断，不要匹配 message 文案。</p>
${code(JSON.stringify({ error: { message: '公司额度不足以覆盖这次调用的上限，可调小 max_tokens', type: 'invalid_request_error', code: 'insufficient_quota', status: 402, request_id: 'req_7b2f…', doc_url: location.origin + '/#docs/errors/insufficient_quota' } }, null, 2), 'JSON')}
${table(['状态', '错误代码', '含义', '扣费', '处理办法'], ERRORS.map(([s, c, m, f, h]) => [`<b>${s}</b>`, `<code id="err-${c}">${c}</code>`, m, f, h]))}
${note('所有 4xx 错误都不扣费。提交工单时请附上 request_id，我们能直接定位到那一次请求。')}` },

  { id: 'tools', group: '接入指南', title: '接入常用工具', body: () => `
<p class="doc-lead">在任何支持“OpenAI 兼容 / 自定义接口”的工具里，填这三项即可：接口地址 <code>${esc(BASE())}</code>、API Key、模型 ID。地址已经包含 /v1，不要再追加。</p>
${table(['工具', '在哪里填', '注意'], [
 ['WorkBuddy', '头像 → 系统设置 → 模型 → 添加模型，供应商选“自定义 / Custom”', '让 Agent 操作文件时打开“工具调用”；最大输出不超过 32768'],
 ['Qoder', '设置 → 模型 → 添加模型，选 OpenAI Compatible / Chat Completions API', 'Model ID 添加后不能修改'],
 ['Trae', '设置 → 模型 → 添加模型 → 自定义模型，API 格式选 OpenAI Chat Completions', '关闭“完整 URL”开关'],
 ['Cursor', 'Settings → Models → API Keys，打开 OpenAI API Key 和 Override OpenAI Base URL', '需付费方案；开启后其他 OpenAI 模型的请求也会发到这里'],
 ['Cline / Roo Code', 'VS Code 插件设置，API Provider 选 OpenAI Compatible', 'Max Output Tokens 设为不超过 32768'],
 ['OpenCode', '写入 ~/.config/opencode/opencode.json 的 provider 配置', '不要把配置文件提交到代码仓库'],
 ['直接调用 API', `curl、Python、Node 示例见 ${link('quickstart', '快速开始')}`, '建议加 X-Semifly-Client 请求头'],
 ['自建 Agent', '选 OpenAI 兼容接口，填三项', '工具调用用 tools 参数；在请求头自报 X-Semifly-Client']])}
<h2 id="unsupported">暂不支持</h2>
<p>Claude Code 和 Codex 需要 Anthropic Messages 或 OpenAI Responses 接口，semifly 目前只提供 Chat Completions，暂时不能直接接入。</p>
${note('工作台“模型 → 接入配置”里选择工具，会显示带截图位置的分步说明，并可一键复制三项配置。')}` },

  { id: 'faq', group: '常见问题', title: '常见问题', body: () => FAQ.map(([group, items]) => `<h2 id="faq-${esc(group)}">${esc(group)}</h2>${items.map(([q, a]) => `<details class="doc-faq"><summary>${esc(q)}</summary><div>${a}</div></details>`).join('')}`).join('') }
 ];

 const FAQ = [
  ['所有人', [
   ['“测试连接”成功，真正用起来却报错？', `测试连接只发一句很短的话。真正使用时 Agent 会带上整段对话和工具说明，可能超过大小或额度限制。按报错里的 code 查 ${link('errors', '错误码')}。`],
   ['为什么会报 413？', `单次请求超过 8MB，通常是同一个对话聊得太久或读入了大文件。新开对话即可。详见 ${link('errors', '413 request_too_large')}。`],
   ['Token 和字数怎么换算？', `大约 1 个汉字 0.6 – 1 个 Token，实际以返回的 usage 为准。详见 ${link('tokens', 'Token 是什么')}。`],
   ['模型旁边的红绿灯是什么意思？', '平台每 10 分钟对每个模型发一次极小的测试请求：绿灯正常并显示延迟，红灯失败或未接通，黄灯尚未实测或已暂停。可以点“立即实测”手动刷新，1 分钟内最多一次。'],
   ['延迟为什么有时很高？', '显示的是平台到上游返回首个结果的时间。上游繁忙、模型在思考、或输入很长时都会变慢。'],
   ['怎么看自己用了多少？', '工作台“用量”和“密钥 → 调用历史”可以看到每一次调用的 Token 和金额。'],
   ['报错了怎么找你们？', '在工作台“支持”页提交工单，附上错误里的 request_id 和发生时间，不要粘贴 API Key。']]],
  ['企业员工', [
   ['公司额度用完了怎么办？', '请企业管理者在“员工”页给你调整额度。额度不足时接口返回 402。'],
   ['Key 能不能给别人用？', '不建议。Key 的所有调用都记在你名下、扣你的额度。需要给工具单独用，就多生成一把 Key。'],
   ['公司能看到我的哪些信息？', `调用时间、模型、Token、金额、延迟和调用来源。企业开启提问摘要后，还能看到每次提问的前 60 个字（已隐去敏感信息）。不会看到完整对话。详见 ${link('privacy', '数据与隐私')}。`],
   ['离开公司后 Key 会怎样？', '账号被停用或移出企业后，名下所有 Key 立即失效。']]],
  ['企业管理者', [
   ['怎么邀请员工？', '“员工”页生成邀请链接发给同事。同事验证邮箱、提交申请后，由管理者批准。'],
   ['怎么调整额度和部门？', '“员工”页点“调整额度”可以拖动滑条；部门在“设置 → 部门”统一维护，再在员工的“管理”里选择。'],
   ['RPM、TPM 和峰值怎么看？', `“用量 → 消费趋势”顶部显示所选时段的平均 RPM、TPM 和峰值；Key 和模型表格里显示最近 24 小时的数值。详见 ${link('limits', '速率与用量限制')}。`],
   ['调用摘要怎么开？员工会看到什么？', '“设置 → 企业与账户”里开启。开启后员工在密钥页会看到提示；关闭时已保存的摘要立即删除。'],
   ['账单和对公转账在哪里？', '左侧“账单”页。对公转账到账核对后计入企业余额。']]],
  ['个人用户', [
   ['什么时候能自己调用？', '个人账号的 API 调用会在供给、计费和付款验收完成后开放，届时充值即可生成 Key。'],
   ['怎么升级为企业账号？', '“设置 → 账户资料”里提交企业资料，审核通过后个人空间转为企业空间，余额和 Key 一并保留。']]]
 ];

 let host;
 const handles = view => view === 'docs' || view.startsWith('docs/');
 function render(view) {
  const [, pageId = 'quickstart', anchor] = view.split('/');
  const page = PAGES.find(p => p.id === pageId) || PAGES[0];
  if (!host) { host = document.createElement('div');host.id = 'docs-view';document.body.append(host); }
  document.querySelectorAll('#market-view,#admin-view,#login-view,#identity-view,#landing-view').forEach(el => { el.hidden = true; });
  document.body.classList.remove('market-active', 'identity-active', 'welcome-active', 'universe-active', 'ops-active', 'catalog-active', 'landing-active');
  document.body.classList.add('docs-active');host.hidden = false;
  window.IdentityUI?.cancel?.();window.UniverseScene?.setActive?.(false);
  const groups = [...new Set(PAGES.map(p => p.group))];
  const nav = groups.map(g => `<div class="doc-nav-group"><b>${esc(g)}</b>${PAGES.filter(p => p.group === g).map(p => `<a href="#docs/${p.id}" class="${p.id === page.id ? 'active' : ''}">${esc(p.title)}</a>`).join('')}</div>`).join('');
  const i = PAGES.indexOf(page), prev = PAGES[i - 1], next = PAGES[i + 1];
  host.innerHTML = `<header class="doc-top"><a class="doc-brand" href="#universe"><img src="pinapi-wordmark.svg" alt="semifly.ai"></a><span class="doc-top-title">文档中心</span><input class="doc-search" type="search" placeholder="搜索文档，例如 413、Token、Cursor" aria-label="搜索文档" data-doc-search><nav><a href="#market">模型广场</a><a href="#workspace">工作台</a></nav></header>
<div class="doc-layout"><aside class="doc-nav" aria-label="文档目录">${nav}</aside><main class="doc-main"><p class="doc-crumb">${esc(page.group)}</p><h1>${esc(page.title)}</h1><div class="doc-body">${page.body()}</div><div class="doc-pager">${prev ? `<a href="#docs/${prev.id}">← ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a href="#docs/${next.id}">${esc(next.title)} →</a>` : ''}</div></main></div>`;
  document.title = `${page.title} · semifly.ai 文档`;
  const target = anchor ? host.querySelector(`#err-${CSS.escape(anchor)}`) || host.querySelector(`#${CSS.escape(anchor)}`) : null;
  if (target) { target.closest('tr')?.classList.add('doc-hit');target.scrollIntoView({ block: 'center' }); } else window.scrollTo(0, 0);
 }
 function hide() { if (host) host.hidden = true;document.body.classList.remove('docs-active'); }
 document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-doc-copy]');if (!b) return;
  const text = b.closest('.doc-code')?.querySelector('code')?.textContent || '';
  navigator.clipboard?.writeText(text).then(() => { b.textContent = '已复制';setTimeout(() => { b.textContent = '复制'; }, 1500); }).catch(() => {});
 });
 document.addEventListener('input', e => {
  if (!e.target.matches?.('[data-doc-search]')) return;
  const q = e.target.value.trim().toLowerCase();
  host.querySelectorAll('.doc-nav a').forEach(a => {
   const p = PAGES.find(x => '#docs/' + x.id === a.getAttribute('href'));
   const hit = !q || (p.title + ' ' + p.body().replace(/<[^>]+>/g, ' ')).toLowerCase().includes(q);
   a.hidden = !hit;
  });
 });
 window.DocsUI = { handles, render, hide };
})();
