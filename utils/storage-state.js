/**
 * 存储层基础设施与会话共享状态 —— 从 storage.js 拆分。
 *
 * 持有全部跨域共享的内存状态（活引用指向当前会话的记忆/消息）与底层读写封装、
 * 设置项、初始化迁移。兄弟域模块（storage-conversations.js 等）通过 `_store` 访问
 * 共享状态，通过 `_activeConversation`/`_persistConversations`/`_commitActive` 等内部
 * 工具完成会话维度的读写，避免各文件各自缓存副本导致"替换后不同步"。
 *
 * 统一使用 uni.setStorageSync 同步存储（App / H5 / 小程序均可用，重启不丢）。
 * 说明：曾尝试 App 端使用 plus.sqlite（真 SQLite 文件），但其 openDatabase /
 * selectSql / executeSql 均为异步回调 API，与本层同步接口不匹配：启动时 selectSql
 * 同步返回 undefined，导致数据加载为空，后续全量重写把库清空。故统一回退到
 * uni storage——数据量小（记忆 ≤200 条、对话 7 天），完全够用且可靠。
 */

const KEY_MEMORIES = 'chabot_memories'
const KEY_CHAT = 'chabot_chat_history' // 旧版单流对话键（首次启动时迁移为会话）
const KEY_CONVERSATIONS = 'chabot_conversations'
const KEY_ACTIVE_CONV = 'chabot_active_conv'

const MAX_TITLE_LEN = 16 // 会话标题截断长度

/**
 * 共享状态（活引用单例）。所有域模块共享同一对象：
 * conversations：会话数组；activeConvId：当前会话 id；
 * chat / memories：当前会话 messages / memories 的活引用。
 */
export const _store = {
	conversations: [],
	activeConvId: '',
	chat: [],
	memories: [],
	initialized: false,
	convSeq: 0
}

/** 初始化存储：加载内存数据（幂等），并把旧版单流对话/全局记忆迁移到当前会话 */
export function initStorage() {
	if (_store.initialized) return
	_store.conversations = _get(KEY_CONVERSATIONS)
	if (!_store.conversations.length) {
		const legacy = _get(KEY_CHAT)
		_store.conversations = [_makeConversation('', Array.isArray(legacy) ? legacy : [])]
		_set(KEY_CONVERSATIONS, _store.conversations)
	}
	// 旧版全局记忆（chabot_memories）迁移到第一个尚无记忆的会话，随后清空旧键
	const globalMemories = _get(KEY_MEMORIES)
	if (globalMemories.length) {
		const target = _store.conversations.find((c) => !(c.memories && c.memories.length)) || _store.conversations[0]
		if (target) {
			target.memories = globalMemories
			_persistConversations()
		}
		_set(KEY_MEMORIES, [])
	}
	// 旧版全局情景（chabot_setting_scene）迁移到第一个尚无情景的会话，随后清空旧键
	const legacyScene = getSetting('scene', '')
	if (legacyScene) {
		const target = _store.conversations.find((c) => !(c.scenes && c.scenes.length)) || _store.conversations[0]
		if (target) {
			const arr = typeof legacyScene === 'string' ? [legacyScene] : legacyScene
			target.scenes = Array.isArray(arr) ? arr.filter((s) => typeof s === 'string' && s) : []
			_persistConversations()
		}
		setSetting('scene', '')
	}
	let savedId = ''
	if (typeof uni !== 'undefined' && uni.getStorageSync) savedId = uni.getStorageSync(KEY_ACTIVE_CONV)
	const active = _store.conversations.find((c) => c.id === savedId) || _store.conversations[0]
	_store.activeConvId = active.id
	_store.chat = active.messages
	_store.memories = active.memories
	if (savedId !== _store.activeConvId) _set(KEY_ACTIVE_CONV, _store.activeConvId)
	_store.initialized = true
}

/** 内部：构造新会话对象（不落盘），供会话/复制等域模块使用，门面不导出 */
export function _makeConversation(title, messages) {
	_store.convSeq++
	const now = new Date().toISOString()
	return {
		id: 'c' + Date.now().toString(36) + '_' + _store.convSeq,
		title: title || '',
		created_at: now,
		updated_at: now,
		summary: '', // 压缩后的上文概要
		compressedUntil: 0, // 已压缩并入概要的消息下标（含）
		settings: null, // 本会话独立的完整设置快照（null 回退全局设置）
		scenes: [], // 本会话独立的情景历史（最新在末尾，最多 10 条）
		memories: [], // 本会话独立的记忆数组
		messages: messages || []
	}
}

/** 当前会话对象（无则取第一个，仍无则 null） */
export function _activeConversation() {
	return _store.conversations.find((c) => c.id === _store.activeConvId) || _store.conversations[0] || null
}

/** 内部：切换"当前活动会话"，同步活引用并落盘 KEY_ACTIVE_CONV，供会话/复制等域模块调用 */
export function _commitActive(conv) {
	_store.activeConvId = conv.id
	_store.chat = conv.messages
	_store.memories = conv.memories
	_set(KEY_ACTIVE_CONV, conv.id)
}

/** 内部：全量落盘会话数组，供各域模块在修改会话后调用 */
export function _persistConversations() {
	_set(KEY_CONVERSATIONS, _store.conversations)
}

/** 内部：会话标题截断（首条用户消息 ≤16 字），门面不导出 */
export function _makeTitle(text) {
	const t = String(text || '').replace(/\s+/g, ' ').trim()
	return t ? t.slice(0, MAX_TITLE_LEN) : '新对话'
}

/** 设置项（跨端统一走 uni storage） */
export function getSetting(key, def) {
	if (typeof uni === 'undefined' || !uni.getStorageSync) return def
	const v = uni.getStorageSync('chabot_setting_' + key)
	return v === '' || v === null || v === undefined ? def : v
}

export function setSetting(key, val) {
	if (typeof uni !== 'undefined' && uni.setStorageSync) {
		try {
			uni.setStorageSync('chabot_setting_' + key, val)
		} catch (e) {
			console.error('[storage] 设置项保存失败:', key, e)
		}
	}
}

function _get(key) {
	if (typeof uni === 'undefined' || !uni.getStorageSync) return []
	const v = uni.getStorageSync(key)
	return Array.isArray(v) ? v : []
}

/** 内部：写入存储键（带兜底），门面不导出 */
export function _set(key, val) {
	if (typeof uni !== 'undefined' && uni.setStorageSync) {
		try {
			uni.setStorageSync(key, val)
		} catch (e) {
			console.error('[storage] 数据保存失败:', key, e)
		}
	}
}

// ---------- 记忆/消息活引用基础（当前会话维度） ----------

/** 当前会话记忆数组（活引用，指向当前会话的 memories） */
export function getMemories() {
	return _store.memories
}

/** 当前对话数组（活引用，指向当前会话的消息） */
export function getChatRows() {
	return _store.chat
}

/** 用新数组整体替换当前会话记忆并落盘（同步写回会话对象） */
export function replaceMemories(arr) {
	_store.memories = arr || []
	const conv = _activeConversation()
	if (conv) conv.memories = _store.memories
	persistMemories()
}

/** 全量持久化当前会话记忆（写入会话对象，随会话整体落盘） */
export function persistMemories() {
	_persistConversations()
}

/** 下一条记忆 id */
export function nextMemoryId() {
	return _nextId(_store.memories)
}

function _nextId(arr) {
	let max = 0
	for (const r of arr) if (r.id > max) max = r.id
	return max + 1
}