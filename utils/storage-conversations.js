/**
 * 存储层「会话域」—— 从 storage.js 拆分。
 * 会话 CRUD / 消息操作 / 压缩状态 / 设置快照与人格子集 / 复制，均作用于当前活动会话。
 * 共享状态存于 storage-state.js 的 `_store`，通过内部工具读写，保证活引用一致。
 */

import {
	_store,
	_makeConversation,
	_makeTitle,
	_activeConversation,
	_commitActive,
	_persistConversations,
	_set
} from './storage-state.js'

// ---------- 消息操作（当前会话维度） ----------

/** 追加一条对话记录到当前会话并落盘；首条用户消息自动生成会话标题。extra 为可选附加字段（如回复行携带的回滚信息） */
export function addChatRow(role, content, extra) {
	const row = { id: _nextId(_store.chat), role, content, created_at: new Date().toISOString() }
	if (extra && typeof extra === 'object') Object.assign(row, extra)
	_store.chat.push(row)
	const conv = _activeConversation()
	if (conv) {
		conv.updated_at = row.created_at
		if (!conv.title && role === 'user') conv.title = _makeTitle(content)
		_persistConversations()
	}
	return row
}

/** 清空当前会话（消息/标题/概要一并重置，会话本身保留） */
export function clearChat() {
	const conv = _activeConversation()
	if (conv) {
		conv.messages = []
		conv.title = ''
		conv.summary = ''
		conv.compressedUntil = 0
		conv.updated_at = new Date().toISOString()
		_store.chat = conv.messages
		_persistConversations()
	}
}

/** 从指定下标截断当前会话消息（重新生成用），并收敛压缩进度 */
export function truncateChat(fromIndex) {
	const conv = _activeConversation()
	if (!conv) return
	conv.messages = conv.messages.slice(0, fromIndex)
	_store.chat = conv.messages
	conv.updated_at = new Date().toISOString()
	if (conv.compressedUntil > conv.messages.length) conv.compressedUntil = conv.messages.length
	_persistConversations()
}

/** 清空全部数据（记忆 + 会话，重置为一个空会话） */
export function clearAllData() {
	_store.conversations = [_makeConversation('', [])]
	_store.activeConvId = _store.conversations[0].id
	_store.chat = _store.conversations[0].messages
	_store.memories = _store.conversations[0].memories
	_persistConversations()
	_set('chabot_active_conv', _store.activeConvId)
	_set('chabot_memories', []) // 顺手清掉旧版全局记忆键
	_set('chabot_chat_history', []) // 顺手清掉旧键
}

// ---------- 会话管理 ----------

/** 会话列表元信息（按更新时间倒序），供历史对话弹窗展示 */
export function getConversations() {
	return _store.conversations
		.slice()
		.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
		.map((c) => ({
			id: c.id,
			title: c.title || '新对话',
			created_at: c.created_at,
			updated_at: c.updated_at,
			preview: c.messages.length ? c.messages[c.messages.length - 1].content : ''
		}))
}

/** 当前会话 id */
export function getActiveConversationId() {
	return _store.activeConvId
}

/** 当前会话的压缩状态（概要 + 已压缩下标） */
export function getConversationCompression() {
	const conv = _activeConversation()
	return { summary: (conv && conv.summary) || '', compressedUntil: (conv && conv.compressedUntil) || 0 }
}

/** 写入当前会话的压缩结果 */
export function setConversationCompression(summary, compressedUntil) {
	const conv = _activeConversation()
	if (!conv) return
	conv.summary = String(summary || '').trim()
	conv.compressedUntil = Math.max(0, compressedUntil || 0)
	conv.updated_at = new Date().toISOString()
	_persistConversations()
}

/** 新建会话并切换为当前会话 */
export function createConversation() {
	const conv = _makeConversation('', [])
	_store.conversations.unshift(conv)
	_commitActive(conv)
	_persistConversations()
	return conv
}

/** 切换到指定会话（记忆同步切换） */
export function switchConversation(id) {
	const conv = _store.conversations.find((c) => c.id === id)
	if (!conv) return false
	_commitActive(conv)
	return true
}

/** 删除会话；若删除的是当前会话则自动切到最近的一个（无则新建空会话） */
export function deleteConversation(id) {
	const idx = _store.conversations.findIndex((c) => c.id === id)
	if (idx < 0) return false
	_store.conversations.splice(idx, 1)
	if (_store.activeConvId === id) {
		const next = _store.conversations[0]
		if (next) {
			_commitActive(next)
		} else {
			createConversation()
		}
	}
	_persistConversations()
	return true
}

/** 当前会话的完整设置快照（无则为 null，回退全局设置） */
export function getConversationSettingsRaw() {
	const conv = _activeConversation()
	return (conv && conv.settings) || null
}

/** 写入当前会话的完整设置快照（设置面板保存 / 新对话复制当前设置） */
export function setConversationSettingsRaw(s) {
	const conv = _activeConversation()
	if (!conv) return
	conv.settings = s || null
	_persistConversations()
}

/**
 * 当前会话的人格子集（含 timeMode）：完整快照存在则取其子集；
 * 旧数据（仅有人格快照无完整设置）回退 legacy personality 字段。
 */
export function getConversationPersonality() {
	const conv = _activeConversation()
	if (!conv) return null
	if (conv.settings) {
		return {
			personalityId: conv.settings.personalityId,
			customPrompt: conv.settings.customPrompt,
			timeMode: conv.settings.timeMode
		}
	}
	return conv.personality || null
}

/** 写入当前会话的人格子集：完整快照存在则原地更新，否则写旧版 personality 字段 */
export function setConversationPersonality(p) {
	const conv = _activeConversation()
	if (!conv) return
	if (conv.settings) {
		conv.settings.personalityId = p.personalityId
		conv.settings.customPrompt = p.customPrompt
		conv.settings.timeMode = p.timeMode
	} else {
		conv.personality = p || null
	}
	_persistConversations()
}

/**
 * 复制当前会话到新会话（消息 + 记忆 + 概要 + 设置快照，标题加"副本"后缀）并切换。
 * @returns {object} 新会话
 */
export function duplicateConversationToNew() {
	const conv = _activeConversation()
	const src = {
		title: conv.title,
		messages: conv.messages.map((m) => ({ ...m })),
		memories: (conv.memories || []).map((m) => ({ ...m })),
		summary: conv.summary,
		compressedUntil: conv.compressedUntil,
		settings: conv.settings ? { ...conv.settings } : null,
		personality: conv.personality ? { ...conv.personality } : null, // 旧数据兜底
		scenes: (conv.scenes || []).slice()
	}
	const nu = _makeConversation(src.title ? src.title + '（副本）' : '', src.messages)
	nu.memories = src.memories
	nu.summary = src.summary
	nu.compressedUntil = src.compressedUntil
	nu.settings = src.settings
	nu.personality = src.personality
	nu.scenes = src.scenes
	_store.conversations.unshift(nu)
	_commitActive(nu)
	_persistConversations()
	return nu
}

/** 仅复制当前会话的记忆到新会话（含设置快照）并切换 */
export function duplicateMemoriesToNew() {
	const conv = _activeConversation()
	const nu = _makeConversation('', [])
	nu.memories = (conv.memories || []).map((m) => ({ ...m }))
	nu.settings = conv.settings ? { ...conv.settings } : null
	nu.personality = conv.personality ? { ...conv.personality } : null // 旧数据兜底
	_store.conversations.unshift(nu)
	_commitActive(nu)
	_persistConversations()
	return nu
}

function _nextId(arr) {
	let max = 0
	for (const r of arr) if (r.id > max) max = r.id
	return max + 1
}