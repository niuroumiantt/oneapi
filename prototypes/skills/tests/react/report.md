# ReviewFixture.tsx 代码审查

已读取指定的 vercel-react-best-practices Skill，以及 async-parallel、bundle-barrel-imports、client-swr-dedup、rerender-memo 规则文件。仅依据提供的源码，报告以下 3 项具体问题。行号均指 ReviewFixture.tsx。

## 1. 独立的用户与订单请求被串行等待

- 位置：第 8, 9, 10, 11 行
- 规则：`async-parallel`

订单请求仅使用入参 userId，不依赖用户响应；但代码等待用户请求及其 JSON 解析完成后才发起订单请求，形成可避免的请求瀑布。

建议：使用 Promise.all 同时启动两条请求及各自的 JSON 解析链，再组合 user 与 orders 返回。

## 2. 只使用 sortBy 却从 lodash 根入口导入整个对象

- 位置：第 3, 20 行
- 规则：`bundle-barrel-imports`

该文件声明为客户端模块，lodash 的唯一用途是 _.sortBy。根入口默认导入引入了不必要的库级依赖，不利于按方法限制客户端依赖范围；具体产物大小需由实际构建确认。

建议：改为从 lodash/sortBy 直接导入 sortBy，并调用 sortBy(results, ['title'])；结合项目的类型声明确认该子路径可用。

## 3. 搜索请求缺少隔离，旧查询响应可覆盖新结果

- 位置：第 16, 17, 18, 19 行
- 规则：`client-swr-dedup`

query 变化会启动新请求，而所有请求都直接调用同一个 setResults，没有清理或当前查询校验。若较早查询的响应较晚到达，它就会覆盖较新查询的结果。该 Effect 也没有按查询键共享缓存或去重机制，但代码未展示多个实例，不能断言已产生重复请求。

建议：按包含 query 的 URL 作为 SWR 请求键读取对应结果；若保留 Effect，则在清理函数中取消请求或设置失效标记，并在写入状态前检查，确保旧查询无法覆盖当前查询。

未将第 20 行每次渲染排序单独列为问题：缺少数据规模、重渲染负担及编译器配置证据，无法据此认定需要手工记忆化。Greeting 也没有可由当前代码证明的性能问题。

本次仅进行静态审查，未读取 expected.json，未修改源码，未联网、构建、安装依赖或运行测试。没有实测延迟、包体积或测试结果。
