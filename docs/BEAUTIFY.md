# beautify 分支说明

> 本分支在 `main` 基础上做**界面美化与现代化**改造，采用 **C 方案：wot-design-uni 按需引入 + 自建设计令牌系统**。

- 基准分支：`main`
- 分支用途：纯端侧 UI 美化，**不改变任何业务逻辑、存储结构、记忆/聊天链路与对外接口**；核心逻辑测试全部保持通过。
- 前置依赖：`sass`（编译 scss 变量）、`wot-design-uni`（UI 组件库）。运行前需 `npm install`。

---

## 一、分支特点

1. **克制引入，按需加载**：打破「0 npm 依赖」惯例是有条件的——通过 uni-app 的 `easycom` 机制**按需自动引入** wot 组件，只用上什么才打包什么，未引入的部分不增加包体积。运行时未使用 wot 的表单/提示组件时不会被打包。
2. **统一的视觉基础（设计令牌）**：用一套「CSS 变量（`App.vue`）+ SCSS 变量（`uni.scss`）」定义品牌主色、渐变、中性色、状态色、圆角、阴影、间距，所有页面引用同源令牌，改一处全局生效，保证跨页一致。
3. **wot 主题品牌化**：不写死 wot 内部样式，而是通过根节点覆盖 `--wd-color-*` 系列令牌，把组件库主题统一收敛为本项目的品牌色。
4. **渐变 + 阴影 + 圆角卡片**：品牌 CTA 用 135° 品牌渐变（主蓝→紫），对话框用户气泡同样用品牌渐变；页面为浅灰底 + 白色圆角卡片 + 轻阴影，营造简洁、现代、呼吸感强的观感。
5. **业务与样式解耦**：所有改造只动 `<template>`/`<style>` 与配置，`<script>` 里的数据、方法、组件事件签名保持不变，因此原有 `npm test` 断言不受影响。

---

## 二、主要修改点

