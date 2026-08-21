# AI 伙伴

一个基于 **uni-app (Vue 3)** 的轻量 LLM 人格聊天 App。**无后端、纯端侧**，调用任意 **OpenAI 兼容**的 `/chat/completions` 接口（支持 Ollama 本地模型），跨 **App / H5 / 微信小程序** 三端。

## ✨ 功能特性

- **人格聊天**：4 款预置人格（温柔大姐姐 / 元气学妹 / 古明地恋 / 毒舌傲娇猫娘）+ 自定义人格提示词；**每个对话独立设置人格**，切换对话即切换人格
- **记忆系统**：L1 核心事实 / L2 情景记忆（约定 TODO 清单）/ L3 临时记忆 三级；LLM 在回复中输出 `Memory:` 行自动写入，支持**新增 / 修改 / 删除**，按重要性分级、半衰期衰减、自动召回与维护
- **情景记录**：LLM 每次回复维护当前情景（Scene），支持**现实时间 / 虚拟时间**模式，情景历史可查看修改
- **上下文压缩**：将上文交由 LLM 压缩为精炼概要，后续请求只发送「概要 + 未压缩尾部」，显著减少 token 消耗；可自动（按条数间隔）或手动触发
- **多会话历史**：独立存储记忆 / 人格 / 情景 / 概要，支持新建、切换、删除、**复制对话或记忆到新会话**
- **调试日志**：记录每次 LLM 请求（完整 JSON）、响应、错误与关键操作，可展开查看全文、一键清空
- **API 配置**：至多 **3 套 API 预设**快速切换；「思考模式」开关解决 Ollama Qwen3 等思考模型"回复为空"问题（`reasoning_effort`）
- **记忆管理**：筛选 / 新建 / 编辑内容、优先级、级别 / **多选批量删除**
- **导出聊天记录**：一键导出当前对话为 `.txt`（H5 下载、App 写入文档目录、小程序复制到剪贴板）
- **聊天体验**：聊天背景图、一键回到底部、侧边滑块快速翻阅、AI 回复可重新生成

## 🛠 技术栈

- uni-app + Vue 3（Options API），rpx 响应式单位
- 无第三方 npm 依赖；`package.json` 仅用于 `npm test`（Node 环境 mock `uni` 验证核心逻辑）
- 数据统一使用 `uni.setStorageSync` 同步存储，跨端可靠、重启不丢

## 🚀 快速开始

1. 安装 [HBuilderX](https://www.dcloud.io/hbuilderx.html)（建议使用最新正式版）
2. 导入本工程：文件 → 导入 → 从本地目录导入
3. 运行：选择目标平台（浏览器 / Android / iOS 模拟器或真机 / 微信开发者工具）
4. 打开 **设置** 页，填写接口配置：
   - **接口地址**：如 `https://api.openai.com/v1`（兼容 OpenAI 协议的服务均可，如 DeepSeek、智谱 GLM、通义千问、Kimi 等）
   - **API Key**、**模型**、**温度**
   - 可点击供应商快捷填入，或保存为 **API 预设**（至多 3 套）一键切换

### Ollama 本地模型接入

1. 电脑端启动 Ollama 并设置 `OLLAMA_HOST=0.0.0.0`（监听局域网），防火墙放行 `11434` 端口
2. 设置页选择「Ollama(本地)」预设，把接口地址改为 `http://<电脑局域网IP>:11434/v1`
3. 模型名填 `ollama list` 中的实际名称；API Key 可随意填
4. 若模型带思考模式（如 Qwen3），将 **思考模式** 设为「关闭」，避免思考占满输出 token 导致回复为空

详细说明见 [CLAUDE.md](CLAUDE.md)。

## 📁 目录结构

```
├── App.vue                # 启动时初始化存储 + 记忆维护
├── pages.json             # 页面注册 + tabBar（聊天 / 记忆 / 设置）
├── pages/
│   ├── chat/
│   │   ├── chat.vue          # 聊天页骨架（持有会话状态，子组件协调）
│   │   └── components/       # header / msg-list / input-bar / emoji-panel / scene-edit / history / persona
│   ├── memory/memory.vue  # 记忆页（筛选 / 新建 / 编辑 / 多选删除）
│   └── settings/settings.vue  # 设置页（接口 / API预设 / 思考模式 / 人格 / 背景 / 调试日志）
├── utils/
│   ├── storage.js         # 跨端持久化层（多会话模型 / 情景 / API 预设 / 背景图）
│   ├── memory.js          # 记忆核心（L1/L2/L3、相似度去重、分层检索、维护）
│   ├── prompts.js         # 系统提示词构建 + 人格/接口预设
│   ├── chat.js            # 聊天服务门面 + 发送主链路（统一对外导出）
│   ├── chat-state.js      # 聊天服务共享状态（memoryStore 单例 / 最近请求缓存）
│   ├── chat-settings.js   # 设置域（全局默认 + 会话设置快照）
│   ├── chat-conversations.js # 会话域（新建/切换/删除/复制 + 历史展示）
│   ├── chat-compress.js   # 压缩域（上下文压缩）
│   ├── llm.js             # OpenAI 兼容 LLM 客户端（流式控制 / 思考控制 / 日志埋点）
│   ├── log.js             # 调试日志环形缓冲
│   └── export.js          # 聊天记录导出
└── scripts/test-memory.mjs  # 核心逻辑断言测试（npm test）
```

## 🧪 测试

```bash
npm test
```

在 Node 环境 mock `uni` 存储运行，覆盖记忆解析、去重合并、召回冷却、检索注入、会话管理、上下文压缩、调试日志、API 预设、思考模式、会话人格、导出文本等 110+ 项断言。

## 📄 文档

- [CLAUDE.md](CLAUDE.md) — 架构设计、开发约定、平台差异与 Ollama 接入详解
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — 更新日志

## ⚠️ 平台说明

- 微信小程序需在公众平台配置 **request 合法域名**（App 端保持联网即可）
- 数据仅保存在本机，无任何云端同步
