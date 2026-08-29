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
│   ├── chat/
│   │   ├── chat.vue          # 聊天页骨架（持有会话状态，子组件通过 props/$emit 协调）
│   │   └── components/       # 聊天页子组件：header / msg-list / input-bar / emoji-panel / scene-edit / history / persona
│   ├── memory/memory.vue  # 记忆页（筛选/新建/编辑内容/优先级/级别/多选删除）
│   ├── emoji/emoji.vue    # 表情管理页（批量上传逐张命名/改名/删除）
│   └── settings/settings.vue  # 设置页（接口/API预设/思考模式/请求次数/人格/聊天表情包/语音阅读/聊天背景/上下文压缩/数据管理/调试日志）
├── utils/
│   ├── storage.js         # 跨端持久化层 + 设置项 + API预设 + 背景图 + 多会话模型 + 情景历史
│   ├── memory.js          # 记忆核心（MemoryStore 类 + 相似度算法）
│   ├── prompts.js         # 系统提示词构建 + 人格预设 + 表情包引导 + 自定义示例 + 接口预设
│   ├── emojis.js          # 表情包数据层（全局列表、名称校验、跨端图片持久化、$名$ 解析、拖拽重排）
│   ├── llm.js             # OpenAI 兼容 LLM 客户端（uni.request + 调试日志埋点，stream:false + reasoning_effort 思考控制）
│   ├── tts.js             # TTS 语音阅读（Qwen-TTS 合成 + 播放 + 接口测试，表情不朗读/不落盘）
│   ├── log.js             # 调试日志（环形缓冲，供设置页调试面板）
│   ├── notify.js          # 系统通知层（拟真主动消息后台弹通知：App 本地通知/H5 浏览器通知，仅后台弹）
│   ├── export.js          # 聊天记录导出（H5 下载 / App 写文档目录 / 小程序复制降级）
│   ├── chat.js            # 聊天服务门面 + 发送主链路（统一对外导出，各调用方/测试入口不变）
│   ├── chat-state.js      # 聊天服务共享状态（memoryStore 单例 + 最近请求缓存，消除跨模块循环依赖）
│   ├── chat-settings.js   # 聊天服务设置域（全局默认 + 会话设置快照 + 会话人格保存）
│   ├── chat-conversations.js # 聊天服务会话域（新建/切换/删除/复制 + 历史展示/清空）
│   ├── chat-compress.js   # 聊天服务压缩域（上下文压缩）
│   └── chat-proactive.js  # 聊天服务拟真聊天域（前台调度器 + 回前台补发 + 主动消息发送）
└── scripts/
    ├── test-memory.mjs    # 记忆核心逻辑断言测试
    └── test-emojis.mjs    # 表情包逻辑断言测试
