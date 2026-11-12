# 模型链路边界与测试运营 交接（更新于 2026-11-12，机器 m5）

## 目标

把一次调用经过的每一层（客户端、我们的网关、服务器、KerAPI、官方模型）的边界测出来，写成一张边界总表，再用它决定对客户的承诺、网关规则和服务器配置；同时设计自动测试的排期、预算、告警，以及它们在技术后台的位置。

完整讲解（六个方面、实测数据、风险与告警、后台方案）：https://claude.ai/artifact/FocuJnMLr5XDg3tACZpAbs （私有，需用户账号打开）。

## 已定规则（用户确认过的，不要再问）

- 花钱的自动测试放在最便宜的时段（凌晨低谷，DeepSeek 半价）；手动测试随时可以触发。我补充并被采纳的一条：高峰时段保留极小的抽样，否则看不到高峰降速。
- 先测、先讨论，**不上线代码**。网关部分除了观察，还要给出修改建议、改动风险和告警。
- 网关设置以 `docs/14-gateway-settings.md`（另一个会话今天建的登记表）为唯一口径。本任务只补登记表里没有的内容，编号对齐它。

## 进度

已完成（只读查询和测试，没有改任何线上设置）：

- 速度：线上近 3 天真实调用的整次平均速度（GLM-5.3 中位 57、DeepSeek Flash 117 Token/秒）；高峰低谷无差别；KerAPI 账单日志里每笔有耗时和首字时间，可用来算网关开销（中位 67–254 毫秒）。
- 官方对 KerAPI 单路实测（2026-11-12 上午，高峰，inews 同时在跑，每格一个样本）：DeepSeek 写小说官方 117/秒、KerAPI 58/秒；写数字题写满 32K 官方 98 秒、KerAPI 134 秒；KerAPI 的 GLM-5.3-Flash 短题一次 143/秒、一块约 20 个 Token；但写长文时 32/秒、一个 Token 一块，和官方一致，疑点基本消除。
- 速度和内容有关：可预测文本（数字）快很多，测速必须用真实文字。
- 长回答可能越写越慢：KerAPI 的 GLM-5.3 写长文 14,311 个 Token 用了 432 秒（33/秒），官方同题 7,770 个、52/秒；FlashX 和 Flash 两边一致。按 33/秒写满 32K 要约 990 秒，超过登记表 D1 的 15 分钟（D1 按 50/秒估算约 650 秒）。单个样本，需要凌晨重复。KerAPI 在 432 秒时没有切断，它的时限至少这么长。
- 网关承载（本机、假上游、每 Token 单独写）：256 路同时流式全部成功，首字只多约 75 毫秒，CPU 线性增长到本机一个核的 57%，内存每路约 0.2MB；短请求每秒 1,200–1,900 个，数据库连接池不排队。
- 旧规则下 300 秒切断的行为（本机复现）：流式收到前半段、无结束标记；非流式 5 分钟后 502。负责人今天已定改为 15 分钟 + 流式 60 秒空闲（PR 58，已合并；写交接时生产仍是 `649c652`，未含 PR 58）。
- 重启幽灵调用现场证实：11:38 发版重启，9 个 inews 调用占住 9 个并发名额和 2.58 元预留（登记表 C4、D6，待决定第 6 条）。
- KerAPI 收费与官方价几乎一致；被客户端断开的调用基本不收费。
- 服务器：2 核 7.5G，23 个容器共用，上午多次采样 CPU 空闲为 0；网关容器 0.75 核、512MB。带宽配置未查到。

服务器上的一次性容器测试（网关重启也不会中断）：

- 上游并发阶梯已在 12:20–12:24 跑完（员工流量为 0 时自动开始），花费约 1.38 元（按高峰价估算）。DeepSeek Flash 和 GLM-5.3 各从 1 路加到 48 路：全部成功、没有 429、每路速度基本不变（DeepSeek 80–103/秒，GLM 37–42/秒），首字 p95 从约 1 秒升到 1.3–1.7 秒，合计吞吐近似线性增长（48 路时 DeepSeek 1,643、GLM 1,350 Token/秒）。KerAPI 的上限在 48 路以上，还没找到。
- KerAPI 的 GLM 长文实测已在 11:59 完成，结果已写进页面和上面的结论。
- 用 `scripts/boundary/summarize_probe.py` 汇总单路结果。

## 下一步

1. 凌晨把阶梯加到 64、96 路找 KerAPI 真实上限。登记表第 3 条的建议：总闸先设 40 路（低于已测的 48）；我们自己的服务器估计在 50–100 路先碰顶。
2. 把长文测试加进凌晨排期，多攒几个 GLM-5.3 样本，确认“越写越慢”，再决定登记表 D1 的 15 分钟够不够、对外写多长。
3. 身份检测改成每天凌晨自动跑；顺带复查 GLM-5.3-Flash 短题上那次异常。
4. 在阿里云控制台查这台机器的带宽计费方式和上限，填进“服务器”页。
5. 用户决定后再动代码：R4 启动时清理幽灵调用、R3 记录首字时间和是否流式、R8 预留按字符估算、告警规则、测试计划页。这些都还没有写代码。

## 待用户决定

见页面“总览”页最后一节：幽灵调用的清理方式（登记表第 6 条）、对 KerAPI 的总闸（第 3 条）、网关是否搬独立机器、自动测试每日预算（建议 5 元/天、100 元/月）。

## 入口文件与工具

- 单路速度与长输出：`scripts/boundary/speed-probe.mjs`、`scripts/boundary/long-output-probe.mjs`；上游阶梯：`scripts/boundary/upstream-ladder.mjs`。都在生产容器环境里运行，读加密的采购 Key 和官方评测 Key，结果只写标准输出、不写库、不打印密钥。运行方式（服务器上，在 `/srv/oneapi-runtime` 下）：
  `sudo docker compose -p oneapi --env-file /srv/oneapi-config/compose.env -f compose.yml -f pilot.override.yml run --rm -T --no-deps --name <名字> api node --input-type=module < 脚本 > 结果.jsonl`
  不要用 `docker exec oneapi-api-1`：网关一发版重启，脚本就会被一起杀掉（今天发生过）。
- 网关承载测试：`scripts/boundary/gateway-capacity/`（`seed.mjs` 灌种子、`upstream.mjs` 假上游、`gateway.mjs` 用生产代码起网关、`load.mjs` 压测、`cut.mjs` 测时限行为）。需要一个以 `_test` 结尾的临时库，环境变量 `DATABASE_URL`、`BETTER_AUTH_SECRET`、`SUPPLIER_LAB_SECRET`；本机起 PostgreSQL 前先 `export LC_ALL=en_US.UTF-8`。假上游用 `TICK=8` 才接近 KerAPI 一个 Token 写一次的真实情况。
- 计费口径、网关设置：`docs/14-gateway-settings.md`；测试体系：`docs/13-testing-system.md`。
- 每笔调用对 KerAPI 账单：`supplier_usage_records.evidence` 里有 `latency_ms`、`ttft_ms`、`output_tokens`，按 `employee_calls.upstream_request_id = request_id` 关联。
