/**
 * 跨端持久化层 —— 门面（facade）。
 *
 * 原单文件 storage.js 按功能域拆分为以下模块，本文件作为唯一对外出口，
 * 显式 re-export 各域公共接口，保证既有调用方（页面组件 / chat*.js / 测试）零改动：
 *   - storage-state.js        底层基础设施 + 会话共享状态 + 设置项 + 初始化迁移
 *   - storage-conversations.js 会话域（CRUD/消息/压缩/设置快照/人格/复制）
 *   - storage-scene.js         情景域 + 输入草稿
 *   - storage-api.js           API 配置预设域
 *   - storage-background.js    聊天背景图域
 *
 * 统一使用 uni.setStorageSync 同步存储（App / H5 / 小程序均可用，重启不丢）。
 */

export {
	initStorage,
	getSetting,
	setSetting,
	getMemories,
	getChatRows,
	replaceMemories,
	persistMemories,
	nextMemoryId
} from './storage-state.js'
export {
	addChatRow,
	clearChat,
	truncateChat,
	clearAllData,
	getConversations,
	getActiveConversationId,
	getConversationCompression,
	setConversationCompression,
	createConversation,
	switchConversation,
	deleteConversation,
	getConversationSettingsRaw,
	setConversationSettingsRaw,
	getConversationPersonality,
	setConversationPersonality,
	duplicateConversationToNew,
	duplicateMemoriesToNew
} from './storage-conversations.js'
export {
	getConversationDraft,
	setConversationDraft,
	getSceneHistory,
	getScene,
	setScene,
	truncateSceneHistory
} from './storage-scene.js'
export {
	getApiProfiles,
	saveApiProfile,
	deleteApiProfile,
	getApiProfile
} from './storage-api.js'
export {
	getBackgroundImage,
	removeBackgroundImage,
	saveBackgroundImage
} from './storage-background.js'