```

## 核心设计

### 记忆系统（utils/memory.js）

- **三级记忆**：`L1` 核心事实（永不衰减，仅 L1+importance=5 永久）/ `L2` 情景记忆（慢衰减）/ `L3` 临时信息（快衰减）
- **L2 职责 = 约定清单（TODO）**：提示词引导 LLM 将 L2 用作与用户的约定/待办维护，新约定立即新增、完成/取消/变化立即修改/删除；**L3 快速迭代**：近期琐事与临时状态，过时立即修改或删除旧项
- **importance 1-5**，半衰期表 `HALF_LIFE`（L1: 7~∞ / L2: 3~60 / L3: 1~3 天）
- **有效重要性** = 基础分 × 半衰期时间衰减 × 回忆强化因子（`effectiveImportance`）
- **时间衰减模式**：`real` 模式按现实时间半衰期衰减（默认）；`virtual` 模式按「剧情当前时刻」相对衰减——基准 = 全部记忆 `last_accessed_at || created_at` 的最大值（即最新或最近被使用的记忆），现实中断不衰减，剧情推进（新记忆/新召回）后才让旧记忆相对变旧；新鲜槽、L3 升级窗口、L3 过期清理在 virtual 模式下同样以剧情时刻为基准
- **LLM 驱动写入**：system prompt 内置 `MEMORY_GUIDE`（prompts.js），回复中的 `Memory:` 行经 `saveFromLine` 解析入库。支持三种操作：**新增**（类别 内容）/**修改**（修改 原内容 → 新内容）/**删除**（删除 原内容），修改/删除按内容逐字匹配。找不到匹配则静默忽略。解析逻辑抽为纯函数 `parseMemoryLine`（不写库），供格式校验复用
- **手动管理**：记忆页「新建」走 `addMemory(content, importance, level)`——直接追加一条不做相似度合并（区别于 LLM 写入的 `save`）；「多选删除」走 `deleteMemories(ids)` 批量删除
- **去重合并**：字符 bigram Jaccard(0.6) + LCS 序列相似度(0.4)，≥0.6 视为近似、≥0.85 触发召回冷却拦截
- **召回冷却**：记忆被召回后 300s 内禁止重复保存；复读视为强调 → importance +1（上限 5）
- **分层检索** `retrieveContext`：**全量召回所有 L1 核心事实**（`L1_MAX_COUNT=20` 上限，超出时自动将重要性最低的 L1 降级为 L2，i5 不豁免总量；降级按 importance 升序、同分按创建时间旧优先）+ 新鲜槽 + MMR 多样性槽，总配额 `RECALL_COUNT=30`，λ=0.7；L1 满员时 system 注入 `[记忆容量]` 段（`buildSystemPrompt` 的 `l1Usage` 参数）引导 LLM 先逐字修改/删除旧 L1 再新增
- **维护** `maintenance`：L3 过期清理(3天) / L2→L3 降级(有效重要性<2.2) / L3 高频访问升 L2(6h 内 6 次) / 容量淘汰(上限 200)
- **等级-优先级一致性**：L1 至少 3，L3 不超过 4，importance≤2 自动降 L3
- 关键常量均位于 `memory.js` 顶部

### 跨端持久化（utils/storage.js）

- **统一使用 `uni.setStorageSync` 同步存储**（App / H5 / 小程序均可用，重启不丢）
- 曾尝试 App 端 plus.sqlite（真 SQLite 文件），但其 `openDatabase`/`selectSql`/`executeSql` 均为**异步回调 API**，与同步接口不匹配，导致启动读不到数据且全量重写清空数据，故已移除 sqlite 分支（历史原因详见文件头注释）
- 对外暴露统一同步接口：`getMemories` / `replaceMemories` / `persistMemories` / `addChatRow` 等
- 设置项统一 `uni.setStorageSync`（key 前缀 `chabot_setting_`），写入带 try/catch 兜底
- 聊天背景图：App/小程序 `uni.saveFile` 持久化到文件；H5 用 **canvas 压缩**（限宽 1080px、JPEG 0.8）转 base64，避免 localStorage 配额超限
- **多会话模型**：对话存于 `chabot_conversations`（`[{id, title, created_at, updated_at, summary, compressedUntil, settings, scenes, memories, messages}]`）+ `chabot_active_conv`（当前会话 id）；`getChatRows()` 返回当前会话 messages 的**活引用**；旧版 `chabot_chat_history` 首次启动自动迁移为第一个会话，此后不再写入
- **会话独立设置**：每个会话 `settings` 快照保存**完整设置**（API 配置/人格/情景时间/压缩间隔等），无快照回退全局设置（旧数据仅有人格子集 `personality` 的会话兼容回退）；`getConversationSettingsRaw`/`setConversationSettingsRaw` 读写快照，`getConversationPersonality` 取其人格子集供记忆系统判定时间模式
- **情景历史**：情景（key `scene`）存为最多 10 条字符串数组（FIFO，`getSceneHistory()`），`getScene()` 返回最新一条；相同情景不重复记录，空值清除全部
- **API 配置预设**：`chabot_setting_api_profiles` 存至多 3 套 `{id,name,baseUrl,apiKey,model,temperature}`，`saveApiProfile(i,name,cfg)`（越界拒绝、覆盖保留 id）/ `deleteApiProfile(i)` / `getApiProfile(i)` 供设置页快速填充与切换

### 会话管理（utils/chat-conversations.js + storage.js）

- **开始新对话** `startNewConversation`：当前会话非空则归档新建，为空则重置复用；**新对话复制当前会话的完整设置**（`saveSettings`/设置面板/新建对话统一走 `setConversationSettingsRaw`）
- **历史弹窗**（聊天页头部「历史」）：`listConversations` 按更新时间倒序返回标题/预览；`openConversation` 切换当前会话（设置随之切换）；`removeConversation` 删除（删除当前会话自动切到最近一个）
- **复制**：`copyConversationToNew` 复制当前会话（消息+记忆+概要+设置+情景，标题加"副本"）到新会话并切换；`copyMemoriesToNew` 仅复制记忆+设置快照
- **会话独立设置**：每个会话一份完整设置快照；`saveSettings(s)` 写入当前会话（设置面板与之同步，切换会话即切换设置）；`saveConversationPersonality(personalityId, customPrompt, timeMode?)` 只改人格三字段、其余沿用会话生效值，不影响其他会话；无快照会话回退全局设置（`getConversationSettings`）
- 会话标题自动取首条用户消息（≤16 字）；清空对话仅清当前会话，会话本身保留

### 聊天链路（utils/chat.js）

`sendMessage`：检索记忆 → 组装 system（人格+规则+记忆指南+情景指南+当前状态[时间/情景]+记忆上下文+L1 容量状态[`[记忆容量]` 段，见 `buildSystemPrompt` 的 `l1Usage` 参数]+表情包清单[`emojiEnabled` 开启且有表情时，见 `EMOJI_GUIDE`]）→ 注入「未压缩历史（最近 15 条）」→ 调 LLM → **`parseAndValidateReply` 格式校验**（须含对话文本、Scene 行有内容、Memory 行可解析；检测非行首 `Scene:`/`Memory:` 标记（未独立成行）与"缺 `Memory:` 前缀却带 `| keywords:`/`| importance:`/`| level:` 结构"的伪 Memory 行；回复中的 `$表情名$` 必须在表情清单内，否则判定格式不合格；不合格自动重新请求，上限设置项 `maxRequestAttempts`，默认 5，达上限抛错）→ 校验通过才解析 `Scene:` 行更新情景、`Memory:` 行入库并得到清理后的回复文本 → 落库该清理文本（标记不混入历史，`getHistoryForUI` 展示层再兜底剔除行首标记，兼容旧数据）→ 执行维护 → 异步检查自动压缩（`maybeCompress`）。**压缩概要并入首条 system 末尾**，请求始终只含一条位于开头的 system——Ollama 等模板要求 system 必须在最前且只能一条，多条会抛 Jinja 错误

### 上下文压缩（utils/chat.js）

- **触发**：手动 `compressContext(true)`（聊天页历史弹窗「压缩上文为概要」）/ 自动 `maybeCompress`（每轮回复落库后异步检查，设置项 `compressInterval` 条数，0=关闭）
- **压缩范围**：上次进度 `compressedUntil` 之后、保留最近 10 条（`COMPRESS_KEEP_TAIL`）之前的消息；超过 80 条（`COMPRESS_CHUNK`）分批调用、逐批把旧概要并入新概要，避免单次请求过大
- **概要存储**：写入当前会话 `summary`/`compressedUntil`；后续请求注入 system 消息「此前对话概要：…」，原始消息仍完整保留可翻阅（仅发送层省略）
- 关键常量位于 `chat-compress.js` 顶部

### 调试日志（utils/log.js）

- 环形缓冲 200 条（`MAX_LOGS`），单条详情上限 30000 字符（`MAX_DETAIL_CHARS`）防存储膨胀；`addLog(type, msg, detail)`，type：`req`/`res`/`err`/`info`
- **埋点**：`llm.js` 每次请求（完整 messages JSON）/响应（完整返回内容）/错误；`chat.js` 发送消息、记忆入库、情景更新、会话操作（会话域在 `chat-conversations.js`）；`chat-compress.js` 压缩执行（详情附**完整压缩后上文**）；`settings.vue` 保存设置（不含 API Key）、保存/删除 API 预设；`tts.js` TTS 合成/播放/接口测试
- **设置页调试面板**：类型徽章（请求蓝/响应绿/错误红/信息灰）+ 摘要 + 时间，点击条目展开完整详情（收起态 JS 截断前 200 字符预览，不用 CSS line-clamp，兼容性可靠）；支持刷新与一键清空

### 当前情景（Scene）

- LLM 每次回复输出 `Scene: 情景描述`（≤40字），结合注入的当前时间判断"用户此刻在做什么"
- 持久化于 storage（随会话独立的 `scenes` 数组，最多 10 条 FIFO 历史），聊天页顶部情景条展示，点击弹窗可查看/修改/清除
- 编辑弹窗内展示最近 10 条历史情景（最新在前），点击条目填入编辑框复用
- `buildSystemPrompt` 注入「用户当前情景」+「情景变化」序列，帮助 LLM 理解情景过渡、衔接更流畅
- 提示词见 `prompts.js` 的 `SCENE_GUIDE` 与 `buildNowText`
- **时间模式**（设置项 `timeMode`）：`real` 现实时间（默认）注入 `buildNowText()` 供情景判断；`virtual` 虚拟时间不发送真实时间，情景由 LLM 自由想象（适合角色扮演）

### 拟真聊天（utils/chat-proactive.js + prompts.js + chat.js）

- **定位**：模拟真人发消息——AI 在随机时间节点主动给用户发消息，每条 ≤1 句、连续表情 ≤2；仅当前会话 `proactiveEnabled=true` 且 `timeMode=real`（现实时间）时生效
- **设置项**（随会话快照）：`proactiveEnabled`（默认关）/ `proactiveStartMin`/`proactiveEndMin`（时段窗口，分钟级，当天第几分钟 0-1439，默认 09:00 起-23:59 止）/ `proactiveLevel`（频率档位 `low` 45~120min / `medium` 15~45min / `high` 5~15min）/ `proactiveCustomSeconds`（调试用自定义倒计时秒数，>0 时固定按该秒数重排并覆盖档位，下限 10s 防误触 API，清 0 恢复档位）
- **调度（低后台占用）**：单条链式 `setTimeout`（非轮询，空闲零唤醒），`_dueAt` 记录下次触发时刻；**退后台不清定时器**——单条 pending timeout 后台零 CPU，H5 隐藏标签页被浏览器节流后仍会触发，App 后台 JS 挂起不触发时由回前台 `catchUpProactive()` 检测到期补发；App/聊天页 `onShow`、切换会话、保存设置后调用 `catchUpProactive()` 让调度立即按最新会话设置重排；**改设置/切会话用 `rearmProactive()` 强制重算**（`catchUp` 在定时器已挂载时跳过重排以保持跨页倒计时不重置，故"修改倒计时值立即生效"须走 `rearmProactive`——设置页保存/调试按钮、聊天页新对话/切换会话均用后者）；**重排只看功能开关（`_featureOn`：开关+现实时间+API 配置），与 loading 抑制解耦**——抑制只拦截到期发送、不拦截重排，任何时序下调度器都不会失效（曾因抑制期间到期不重排导致"等待调度"、只能重启恢复）；`catchUpProactive` 补发时先清旧定时器（`_tick` 也以 `_dueAt` 非空为触发前提）防重复发送；`_nextDelay` 恒 ≥60s（时段外等窗口起点，含"当前分钟正好=起点"边界）防 0 延迟忙循环；`getProactiveCountdown()` 返回下次触发倒计时（毫秒，未调度返回 null）供设置页实时显示；每次重排写一条 `拟真聊天调度` info 日志（含倒计时与档位）
- **触发门禁**（`sendProactiveBurst`，非调试）：开关 + 现实时间 + 未抑制（聊天页 loading 时 `setProactiveSuppressed(true)` 抑制）+ 时段窗口内 + 会话已有用户消息
- **发送链路**：组装 system（`buildSystemPrompt` 传 `proactive=true` 注入 `PROACTIVE_GUIDE`）+ 最近 15 条历史 + 末尾追加**内部指令行**（仅请求不落库，让模型以"主动开口"方式输出）→ `chatCompletion` → `parseAndValidateReply(text, {proactive:true})` 校验（每条 ≤1 句、连续表情 ≤2，不合格自动重试 `maxRequestAttempts`）→ 按换行拆多条 `addChatRow('assistant', ...)` 落库（rollback 挂最后一行）→ Scene/Memory 由校验写入 → `maybeCompress` + 维护 → `uni.$emit('proactive-burst')` 通知聊天页刷新
- **格式约束范围**：开启后**该对话所有回复**（含普通回复）均受"每条 ≤1 句、连续表情 ≤2"约束（决策点 1）；`countSentences` 按句末标点 `。！？!?…` 计句、连续标点合并（如"哈哈。。"=1）；`sendMessage` 对拟真会话按换行拆多条气泡落库并返回 `burst` 数组供聊天页逐条展示
- **调试按钮**：设置页「立即发送一条主动消息」→ `debugProactiveMessage()`（`force` 忽略开关/时段/抑制门禁，仅校验 API 配置），结果写入调试日志
- **后台通知（可选，`notify.js`）**：开启拟真时在设置页保存会自动申请系统通知权限（App Android 13+ `POST_NOTIFICATIONS`、H5 `Notification.requestPermission`）；收到主动消息落库后调用 `notifyProactive(text)`，**仅在应用处于后台时**弹系统通知（App `plus.push.createMessage` 本地通知 / H5 浏览器 `Notification`），前台用户在聊天页不打扰；小程序无任意系统通知能力静默跳过。前台/后台状态由 `App.vue` `onShow/onHide` 用 `setForeground` 同步（通知层在 Node/无平台 API 环境安全降级不抛错）。**注意平台限制**：App 真后台 JS 挂起、主动消息只在回前台补发时才发，故 App 端后台弹通知当前基本不触发；H5 后台（节流定时器仍触发）可正常弹通知
- **重新生成兼容**：`popLastAssistant` 移除用户消息后**连续 assistant 行**（burst 一并移除，rollback 取最后一行），兼容单行与旧数据

### 表情包系统（utils/emojis.js + 聊天页）

- **存储**：`chabot_emojis` 全局数组 `{id, name, src, created_at}`，**不随会话切换**；数量上限 `EMOJI_MAX_COUNT=50`
- **表情名**：上传时必填、≤20 字、全局唯一、不含 `$`/换行（`validateEmojiName` 统一校验）；消息中用 `$表情名$` 占位引用
- **图片持久化**：App/小程序上传时先 `uni.compressImage` 压缩（`compressedWidth: 300`，quality 80）再 `uni.saveFile`，避免原图过大拖慢消息列表渲染（compressImage 输出为 jpg，PNG 透明底会变白，属可接受权衡）；H5 canvas 压缩为小尺寸 PNG base64（限宽 300px、单图 ≤300KB）防 localStorage 配额打满（`_h5EmojiToBase64`）
- **解析与校验**：`splitEmojiText(content, map)` 纯函数把消息拆为文本段/表情段——**跳过表情包前后的空格/换行等纯空白段并裁剪文本段首尾空白**，避免模型在表情间插入空白时渲染出空消息气泡；清单外的未知 `$名$` 原样保留为文本；`extractEmojiNames` 提取占位名供 LLM 回复校验
- **管理**：`pages/emoji/emoji.vue`——批量上传（`uni.chooseImage count:9`，选图后**逐张命名**，弹窗显示进度与预览）、改名、删除（顺带清理已存图片文件）；`reorderEmojis(orderedIds)` 拖拽重排（未知 id 忽略、遗漏项自动补位）
- **聊天页交互**：输入框右侧「表情」按钮展开表情栏（常驻渲染 + `max-height`/`opacity` 过渡动画）；**短按**点击插入 `$表情名$`、**滑动**滚动面板、**长按 2 秒**进入拖动排序（被拖项 `scale(1.1)` 放大 `fixed` 跟随手指，`touchmove` 按格子位置实时重排——`splice` 移除后插入实现"其后顺延一位"，松手 `reorderEmojis` 持久化，拖拽结束抑制一次 tap 防误发送）；点击消息区 / 唤起键盘自动收起表情栏
- **键盘适配**：App 端聊天页 `pages.json` 配置 `softinputMode: adjustResize`（键盘弹出压缩视口）；表情栏打开时唤起键盘，先不关闭表情栏、等 `uni.onKeyboardHeightChange` 上报键盘高度（视口已压缩）后再关闭，输入栏直接从"表情栏上方"落到"键盘上方"；表情栏/键盘升起后消息列表滚动对齐底部（H5 靠 `window.resize`）
- **LLM 互动**：`sendMessage` 把表情清单注入 system（`prompts.js` 的 `EMOJI_GUIDE`，无表情/`emojiEnabled=false` 时不注入）；`parseAndValidateReply` 校验回复中 `$名$` 必须存在于清单，否则判定格式不合格自动重试
- **设置项**：`emojiEnabled`（settings.vue「聊天表情包」，随会话快照存储，默认开启），关闭后请求不携带清单，LLM 不会主动使用表情（手动插入与渲染不受影响）

### 语音阅读 TTS（utils/tts.js + 聊天页/设置页）

- **接口**：默认对接 **Qwen-TTS 非实时语音合成**——`POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`，请求体 `{ model, input: { text, voice } }`（model 默认 `qwen3-tts-flash`，voice 默认 `Cherry`），非流式响应取 `output.audio.url`（音频直链，有效期 24h）
- **设置项**（随会话快照存储，同其余设置）：`ttsEnabled`（默认关）/ `ttsApiKey` / `ttsModel` / `ttsVoice`；设置页「语音阅读」区块可开关、填 Key、改模型，音色支持从内置清单选择（`TTS_VOICES`，35 个 Qwen 官方常用音色含方言，未收录的自定义音色可手动输入）或手动输入
- **触发**：聊天页 `send`/`doRegenerate` 的 LLM 回复落库渲染后调用 `speakText(reply, ...)`——**只朗读新返回的助手消息**；`⚠️` 开头的错误提示不朗读；未开启或未填 Key 直接跳过；发送新消息/重新生成/清空/切换会话/页面卸载时 `stopSpeaking()` 打断
- **表情不朗读**：`textForSpeech` 复用 `splitEmojiText(content, getEmojiMap())` 只保留文本段拼接，`$表情名$` 占位不朗读（清单外未知 `$名$` 与渲染一致保留为文本）；文本截断到 `TTS_MAX_CHARS=500` 防超接口上限
- **不落盘**：拿到 URL 后由 `InnerAudioContext` 直接播远程音频，**不下载/不落文件**；`_play` 注册 `onEnded`/`onStop`/`onError`，播放完（或出错）即 `destroy()` 销毁播放器；模块级 `_ctx` 保证**同一时刻只播一条**（新播放前 `_stopCtx`）
- **并发/竞态**：模块级 `_seq` 序号——`speakText` 先 `stopSpeaking()` 作废旧的在途合成请求再领取新序号，合成响应返回时若 `seq !== _seq`（期间用户又发消息/停止/切页）则放弃创建播放器
- **App 播放适配**：App 原生播放器在 `src` 刚设置时资源未就绪，立即 `play()` 可能被静默忽略（无报错、不触发 `onError`）——App 端（`#ifdef APP-PLUS`）改为**等 `onCanplay` 就绪后再 play**，并 1s 兜底再 play 一次（play 幂等，重复调用无害）；H5/微信小程序仍为设置 src 后立即 play。同一时刻只保留一个播放器（`_ctx`），播放完/出错即 `destroy()`，不落盘。`onError` 尽力解析 MediaError 的 `code`/`errorCode`/`message` 及原始结构（**App 端 uni 不暴露 code，仅回传 errMsg='MediaError'**）；首次播放失败时 `speakText`/`testTts` 会**重新合成一次拿新 URL 自动重试**（兜住瞬时网络/解码问题）
- **接口测试**：设置页「测试语音接口」按钮调用 `testTts({apiKey, model, voice})`，以当前配置发送固定短文本 `TTS_TEST_TEXT` 并尝试播放，返回 `{ok, message}`；测试全程写日志（`TTS 接口测试` info / `TTS 合成失败`·`TTS 网络错误`·`TTS 播放失败` err / `TTS 接口测试成功` res），设置页测试后自动刷新调试日志面板
- **平台坑**：`InnerAudioContext.obeyMuteSwitch` 仅微信小程序可写，**App/H5 端是只读 getter**（赋值即抛错并中断后续 `src`/`play()`，曾导致 App 无声）——赋值必须包 try/catch；微信小程序开启语音阅读需把 TTS 接口域名加入 request 合法域名

