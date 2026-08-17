# CLAUDE.md

本文件为 AI 协作提供项目上下文，帮助理解架构、约定与维护要点。

## 项目概述

基于 **uni-app (Vue 3)** 的轻量级 LLM 人格聊天 App「AI 伙伴」，**无后端、纯端侧**：

- 调用任意 **OpenAI 兼容** 的 `/chat/completions` 接口
- 系统提示词定义人格（4 个预设 + 自定义），LLM 在回复末尾输出结构化 `Memory:` 行实现记忆写入
- 记忆持久化设计**移植自 koishi-ai-pet** 项目（SQLite 记忆存储），核心逻辑见 `utils/memory.js`
- 跨端：App (5+)、H5、微信小程序

## 技术栈与运行

- uni-app + Vue 3（HBuilderX 工程，`vueVersion: "3"`），页面使用 **Options API**
- 无第三方 npm 依赖，`package.json` 仅用于 `npm test`
- 运行：HBuilderX 导入项目 → 运行到浏览器 / 真机 / 模拟器
- 验证：`npm test`（Node 环境 mock `uni` 验证核心逻辑）；`node --check` 校验语法

## 目录结构

```
├── App.vue                # onLaunch 初始化存储 + 记忆维护
├── pages.json             # 页面注册 + tabBar（聊天/记忆/设置）
├── pages/
│   ├── chat/chat.vue      # 聊天页（背景图、消息列表、输入、会话历史/新对话/压缩入口）
│   ├── memory/memory.vue  # 记忆页（筛选/新建/编辑内容/优先级/级别/多选删除）
│   └── settings/settings.vue  # 设置页（接口/API预设/思考模式/请求次数/人格/聊天背景/上下文压缩/数据管理/调试日志）
├── utils/
│   ├── storage.js         # 跨端持久化层 + 设置项 + API预设 + 背景图 + 多会话模型 + 情景历史
│   ├── memory.js          # 记忆核心（MemoryStore 类 + 相似度算法）
│   ├── prompts.js         # 系统提示词构建 + 人格预设 + 接口预设
│   ├── llm.js             # OpenAI 兼容 LLM 客户端（uni.request + 调试日志埋点，stream:false + reasoning_effort 思考控制）
│   ├── log.js             # 调试日志（环形缓冲，供设置页调试面板）
│   ├── export.js          # 聊天记录导出（H5 下载 / App 写文档目录 / 小程序复制降级）
│   └── chat.js            # 聊天服务编排（导出 memoryStore 单例 + 会话管理 + 上下文压缩）
└── scripts/test-memory.mjs  # 核心逻辑断言测试
```

## 核心设计

### 记忆系统（utils/memory.js）

