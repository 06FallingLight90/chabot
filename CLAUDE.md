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
│   ├── chat/chat.vue      # 聊天页（背景图、消息列表、输入）
│   ├── memory/memory.vue  # 记忆页（筛选/编辑内容/优先级/级别/删除）
│   └── settings/settings.vue  # 设置页（接口/人格/聊天背景/数据管理）
├── utils/
│   ├── storage.js         # 跨端持久化层 + 设置项 + 背景图
│   ├── memory.js          # 记忆核心（MemoryStore 类 + 相似度算法）
│   ├── prompts.js         # 系统提示词构建 + 人格预设 + 接口预设
│   ├── llm.js             # OpenAI 兼容 LLM 客户端（uni.request）
│   └── chat.js            # 聊天服务编排（导出 memoryStore 单例）
└── scripts/test-memory.mjs  # 核心逻辑断言测试
```

## 核心设计

### 记忆系统（utils/memory.js）

- **三级记忆**：`L1` 核心事实（永不衰减，仅 L1+importance=5 永久）/ `L2` 情景记忆（慢衰减）/ `L3` 临时信息（快衰减）
- **importance 1-5**，半衰期表 `HALF_LIFE`（L1: 7~∞ / L2: 3~60 / L3: 1~3 天）
- **有效重要性** = 基础分 × 半衰期时间衰减 × 回忆强化因子（`effectiveImportance`）
- **LLM 驱动写入**：system prompt 内置 `MEMORY_GUIDE`（prompts.js），回复中的 `Memory:` 行经 `saveFromLine` 解析入库。支持三种操作：**新增**（类别 内容）/**修改**（修改 原内容 → 新内容）/**删除**（删除 原内容），修改/删除按内容逐字匹配。找不到匹配则静默忽略。
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

### 聊天链路（utils/chat.js）

`sendMessage`：检索记忆 → 组装 system（人格+规则+记忆指南+情景指南+当前状态[时间/情景]+记忆上下文）→ 注入最近 15 条历史 → 调 LLM → 落库对话 → 解析 `Scene:` 行更新当前情景、`Memory:` 行入库，均从展示文本剔除 → 执行维护

### 当前情景（Scene）

- LLM 每次回复输出 `Scene: 情景描述`（≤40字），结合注入的当前时间判断"用户此刻在做什么"
- 持久化于 storage（key `scene`），聊天页顶部情景条展示，点击弹窗可查看/修改/清除
- 提示词见 `prompts.js` 的 `SCENE_GUIDE` 与 `buildNowText`
- **时间模式**（设置项 `timeMode`）：`real` 现实时间（默认）注入 `buildNowText()` 供情景判断；`virtual` 虚拟时间不发送真实时间，情景由 LLM 自由想象（适合角色扮演）

### 聊天页 UI

- 背景图固定于 scroll-view 可视区（cover 铺满，不随内容拉伸/滚动）
- 侧边滑块：聊天记录 >15 条时出现，按住滑块按比例定位到对应消息（scroll-into-view 到 `msg-N` 锚点）
- 场景编辑弹窗与记忆页共用 mask/panel 样式

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
