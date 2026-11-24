# 技术后台「模型管理」设计（接入检测 + 模型广场上下线）

> 状态：设计定稿（2026-11-24），实现进行中。
> 目标：把「哪些模型上线、哪些不上线」从**代码硬编码**变成**技术后台可运营的数据 + 开关**。

## 一、背景与问题

当前模型目录 `OFFICIAL_MODELS` 硬编码在 `server/src/official-models.mjs` 里，模型广场（`web/model-catalog.js`）、`/v1/models`、`/api/public/models`、多个后台都直接读这个静态数组。

带来的问题：
1. **上下线要改代码**：加/减模型、调整上下线，都要改数组 → 重新 build → 重新部署。
2. **探测结果与目录脱节**：`supplier_lab_discoveries` 已经能通过原厂 API 探测到模型清单，但探测到的模型无法直接「上线」。
3. **无法「测出 5 个只上 3 个」**：模型广场展示与否，当前只由「是否有线路 / 是否 verified」间接决定，没有独立的、显式的上下线开关。

## 二、目标流程（两步）

```
┌─────────────────────────────────────────────────────────────────┐
│  技术后台 · 模型管理                                              │
│                                                                  │
│  Tab 1：接入并检测                                                 │
│    登记原厂端点(base_url+key) → 探测 /models 拿模型清单           │
│    → 逐模型测延迟/成功率 → 输出检测结论 → 登记进候选目录           │
│                                                                  │
│  Tab 2：管理模型广场                                               │
│    候选模型池 → 独立上下线开关(listed) → 广场/网关实时同步          │
│    测出 5 个，勾选 3 个上线 → 广场只展示这 3 个                    │
└─────────────────────────────────────────────────────────────────┘
```

## 三、数据模型（模型目录下移 DB）

新增 migration `077_model_catalog.sql`：

### 3.1 模型目录表 `model_catalog`

模型目录的「唯一事实源」从代码数组迁移到这张表。字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | text PK | 模型 id，如 `deepseek-flash` |
| `name` | text | 展示名 |
| `family` | text | 厂商 family（deepseek/glm/…） |
| `subtitle` | text | 副标题 |
| `description` | text | 描述 |
| `version` | text | 版本标注 |
| `upstream` | text | 上游线路类型（kerapi/deepseek/…） |
| `upstream_model` | text | 上游模型 id |
| `aliases` | text[] | 别名 |
| `rates` | jsonb | 官价 `{input,cached,output}`（元/百万 token） |
| `peak_pricing` | boolean | 是否高峰 2 倍价 |
| `tags` / `uses` | text[] | 展示标签 / 用途 |
| `caps` | jsonb | 能力 `{thinking,input,output,tools,…}` |
| `verified` | boolean | 是否通过检测 |
| **`listed`** | boolean | **上下线开关**：true=模型广场展示、网关可路由；false=隐藏 |
| `listed_at` / `listed_by` | — | 上线时间 / 操作人 |
| `detected_at` | timestamptz | 最近一次探测时间 |
| `detection_verdict` | text | 检测结论 `ok / watch / suspect / pending` |
| `created_at` / `updated_at` | — | 时间戳 |

### 3.2 上线开关是「独立」的

关键设计：`listed`（上下线）与 `verified`（检测通过）**解耦**。
- `verified`：技术事实（检测有没有通过）
- `listed`：运营决策（要不要给客户用）

这样就能做到：测出 5 个模型全部 `verified=true`，但只把其中 3 个设 `listed=true`，广场就只展示这 3 个。

### 3.3 探测端点表（复用 + 轻量新增）

复用现有 `supplier_lab_endpoints`（base_url + model_id + 凭证）。新增轻量表 `model_catalog_probes` 记录「探测原厂 /models 返回的模型清单」：

| 字段 | 说明 |
|------|------|
| `endpoint_id` | 关联探测端点 |
| `discovered_model_ids` | text[] 探测到的模型 id 列表 |
| `latency_ms` | 探测延迟 |
| `status` | 探测状态 |
| `created_by` / `created_at` | 操作人/时间 |

## 四、接口设计

### Tab 1 接入并检测（轻量流程）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/staff/catalog/endpoints` | 登记原厂端点（base_url + key，凭证加密） |
| POST | `/api/staff/catalog/endpoints/:id/probe` | 调原厂 `/models` 探测模型清单（速度/延迟），落 `model_catalog_probes` |
| POST | `/api/staff/catalog/probe/:id/register` | 把探测到的模型登记进 `model_catalog`（候选，`listed=false`） |
| GET | `/api/staff/catalog/probes` | 列探测记录与结论 |

### Tab 2 管理模型广场

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/staff/catalog/models` | 列候选模型（含检测结论、listed 状态） |
| POST | `/api/staff/catalog/models/:id/list` | 上线（`listed=true`） |
| POST | `/api/staff/catalog/models/:id/unlist` | 下线（`listed=false`） |

### 读取点改造（目录下移 DB 后必须改）

以下地方从「读 `OFFICIAL_MODELS` 数组」改为「读 `model_catalog` 表 + `listed=true` 过滤」：

1. `web/model-catalog.js` 的生成源 → 改为从 DB 读（或提供 `/api/public/catalog` 接口给广场）
2. `/api/public/models` → 改为 `listed` 过滤
3. `/v1/models` → 只返回 `listed=true` 的模型
4. `/v1/chat/completions` 路由校验 → 拒绝 `listed=false` 的模型
5. 员工额度 `employee-credit.mjs` 的 `available` 列表 → 加 `listed` 过滤

## 五、状态机

```
                探测 ──> 检测 ──> 候选 ──> 上线(listed=true)
                 │          │         │           │
                 └─失败      └─存疑    └─(可随时)  └─下线(listed=false)
```

- 探测：原厂 `/models` 拿清单，测延迟/成功率
- 检测：结论 ok / watch / suspect / pending
- 候选：登记进目录，默认 `listed=false`（不展示）
- 上线/下线：运营开关，秒级生效（无需改代码重部署）

## 六、迁移策略

1. 新增 `077_model_catalog.sql`：建 `model_catalog` + `model_catalog_probes` 表。
2. 种子数据：把现有 `OFFICIAL_MODELS` 7 个模型导入 `model_catalog`，`listed` 初始值 = 现有 `verified`（保持现状不突变）。
3. 灰度切换：先让 `model_catalog` 表和代码数组并存，后台读表、网关读表，观察稳定后废弃 `OFFICIAL_MODELS` 数组（保留为种子来源 + 单测基准）。

## 七、风险与边界

- **目录是网关核心依赖**，改造要灰度，不能一次性砍掉 `OFFICIAL_MODELS`。
- `caps`/`rates` 是 jsonb，读取时要兼容现有 `official-models.mjs` 导出的函数（`capabilityTags`、`publicCapabilities` 等），避免网关逻辑重写。
- 上线开关只影响「是否展示/可路由」，不删除线路；下线后已有 Key 的历史调用记录保留。