- **三级记忆**：`L1` 核心事实（永不衰减，仅 L1+importance=5 永久）/ `L2` 情景记忆（慢衰减）/ `L3` 临时信息（快衰减）
- **L2 职责 = 约定清单（TODO）**：提示词引导 LLM 将 L2 用作与用户的约定/待办维护，新约定立即新增、完成/取消/变化立即修改/删除；**L3 快速迭代**：近期琐事与临时状态，过时立即修改或删除旧项
- **importance 1-5**，半衰期表 `HALF_LIFE`（L1: 7~∞ / L2: 3~60 / L3: 1~3 天）
- **有效重要性** = 基础分 × 半衰期时间衰减 × 回忆强化因子（`effectiveImportance`）
- **LLM 驱动写入**：system prompt 内置 `MEMORY_GUIDE`（prompts.js），回复中的 `Memory:` 行经 `saveFromLine` 解析入库。支持三种操作：**新增**（类别 内容）/**修改**（修改 原内容 → 新内容）/**删除**（删除 原内容），修改/删除按内容逐字匹配。找不到匹配则静默忽略。解析逻辑抽为纯函数 `parseMemoryLine`（不写库），供格式校验复用
- **手动管理**：记忆页「新建」走 `addMemory(content, importance, level)`——直接追加一条不做相似度合并（区别于 LLM 写入的 `save`）；「多选删除」走 `deleteMemories(ids)` 批量删除
- **去重合并**：字符 bigram Jaccard(0.6) + LCS 序列相似度(0.4)，≥0.6 视为近似、≥0.85 触发召回冷却拦截
- **召回冷却**：记忆被召回后 300s 内禁止重复保存；复读视为强调 → importance +1（上限 5）
- **分层检索** `retrieveContext`：核心槽(30%) + 新鲜槽(20%) + MMR 多样性槽(50%)，λ=0.7
- **维护** `maintenance`：L3 过期清理(3天) / L2→L3 降级(有效重要性<2.2) / L3 高频访问升 L2(6h 内 6 次) / 容量淘汰(上限 200)
- **等级-优先级一致性**：L1 至少 3，L3 不超过 4，importance≤2 自动降 L3
- 关键常量均位于 `memory.js` 顶部

### 跨端持久化（utils/storage.js）

- **统一使用 `uni.setStorageSync` 同步存储**（App / H5 / 小程序均可用，重启不丢）
- 曾尝试 App 端 plus.sqlite（真 SQLite 文件），但其 `openDatabase`/`selectSql`/`executeSql` 均为**异步回调 API**，与同步接口不匹配，导致启动读不到数据且全量重写清空数据，故已移除 sqlite 分支（历史原因详见文件头注释）
- 对外暴露统一同步接口：`getMemories` / `replaceMemories` / `persistMemories` / `addChatRow` 等
- 设置项统一 `uni.setStorageSync`（key 前缀 `chabot_setting_`），写入带 try/catch 兜底
- 聊天背景图：App/小程序 `uni.saveFile` 持久化到文件；H5 用 **canvas 压缩**（限宽 1080px、JPEG 0.8）转 base64，避免 localStorage 配额超限
- **多会话模型**：对话存于 `chabot_conversations`（`[{id, title, created_at, updated_at, summary, compressedUntil, messages}]`）+ `chabot_active_conv`（当前会话 id）；`getChatRows()` 返回当前会话 messages 的**活引用**；旧版 `chabot_chat_history` 首次启动自动迁移为第一个会话，此后不再写入
- **情景历史**：情景（key `scene`）存为最多 10 条字符串数组（FIFO，`getSceneHistory()`），`getScene()` 返回最新一条；相同情景不重复记录，空值清除全部
- **API 配置预设**：`chabot_setting_api_profiles` 存至多 3 套 `{id,name,baseUrl,apiKey,model,temperature}`，`saveApiProfile(i,name,cfg)`（越界拒绝、覆盖保留 id）/ `deleteApiProfile(i)` / `getApiProfile(i)` 供设置页快速填充与切换

### 会话管理（utils/chat.js + storage.js）

- **开始新对话** `startNewConversation`：当前会话非空则归档新建，为空则重置复用
- **历史弹窗**（聊天页头部「历史」）：`listConversations` 按更新时间倒序返回标题/预览；`openConversation` 切换当前会话；`removeConversation` 删除（删除当前会话自动切到最近一个）
- **复制**：`copyConversationToNew` 复制当前会话（消息+记忆+概要+人格+情景，标题加"副本"）到新会话并切换；`copyMemoriesToNew` 仅复制记忆+人格快照
- **会话独立人格**：每个会话 `personality` 快照独立；`saveConversationPersonality(personalityId, customPrompt)` 写入当前会话快照（timeMode 沿用会话生效值），不影响全局与其他会话；未快照的会话回退全局人格（`getConversationSettings`）
- 会话标题自动取首条用户消息（≤16 字）；清空对话仅清当前会话，会话本身保留

### 聊天链路（utils/chat.js）

`sendMessage`：检索记忆 → 组装 system（人格+规则+记忆指南+情景指南+当前状态[时间/情景]+记忆上下文）→ 注入「未压缩历史（最近 15 条）」→ 调 LLM → **`parseAndValidateReply` 格式校验**（须含对话文本、Scene 行有内容、Memory 行可解析；检测非行首 `Scene:`/`Memory:` 标记（未独立成行）与"缺 `Memory:` 前缀却带 `| keywords:`/`| importance:`/`| level:` 结构"的伪 Memory 行；不合格自动重新请求，上限设置项 `maxRequestAttempts`，默认 5，达上限抛错）→ 校验通过才解析 `Scene:` 行更新情景、`Memory:` 行入库并得到清理后的回复文本 → 落库该清理文本（标记不混入历史，`getHistoryForUI` 展示层再兜底剔除行首标记，兼容旧数据）→ 执行维护 → 异步检查自动压缩（`maybeCompress`）。**压缩概要并入首条 system 末尾**，请求始终只含一条位于开头的 system——Ollama 等模板要求 system 必须在最前且只能一条，多条会抛 Jinja 错误

### 上下文压缩（utils/chat.js）

- **触发**：手动 `compressContext(true)`（聊天页历史弹窗「压缩上文为概要」）/ 自动 `maybeCompress`（每轮回复落库后异步检查，设置项 `compressInterval` 条数，0=关闭）
- **压缩范围**：上次进度 `compressedUntil` 之后、保留最近 10 条（`COMPRESS_KEEP_TAIL`）之前的消息；超过 80 条（`COMPRESS_CHUNK`）分批调用、逐批把旧概要并入新概要，避免单次请求过大
- **概要存储**：写入当前会话 `summary`/`compressedUntil`；后续请求注入 system 消息「此前对话概要：…」，原始消息仍完整保留可翻阅（仅发送层省略）
- 关键常量位于 `chat.js` 顶部

### 调试日志（utils/log.js）

- 环形缓冲 200 条（`MAX_LOGS`），单条详情上限 30000 字符（`MAX_DETAIL_CHARS`）防存储膨胀；`addLog(type, msg, detail)`，type：`req`/`res`/`err`/`info`
- **埋点**：`llm.js` 每次请求（完整 messages JSON）/响应（完整返回内容）/错误；`chat.js` 发送消息、记忆入库、情景更新、会话操作、压缩执行（详情附**完整压缩后上文**）；`settings.vue` 保存设置（不含 API Key）、保存/删除 API 预设
- **设置页调试面板**：类型徽章（请求蓝/响应绿/错误红/信息灰）+ 摘要 + 时间，点击条目展开完整详情（收起态 JS 截断前 200 字符预览，不用 CSS line-clamp，兼容性可靠）；支持刷新与一键清空

### 当前情景（Scene）

- LLM 每次回复输出 `Scene: 情景描述`（≤40字），结合注入的当前时间判断"用户此刻在做什么"
- 持久化于 storage（随会话独立的 `scenes` 数组，最多 10 条 FIFO 历史），聊天页顶部情景条展示，点击弹窗可查看/修改/清除
- 编辑弹窗内展示最近 10 条历史情景（最新在前），点击条目填入编辑框复用
- `buildSystemPrompt` 注入「用户当前情景」+「情景变化」序列，帮助 LLM 理解情景过渡、衔接更流畅
- 提示词见 `prompts.js` 的 `SCENE_GUIDE` 与 `buildNowText`
- **时间模式**（设置项 `timeMode`）：`real` 现实时间（默认）注入 `buildNowText()` 供情景判断；`virtual` 虚拟时间不发送真实时间，情景由 LLM 自由想象（适合角色扮演）

### 聊天页 UI

- 背景图固定于 scroll-view 可视区（cover 铺满，不随内容拉伸/滚动）
- 头部「人格名（点击设置）/ 历史 / 新对话 / 清空」：人格名点击弹出「当前对话人格」设置（预置 4 款 + 自定义提示词，保存写入会话快照）；历史弹窗切换/删除会话、压缩上文、**导出对话为 .txt**（`utils/export.js`：H5 Blob 下载带 BOM、App plus.io 写 `_doc` 并尝试系统打开、小程序复制全文降级）
- **一键回到底部**：右下角浮动按钮，仅当用户上翻离开底部时出现（`@scroll` 的 `scrollTop` 差值 + `@touchmove` 方向兜底，隐藏靠 `@scrolltolower`/发消息回底）；滚动采用「先清空再设置 `scrollInto`」以强制触发
- 侧边滑块：聊天记录 >15 条时出现，按住滑块按比例定位到对应消息（scroll-into-view 到 `msg-N` 锚点）
- 场景编辑弹窗与历史弹窗、记忆页共用 mask/panel 样式

## 开发约定

- **平台分支**：优先用条件编译注释 `// #ifdef APP-PLUS` / `// #ifdef H5`；不确定的平台 API 用运行时能力检测 `typeof uni.xxx === 'function'` 兜底（如 H5 无 `compressImage`）
- **H5 兼容**：所有存储/图片逻辑需在 H5 可用（storage.js 已内置降级，新增功能注意遵循）
- **UI 规范**：rpx 单位，主色 `#5b7cfa`，Options API，列表页复制数组（`slice()`）避免污染存储引用
- **记忆改动必测**：修改 memory.js / chat.js 后运行 `npm test`，并同步更新 `scripts/test-memory.mjs` 断言

## 已知平台差异

| 能力 | App | H5 | 微信小程序 |
|---|---|---|---|
| 数据持久化 | uni.setStorageSync | localStorage | wx.storage |
| 图片压缩 | uni.compressImage | canvas 压缩 | uni.compressImage |
| 图片持久化 | uni.saveFile | base64 | uni.saveFile |
| LLM 请求 | uni.request | uni.request | uni.request（需配置合法域名） |

## Ollama 本地模型接入

- **协议差异**：Ollama 的 `/v1/chat/completions` 兼容接口默认 `stream=true`（SSE 流式），OpenAI 官方默认非流式。客户端在 `llm.js` 请求体**显式传 `stream:false`** 强制非流式，按标准 JSON 解析（`choices[0].message.content`），无需实现流式解析；若个别服务仍返回流式，`_parseStreamingText` 兜底逐行合并增量内容
- **思考模式（Qwen3 等）**：Ollama 兼容接口对思考型模型未指定参数时**自动开启思考**，且思考+回答全部写入 `message.reasoning`/`thinking`、`content` 为空——这是"请求成功但无返回"的根因。控制方式：请求体顶层传 `reasoning_effort`（`none` 关闭 / `high`|`medium`|`low` 开启，原生 `think` 参数在该端点不生效）。本 App 三层保障：① 设置项 `reasoningEffort`（设置页「思考模式」，默认 `none`），`chat.js` 透传给 `chatCompletion`（压缩任务固定 `none`）；② 服务端不识别该参数返回 400 时自动移除参数降级重试一次；③ 解析兜底：`content` 为空时读取 `reasoning`/`thinking` 字段展示
- **局域网访问**：手机访问电脑上的 Ollama 需三件事——① 电脑设置环境变量 `OLLAMA_HOST=0.0.0.0` 后重启 Ollama；② Windows 防火墙放行 11434 端口；③ 设置页接口地址填 `http://<电脑局域网IP>:11434/v1`（设置页已有「Ollama(本地)」预设，点击后改 IP 即可）
- **模型名**：须与 `ollama list` 中的实际模型名一致（如 `llama3.2:latest`），填错会返回 404；API Key 可随意填（Ollama 不校验）
- **排查**：设置页调试日志中「响应格式异常」条目现在会附实际响应体全文，可据此确认返回的是 SSE 流式数据还是 model not found