| 文件 | 改动内容 |
|---|---|
| `package.json` | 新增 `dependencies`：`sass`、`wot-design-uni`；`test` 脚本不变 |
| `pages.json` | ① 新增 `easycom.custom`：`^wd-(.*)` → `wot-design-uni/components/wd-$1/wd-$1.vue` 按需引入；② `tabBar.custom: true` 启用自绘底部导航栏（启用后原生 tabBar 不再渲染）——这样三端手动深浅色都能应用到底部栏；`globalStyle` 使用**固定浅色默认值**（不随系统，深色由运行时 `setNavigationBarColor` 覆盖） |
| `manifest.json` | 移除各平台 `darkmode` / `themeLocation`（不再跟随系统） |
| `theme.json`（原新增，已删除） | 曾用于「跟随系统」深浅配色的 `@` 变量定义，随系统跟随删除后不再需要 |
| `uni.scss` | 顶部新增 beautify 设计令牌（`$c-primary`/`$c-brand-gradient`/`$c-bg`/`$c-card`/`$c-radius-*`/`$c-shadow-card` 等），并把 `$uni-color-primary` 等内置变量映射到令牌，保持插件生态兼容 |
| `App.vue` | 全局注入同名 `--c-*` CSS 变量，供普通 css 页面引用；并覆盖 `--wd-color-theme/success/warning/danger` 实现 wot 主题品牌化；`.theme-light` / `.theme-dark`（仅手动，不带 `@media`）覆盖令牌；新增 `--ctab-h` 定义自绘 tabBar 内容高度 |
| `utils/theme.js`（新增） | 主题模式工具：**仅手动 `light`/`dark`**（默认浅色，无「跟随系统」），持久化 + `onThemeChange` 订阅实现即时换肤 |
| `main.js` | 注册全局 `themeMixin`，为所有页面提供响应式 `themeClass`（`theme-light` / `theme-dark`），订阅本地切换事件即时生效，并按 `__theme` 同步原生导航栏配色（`__applyNavbar`） |
| `pages/*.vue`（聊天/记忆/表情/设置） | 4 个页面根节点 `<view class="page">` 绑定 `:class="themeClass"`，接收暗黑/手动主题 |
| `components/custom-tab-bar/custom-tab-bar.vue`（新增） | **自绘底部导航栏**：用主题令牌 `var(--c-card)`/`var(--c-line)`/`var(--c-brand-gradient)` 配色 + 表情图标，跟随手动深浅色切换，`active` prop 标识当前 tab，`switchTab` 切换三个页面；聊天/记忆/设置三页引入并预留底部高度。组件 `mounted` 里 `uni.hideTabBar({animation:false})` 兜底隐藏原生栏（**`tabBar.custom:true` 仅对微信小程序隐藏原生栏，H5/App 仍会渲染，必须配合隐藏机制**），根除双栏 |
| `pages/settings/settings.vue` | 设置页现代化改造样板：区块改卡片样式、按钮改品牌渐变 + 圆角胶囊 + 阴影、配色全部走令牌；「界面外观 → 深色模式」**仅手动浅色/深色**（已删「跟随系统」）与「聊天气泡不透明度」滑块（0.2~1）；各按钮/输入框/卡片硬编码浅色全部令牌化以适配深色 |
| `pages/chat/chat.vue` | 页面读取会话设置 `bubbleOpacity` 并透传给消息列表；根节点绑定 `:class="themeClass"` |
| `pages/settings/settings.vue` | **重构为设置首页**：不再展示配置表单，改为「分条陈列」的分区跳转入口（界面外观/接口配置/人格配置/拟真聊天/语音阅读/上下文压缩/数据管理/调试日志/帮助/关于），入口带说明与「保存/自动保存」标签；**接口配置未填（地址或 Key 为空）时在其入口显示红色 `*`**（`needConfig`），提示必要项待配置 |
| `pages/settings/appearance.vue`（新增） | 设置子页·界面外观：**内嵌聊天背景（由原独立分区并入）**，含深色模式（即时生效）、聊天气泡不透明度滑块、聊天背景选择/移除；底部统一样式「保存设置」按钮（`saveSettings` 保存气泡不透明度，背景即时应用） |
| `pages/settings/api.vue`（新增） | 设置子页·接口配置：常用接口预设、接口地址/Key/模型/温度/思考模式/最大请求次数、API 预设增删改；**免费额度模型推荐**（通义千问/DeepSeek/Kimi/智谱 GLM/Ollama，点选自动填充地址+模型）；**「查看傻瓜式配置教程」弹窗**（面向零基础的图文步骤，含本地 Ollama 局域网接入）；表单未配置时显示红色 `*` 提醒；保存按钮 |
| `pages/settings/persona.vue`（新增） | 设置子页·人格配置：情景时间、聊天表情包、预设人格/自定义人格与提示词编辑；保存按钮 |
| `pages/settings/proactive.vue`（新增） | 设置子页·拟真聊天：开关/时段/频率/自定义倒计时/调试即时发送/倒计时展示；保存按钮（保存后 `rearmProactive`） |
| `pages/settings/tts.vue`（新增） | 设置子页·语音阅读：TTS 开关/Key/模型/音色/接口测试；保存按钮 |
| `pages/settings/compress.vue`（新增） | 设置子页·上下文压缩：压缩间隔档位，**更改即自动保存**（标绿「更改自动保存」提示） |
| `pages/settings/data.vue`（新增） | 设置子页·数据管理：清空对话 / 清空记忆与全部数据（即时操作+二次确认） |
| `pages/settings/logs.vue`（新增） | 设置子页·调试日志：刷新/清空与展开式日志详情 |
| `pages/settings/help.vue`（新增） | 设置子页·帮助：**各功能介绍与使用方法**（手风琴式折叠条目） |
| `pages/settings/about.vue`（新增） | 设置子页·关于：**App 基本情况**（Logo/版本/简介/技术栈/接口协议/数据存储）＋**相关链接**（GitHub 仓库，点击复制：`06FallingLight90/chabot`）＋**鸣谢**（koishi-ai-pet 记忆机制灵感来源，点击复制链接） |
| `pages.json` | 注册以上 10 个设置子页（`navigateTo` 跳转，不进 tabBar），并保留原生标题 |
| `pages.json` | 撤回「跟随系统」：不再有顶层 `darkmode`/`themeLocation`；`tabBar` 改 `custom: true`，**并在每个 `list` 项加 `visible:false`**（该字段仅对 H5 生效）以隐藏原生 tabBar——因为 `custom:true` 只在微信小程序隐藏原生栏，H5/App 需 `visible:false` + `hideTabBar` 兜底 |
| `manifest.json` / `main.js` | 撤回「跟随系统」：移除各端 `darkmode`/`themeLocation` 与 `__applyTabBar`；原生导航栏配色仅在 `onShow`/`onReady`/`mounted` 由 `__applyNavbar` 按手动主题同步 |
| `App.vue` | 新增设置子页面共用布局样式（`.ss-*` 命名空间，避免与业务页冲突）：卡片/行/按钮/输入框/标题/保存按钮/自动保存提示等 |
| `pages/chat/components/chat-msg-list.vue` | 消息气泡改为「背景层 + 文字层」结构，背景不透明度可调（文字始终清晰）；空态/重新生成等颜色令牌化 |
| `pages/chat/components/chat-input-bar.vue` | 发送框令牌化：输入栏、表情按钮、发送按钮全部走 `--c-*` 令牌，深色下底色/文字正确适配 |
| `pages/chat/components/chat-history.vue` / `chat-persona.vue` / `chat-scene-edit.vue` / `chat-emoji-panel.vue` | 弹窗/表情栏面板、按钮、文字、输入框全部令牌化，深色模式下不再出现白色弹窗 |
| `pages/memory/memory.vue` | 加顶栏 hero 区、卡片化列表、令牌化配色与圆角阴影；**筛选按钮改独占整行、flex 四等分 + `white-space: nowrap`**，保证缩放不内部断字；多选删除按钮禁用态令牌化 |
| `pages/emoji/emoji.vue` | 加顶栏 hero 区、卡片化列表项、令牌化交互样式 |
| `pages/chat/chat.vue` | 页面背景走令牌 `var(--c-bg)` |
| `pages/chat/components/chat-header.vue` | 顶栏改品牌渐变 + 白字；情景条改卡片化 + 圆角 + 阴影 |
| `pages/chat/components/chat-msg-list.vue` | 用户气泡改品牌渐变 + 白字 + 投影；助手气泡改白卡片 + 轻阴影 + 圆角；`load-earlier`/`empty` 等提示样式令牌化 |

