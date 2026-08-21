/**
 * 聊天服务共享状态 —— 供 chat.js / chat-conversations.js 等模块共享的可变状态：
 * - memoryStore：记忆单例（会话切换重置 / 消息发送检索与入库 / 维护）
 * - lastRequest：最近一次请求内容缓存（"重新生成"直接重发，不重复落库用户消息）
 * 独立成模块以消除 chat.js 与 chat-conversations.js 之间的循环依赖。
 */

import { MemoryStore } from './memory.js'

/** 记忆单例 */
export const memoryStore = new MemoryStore()

/** 最近一次请求内容缓存（跨模块读写） */
export const lastRequest = { value: '' }