### 聊天页 UI

- **组件化**：聊天页拆为页面骨架 + 7 个子组件（`pages/chat/components/`）——header（头部+情景条）/ msg-list（消息列表+侧边滑块+回到底部）/ input-bar / emoji-panel（表情栏+拖拽+上传弹窗）/ scene-edit / history / persona。页面持有会话状态（messages/scene/loading/input 等），子组件通过 props 下发 + `$emit` 上报，`msg-list` 的滚动/滑块内部自治并经 `ref` 暴露 `scrollBottom()`/`resetScrollState()`
- **消息列表渲染性能**（表情多时 App 启动/滚动卡顿的针对性优化）：`msg-list` 启动时仅渲染最近 `visibleCount=150` 条（`visibleMessages` 窗口，新消息自动落在窗内）；上翻到顶部且还有更早消息时出现「加载更早消息」按钮，点击每次再加载 150 条（不做自动加载）；`v-for` 行使用**稳定 key**（`msgId + 段序号`），新增消息时上方已有行精确复用、不重复 patch，避免大量历史表情图被成批重渲染
- 背景图固定于 scroll-view 可视区（cover 铺满，不随内容拉伸/滚动）
- 头部「人格名（点击设置）/ 历史 / 新对话 / 清空」：人格名点击弹出「当前对话人格」设置（预置 4 款 + 自定义提示词，保存写入会话快照）；历史弹窗切换/删除会话、压缩上文、**导出对话为 .txt**（`utils/export.js`：H5 Blob 下载带 BOM、App plus.io 写 `_doc` 并尝试系统打开、小程序复制全文降级）
- **一键回到底部**：右下角浮动按钮，仅当用户上翻离开底部时出现（`@scroll` 的 `scrollTop` 差值 + `@touchmove` 方向兜底，隐藏靠 `@scrolltolower`/发消息回底）；滚动采用「先清空再设置 `scrollInto`」以强制触发
- 侧边滑块：聊天记录 >15 条时出现，按住滑块按比例定位到对应消息（scroll-into-view 到 `msg-N` 锚点）
- 场景编辑弹窗与历史弹窗、记忆页共用 mask/panel 样式（各弹窗组件内各自携带 scoped 副本）