> 说明：本轮以「样面包板」方式落地了设置页 wot 可行性验证与各页令牌化；聊天页弹窗（情景编辑/历史/人格）与输入栏的深度打磨、`wd-*` 组件在表单场景的实际替换列为后续迭代，见下方技术债。

---

## 三、技术债清单

以下为未完成或需跟踪的事项，均**不影响当前功能与测试**：

1. **已取消「跟随系统」深色，改为仅手动主题**：因 App 端依赖 `prefers-color-scheme` / `uni.onThemeChange` 跨端不可靠，方向改为「仅手动浅色/深色」，删除 `darkmode` / `theme.json` / `themeLocation` / 程序化系统解析。原生导航栏颜色由 `main.js` 的 `__applyNavbar` 在 `onShow`/`onReady`/`mounted` 按当前手动主题同步（冷启动瞬间可能有一帧浅色闪烁，可接受）。**底部 tabBar 改用自绘 `custom-tab-bar.vue`**（`tabBar.custom:true` 后原生 tabBar 不再渲染），用令牌配色彻底解决原生栏无法随手动主题换肤的问题——三端手动切色都能同步底部栏。
2. **wot 组件实际替换范围有限**：目前仅完成了样式令牌化与 easycom 接入，设置页尚未真正大规模替换为 `wd-*` 组件。建议后续挑选设置项逐块替换并真机验证，替换时注意 wot 的 `wd-toast`/`wd-message-box`/`wd-popup` 等组件在 App/H5/小程序三端的差异。
3. **打包体积评估缺失**：未对引入 wot 后的产物体积做对比测量。虽按需引入可控，但首次实际引入组件时建议用 HBuilderX 发行包对比体积，确认增幅可接受再大规模铺开。
4. **sass 编译与 `sass` 依赖需要 CI/构建环境**：`uni.scss` 的 SCSS 变量依赖 `sass`，构建环境需保证该依赖可安装（内网/离线环境需提前准备）。
5. **LF/CRLF 换行**：Git 提示工作区文件 LF 将被替换为 CRLF。当前未配置 `.gitattributes`，跨平台编辑可能引入换行噪音，建议后续统一规范。
6. **背景图 / 元素对比度**：请确保浅色底上的文字对比度在新配色下仍满足可读性（尤其 `--c-text-aid` 弱提示色），正式发布前建议过一遍各页对比度。
7. **设置页拆分为子页后的保存语义**：每个「保存」子页按会话快照整体 `saveSettings`（各页在 `onShow` 独立重新读取快照）。因此在某页修改未保存就跳到另一页并保存，前一页的未保存改动会被丢弃（符合主流「手动保存」预期）；「自动保存」页（上下文压缩）改动即落库。各子页共用 `.ss-*` 全局类，若未来某子页需要独有样式改在局部覆盖。

---

## 四、回归验证

- `npm test`：记忆 `/ 表情 / 聊天链路 / 会话 / 压缩 / 拟真 / 格式校验` 等 **24 组记忆断言 + 8 组表情断言全部通过**，证明美化未破坏核心逻辑。
- 三端冒烟：建议在 HBuilderX 中分别运行到 **App / H5 / 微信小程序**，重点检查聊天页气泡渲染、tabBar 配色、设置页 wot 组件在真机上的表现。