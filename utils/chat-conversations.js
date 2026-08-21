/**
 * 聊天服务 —— 会话域：
 * 多会话管理（新建/切换/删除/复制）+ 当前会话历史展示/清空 + 最近请求缓存同步
 */

import {
	getChatRows,
	clearChat,
	getConversations,
	getActiveConversationId,
	createConversation,
	switchConversation,
	deleteConversation,
	duplicateConversationToNew,
	duplicateMemoriesToNew,
	setConversationSettingsRaw
} from './storage.js'
import { memoryStore, lastRequest } from './chat-state.js'
import { getConversationSettings, normalizeSettings } from './chat-settings.js'
import { addLog } from './log.js'

/** 剔除消息文本行首的 Scene/Memory 标记行（修复旧数据：早期落库过含标记的完整回复） */
function stripMetaLines(content) {
	const clean = String(content || '')
		.split('\n')
		.filter((l) => !/^\s*(Scene|Memory)\s*[:：]/i.test(l))
		.join('\n')
		.trim()
	return clean || '…'
}

/** 聊天页历史（返回副本，剔除遗留的 Scene/Memory 标记行后展示） */
export function getHistoryForUI() {
	return getChatRows().map((r) => ({ ...r, content: stripMetaLines(r.content) }))
}

/** 清空对话 */
export function clearConversation() {
	clearChat()
	syncLastRequest()
	addLog('info', '清空当前对话')
}

/** 同步请求缓存到当前会话的最后一条用户消息（切会话/清空后调用，避免跨会话重发错内容） */
export function syncLastRequest() {
	const rows = getChatRows()
	for (let i = rows.length - 1; i >= 0; i--) {
		if (rows[i].role === 'user') {
			lastRequest.value = rows[i].content
			return
		}
	}
	lastRequest.value = ''
}

// ---------- 会话管理 ----------

/** 会话列表（供历史对话弹窗展示） */
export function listConversations() {
	return getConversations()
}

/** 当前会话 id */
export function activeConversationId() {
	return getActiveConversationId()
}

/** 开始新对话：当前对话非空则归档并新建，否则复用并重置当前空对话；新对话复制当前设置（每个对话独享一份设置） */
export function startNewConversation() {
	memoryStore.resetState()
	// 记录创建前的当前会话生效设置（含无快照会话的全局回退值），供新对话复制
	const currentSettings = getConversationSettings()
	if (getChatRows().length) {
		createConversation()
		addLog('info', '开始新对话')
	} else {
		clearChat()
		addLog('info', '重置空对话')
	}
	setConversationSettingsRaw(normalizeSettings(currentSettings))
	syncLastRequest()
}

/** 切换到指定会话（记忆与人格随会话切换，重置召回状态） */
export function openConversation(id) {
	const ok = switchConversation(id)
	if (ok) {
		memoryStore.resetState()
		syncLastRequest()
		addLog('info', '切换会话', id)
	}
	return ok
}

/** 删除指定会话 */
export function removeConversation(id) {
	const ok = deleteConversation(id)
	if (ok) {
		memoryStore.resetState()
		syncLastRequest()
		addLog('info', '删除会话', id)
	}
	return ok
}

/** 复制当前会话（消息+记忆+人格）到新会话并切换 */
export function copyConversationToNew() {
	duplicateConversationToNew()
	memoryStore.resetState()
	syncLastRequest()
	addLog('info', '复制对话到新会话')
}

/** 复制当前会话的记忆到新会话并切换 */
export function copyMemoriesToNew() {
	duplicateMemoriesToNew()
	memoryStore.resetState()
	syncLastRequest()
	addLog('info', '复制记忆到新会话')
}