## 开发约定

- **平台分支**：优先用条件编译注释 `// #ifdef APP-PLUS` / `// #ifdef H5`；不确定的平台 API 用运行时能力检测 `typeof uni.xxx === 'function'` 兜底（如 H5 无 `compressImage`）
- **H5 兼容**：所有存储/图片逻辑需在 H5 可用（storage.js 已内置降级，新增功能注意遵循）
- **UI 规范**：rpx 单位，主色 `#5b7cfa`，Options API，列表页复制数组（`slice()`）避免污染存储引用
- **记忆改动必测**：修改 memory.js / chat.js 后运行 `npm test`，并同步更新 `scripts/test-memory.mjs` 断言
- **表情改动必测**：修改 emojis.js 后运行 `npm test`，并同步更新 `scripts/test-emojis.mjs` 断言（名称校验/CRUD/解析拆分/占位提取/重排）

## 已知平台差异

| 能力 | App | H5 | 微信小程序 |
|---|---|---|---|
| 数据持久化 | uni.setStorageSync | localStorage | wx.storage |
| 图片压缩 | uni.compressImage | canvas 压缩 | uni.compressImage |
| 图片持久化 | uni.saveFile | base64 | uni.saveFile |
| LLM 请求 | uni.request | uni.request | uni.request（需配置合法域名） |
| TTS 播放 | InnerAudioContext | InnerAudioContext | InnerAudioContext（obeyMuteSwitch 可写；需配置合法域名） |

