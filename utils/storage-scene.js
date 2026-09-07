/**
 * 存储层「情景 / 输入草稿域」—— 从 storage.js 拆分，均随会话独立存储。
 */

import { _activeConversation, _persistConversations } from './storage-state.js'

// ---------- 输入草稿（未发送内容，跨 tab 切换/页面重建保留） ----------

/** 当前会话的输入草稿（未发送内容），无则为空串 */
export function getConversationDraft() {
	const conv = _activeConversation()
	return conv && typeof conv.draft === 'string' ? conv.draft : ''
}

/** 写入当前会话的输入草稿 */
export function setConversationDraft(text) {
	const conv = _activeConversation()
	if (!conv) return
	conv.draft = String(text == null ? '' : text)
	_persistConversations()
}

// ---------- 当前情景 ----------

const SCENE_HISTORY_MAX = 10 // 情景历史保留条数（FIFO，超出丢弃最旧）

/** 当前会话的情景历史数组（最新在末尾，最多 10 条），返回副本避免外部改坏 */
export function getSceneHistory() {
	const conv = _activeConversation()
	const h = conv && Array.isArray(conv.scenes) ? conv.scenes : []
	return h.slice()
}

/** 当前情景（LLM 每轮更新，用户可查看/修改）——取当前会话历史中最新的那条 */
export function getScene() {
	const h = getSceneHistory()
	return h.length ? h[h.length - 1] : ''
}

/**
 * 记录当前会话情景：追加到会话历史末尾并保留最新 10 条（FIFO）。
 * 与最新情景相同则不重复记录；空值表示清除该会话的全部情景。
 */
export function setScene(v) {
	const conv = _activeConversation()
	if (!conv) return
	if (!Array.isArray(conv.scenes)) conv.scenes = []
	const text = (v || '').trim()
	if (!text) {
		conv.scenes = []
		_persistConversations()
		return
	}
	if (conv.scenes[conv.scenes.length - 1] === text) return
	conv.scenes.push(text)
	if (conv.scenes.length > SCENE_HISTORY_MAX) conv.scenes.splice(0, conv.scenes.length - SCENE_HISTORY_MAX)
	_persistConversations()
}

/** 情景历史截断到指定长度（重新生成时撤回该响应记录的情景） */
export function truncateSceneHistory(len) {
	const conv = _activeConversation()
	if (!conv || !Array.isArray(conv.scenes)) return
	if (conv.scenes.length > len) {
		conv.scenes = conv.scenes.slice(0, Math.max(0, len))
		_persistConversations()
	}
}