## Ollama 本地模型接入

- **协议差异**：Ollama 的 `/v1/chat/completions` 兼容接口默认 `stream=true`（SSE 流式），OpenAI 官方默认非流式。客户端在 `llm.js` 请求体**显式传 `stream:false`** 强制非流式，按标准 JSON 解析（`choices[0].message.content`），无需实现流式解析；若个别服务仍返回流式，`_parseStreamingText` 兜底逐行合并增量内容
- **思考模式（Qwen3 等）**：Ollama 兼容接口对思考型模型未指定参数时**自动开启思考**，且思考+回答全部写入 `message.reasoning`/`thinking`、`content` 为空——这是"请求成功但无返回"的根因。控制方式：请求体顶层传 `reasoning_effort`（`none` 关闭 / `high`|`medium`|`low` 开启，原生 `think` 参数在该端点不生效）。本 App 三层保障：① 设置项 `reasoningEffort`（设置页「思考模式」，默认 `none`），`chat.js` 透传给 `chatCompletion`（压缩任务固定 `none`）；② 服务端不识别该参数返回 400 时自动移除参数降级重试一次；③ 解析兜底：`content` 为空时读取 `reasoning`/`thinking` 字段展示
- **局域网访问**：手机访问电脑上的 Ollama 需三件事——① 电脑设置环境变量 `OLLAMA_HOST=0.0.0.0` 后重启 Ollama；② Windows 防火墙放行 11434 端口；③ 设置页接口地址填 `http://<电脑局域网IP>:11434/v1`（设置页已有「Ollama(本地)」预设，点击后改 IP 即可）
- **模型名**：须与 `ollama list` 中的实际模型名一致（如 `llama3.3`），填错会返回 404；API Key 可随意填（Ollama 不校验）
- **排查**：设置页调试日志中「响应格式异常」条目现在会附实际响应体全文，可据此确认返回的是 SSE 流式数据还是 model not found
