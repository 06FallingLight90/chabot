/**
 * 跨端持久化层
 *
 * 统一使用 uni.setStorageSync 同步存储（App / H5 / 小程序均可用，重启不丢）。
 *
 * 说明：曾尝试 App 端使用 plus.sqlite（真 SQLite 文件），但其
 * openDatabase / selectSql / executeSql 均为异步回调 API，与本层同步接口不匹配：
 * 启动时 selectSql 同步返回 undefined，导致数据加载为空，后续全量重写把库清空。
 * 故统一回退到 uni storage——数据量小（记忆 ≤200 条、对话 7 天），完全够用且可靠。
 */

const KEY_MEMORIES = 'chabot_memories'
const KEY_CHAT = 'chabot_chat_history' // 旧版单流对话键（首次启动时迁移为会话）
const KEY_CONVERSATIONS = 'chabot_conversations'
const KEY_ACTIVE_CONV = 'chabot_active_conv'

const MAX_TITLE_LEN = 16 // 会话标题截断长度

let _memories = []
let _conversations = [] // [{id, title, created_at, updated_at, summary, compressedUntil, messages:[...]}]
let _activeConvId = ''
let _chat = [] // 当前会话 messages 的活引用
let _initialized = false
let _convSeq = 0

/** 初始化存储：加载内存数据（幂等），并把旧版单流对话/全局记忆迁移到当前会话 */
export function initStorage() {
	if (_initialized) return
	_conversations = _get(KEY_CONVERSATIONS)
	if (!_conversations.length) {
		const legacy = _get(KEY_CHAT)
		_conversations = [_makeConversation('', Array.isArray(legacy) ? legacy : [])]
		_set(KEY_CONVERSATIONS, _conversations)
	}
	// 旧版全局记忆（chabot_memories）迁移到第一个尚无记忆的会话，随后清空旧键
	const globalMemories = _get(KEY_MEMORIES)
	if (globalMemories.length) {
		const target = _conversations.find((c) => !(c.memories && c.memories.length)) || _conversations[0]
		if (target) {
			target.memories = globalMemories
			_persistConversations()
		}
		_set(KEY_MEMORIES, [])
	}
	// 旧版全局情景（chabot_setting_scene）迁移到第一个尚无情景的会话，随后清空旧键
	const legacyScene = getSetting('scene', '')
	if (legacyScene) {
		const target = _conversations.find((c) => !(c.scenes && c.scenes.length)) || _conversations[0]
		if (target) {
			const arr = typeof legacyScene === 'string' ? [legacyScene] : legacyScene
			target.scenes = Array.isArray(arr) ? arr.filter((s) => typeof s === 'string' && s) : []
			_persistConversations()
		}
		setSetting('scene', '')
	}
	let savedId = ''
	if (typeof uni !== 'undefined' && uni.getStorageSync) savedId = uni.getStorageSync(KEY_ACTIVE_CONV)
	const active = _conversations.find((c) => c.id === savedId) || _conversations[0]
	_activeConvId = active.id
	_chat = active.messages
	_memories = active.memories
	if (savedId !== _activeConvId) _set(KEY_ACTIVE_CONV, _activeConvId)
	_initialized = true
}

function _makeConversation(title, messages) {
	_convSeq++
	const now = new Date().toISOString()
	return {
		id: 'c' + Date.now().toString(36) + '_' + _convSeq,
		title: title || '',
		created_at: now,
		updated_at: now,
		summary: '', // 压缩后的上文概要
		compressedUntil: 0, // 已压缩并入概要的消息下标（含）
		personality: null, // 本会话独立的人格设置快照 {personalityId, customPrompt, timeMode}
		scenes: [], // 本会话独立的情景历史（最新在末尾，最多 10 条）
		memories: [], // 本会话独立的记忆数组
		messages: messages || []
	}
}

function _activeConversation() {
	return _conversations.find((c) => c.id === _activeConvId) || _conversations[0] || null
}

function _makeTitle(text) {
	const t = String(text || '').replace(/\s+/g, ' ').trim()
	return t ? t.slice(0, MAX_TITLE_LEN) : '新对话'
}

function _persistConversations() {
	_set(KEY_CONVERSATIONS, _conversations)
}

/** 当前会话记忆数组（活引用，指向当前会话的 memories） */
export function getMemories() {
	return _memories
}

/** 当前对话数组（活引用，指向当前会话的消息） */
export function getChatRows() {
	return _chat
}

/** 用新数组整体替换当前会话记忆并落盘（同步写回会话对象） */
export function replaceMemories(arr) {
	_memories = arr || []
	const conv = _activeConversation()
	if (conv) conv.memories = _memories
	persistMemories()
}

/** 全量持久化当前会话记忆（写入会话对象，随会话整体落盘） */
export function persistMemories() {
	_persistConversations()
}

/** 追加一条对话记录到当前会话并落盘；首条用户消息自动生成会话标题 */
export function addChatRow(role, content) {
	const row = { id: _nextId(_chat), role, content, created_at: new Date().toISOString() }
	_chat.push(row)
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
		_chat = conv.messages
		_persistConversations()
	}
}

/** 从指定下标截断当前会话消息（重新生成用），并收敛压缩进度 */
export function truncateChat(fromIndex) {
	const conv = _activeConversation()
	if (!conv) return
	conv.messages = conv.messages.slice(0, fromIndex)
	_chat = conv.messages
	conv.updated_at = new Date().toISOString()
	if (conv.compressedUntil > conv.messages.length) conv.compressedUntil = conv.messages.length
	_persistConversations()
}

/** 清空全部数据（记忆 + 会话，重置为一个空会话） */
export function clearAllData() {
	_conversations = [_makeConversation('', [])]
	_activeConvId = _conversations[0].id
	_chat = _conversations[0].messages
	_memories = _conversations[0].memories
	_persistConversations()
	_set(KEY_ACTIVE_CONV, _activeConvId)
	_set(KEY_MEMORIES, []) // 顺手清掉旧版全局记忆键
	_set(KEY_CHAT, []) // 顺手清掉旧键
}

// ---------- 会话管理 ----------

/** 会话列表元信息（按更新时间倒序），供历史对话弹窗展示 */
export function getConversations() {
	return _conversations
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
	return _activeConvId
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
	_conversations.unshift(conv)
	_activeConvId = conv.id
	_chat = conv.messages
	_memories = conv.memories
	_persistConversations()
	_set(KEY_ACTIVE_CONV, _activeConvId)
	return conv
}

/** 切换到指定会话（记忆同步切换） */
export function switchConversation(id) {
	const conv = _conversations.find((c) => c.id === id)
	if (!conv) return false
	_activeConvId = conv.id
	_chat = conv.messages
	_memories = conv.memories
	_set(KEY_ACTIVE_CONV, _activeConvId)
	return true
}

/** 删除会话；若删除的是当前会话则自动切到最近的一个（无则新建空会话） */
export function deleteConversation(id) {
	const idx = _conversations.findIndex((c) => c.id === id)
	if (idx < 0) return false
	_conversations.splice(idx, 1)
	if (_activeConvId === id) {
		const next = _conversations[0]
		if (next) {
			_activeConvId = next.id
			_chat = next.messages
			_memories = next.memories
		} else {
			createConversation()
		}
		_set(KEY_ACTIVE_CONV, _activeConvId)
	}
	_persistConversations()
	return true
}

/** 当前会话的人格设置快照（无则为 null，回退全局设置） */
export function getConversationPersonality() {
	const conv = _activeConversation()
	return (conv && conv.personality) || null
}

/** 写入当前会话的人格设置快照 */
export function setConversationPersonality(p) {
	const conv = _activeConversation()
	if (!conv) return
	conv.personality = p || null
	_persistConversations()
}

/**
 * 复制当前会话到新会话（消息 + 记忆 + 概要 + 人格快照，标题加"副本"后缀）并切换。
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
		personality: conv.personality ? { ...conv.personality } : null,
		scenes: (conv.scenes || []).slice()
	}
	const nu = _makeConversation(src.title ? src.title + '（副本）' : '', src.messages)
	nu.memories = src.memories
	nu.summary = src.summary
	nu.compressedUntil = src.compressedUntil
	nu.personality = src.personality
	nu.scenes = src.scenes
	_conversations.unshift(nu)
	_activeConvId = nu.id
	_chat = nu.messages
	_memories = nu.memories
	_persistConversations()
	_set(KEY_ACTIVE_CONV, _activeConvId)
	return nu
}

/** 仅复制当前会话的记忆到新会话（含人格快照）并切换 */
export function duplicateMemoriesToNew() {
	const conv = _activeConversation()
	const nu = _makeConversation('', [])
	nu.memories = (conv.memories || []).map((m) => ({ ...m }))
	nu.personality = conv.personality ? { ...conv.personality } : null
	_conversations.unshift(nu)
	_activeConvId = nu.id
	_chat = nu.messages
	_memories = nu.memories
	_persistConversations()
	_set(KEY_ACTIVE_CONV, _activeConvId)
	return nu
}

/** 下一条记忆 id */
export function nextMemoryId() {
	return _nextId(_memories)
}

function _nextId(arr) {
	let max = 0
	for (const r of arr) if (r.id > max) max = r.id
	return max + 1
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

function _set(key, val) {
	if (typeof uni !== 'undefined' && uni.setStorageSync) {
		try {
			uni.setStorageSync(key, val)
		} catch (e) {
			console.error('[storage] 数据保存失败:', key, e)
		}
	}
}

// ---------- 当前情景（随会话独立） ----------

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

// ---------- API 配置预设（最多 3 套） ----------

const KEY_API_PROFILES = 'chabot_setting_api_profiles'
const API_PROFILE_MAX = 3

/** 已保存的 API 配置预设数组（每套 {id,name,baseUrl,apiKey,model,temperature}），返回副本 */
export function getApiProfiles() {
	if (typeof uni === 'undefined' || !uni.getStorageSync) return []
	const v = uni.getStorageSync(KEY_API_PROFILES)
	return Array.isArray(v) ? v.slice() : []
}

function _setApiProfiles(arr) {
	if (typeof uni !== 'undefined' && uni.setStorageSync) {
		try {
			uni.setStorageSync(KEY_API_PROFILES, arr)
		} catch (e) {
			console.error('[storage] API 预设保存失败:', e)
		}
	}
}

/**
 * 保存/覆盖第 index（0~2）套 API 预设。
 * 超出 3 套上限返回 false；覆盖时保留原 id。
 */
export function saveApiProfile(index, name, cfg = {}) {
	index = parseInt(index, 10)
	if (!Number.isInteger(index) || index < 0 || index >= API_PROFILE_MAX) return false
	const arr = getApiProfiles()
	const old = arr[index]
	const item = {
		id: (old && old.id) || 'ap' + Date.now().toString(36) + '_' + index,
		name: String(name || '预设' + (index + 1)).trim().slice(0, 12) || '预设' + (index + 1),
		baseUrl: (cfg.baseUrl || '').trim(),
		apiKey: (cfg.apiKey || '').trim(),
		model: (cfg.model || '').trim(),
		temperature: cfg.temperature === undefined ? 0.8 : cfg.temperature
	}
	arr[index] = item
	_setApiProfiles(arr)
	return true
}

/** 删除第 index 套预设；index 越界返回 false */
export function deleteApiProfile(index) {
	index = parseInt(index, 10)
	const arr = getApiProfiles()
	if (!Number.isInteger(index) || index < 0 || index >= arr.length) return false
	arr.splice(index, 1)
	_setApiProfiles(arr)
	return true
}

/** 读取第 index 套预设（含 baseUrl/apiKey/model/temperature），不存在返回 null */
export function getApiProfile(index) {
	index = parseInt(index, 10)
	const p = getApiProfiles()[index]
	if (!p) return null
	return { baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model, temperature: p.temperature }
}

// ---------- 聊天背景图片 ----------

/** 当前聊天背景（路径 或 H5 的 base64 data URL），无则空串 */
export function getBackgroundImage() {
	return getSetting('bgImage', '')
}

/** 移除聊天背景 */
export function removeBackgroundImage() {
	const old = getBackgroundImage()
	setSetting('bgImage', '')
	if (old) {
		// #ifdef APP-PLUS || MP-WEIXIN
		uni.removeSavedFile({ filePath: old, fail: () => {} })
		// #endif
	}
}

/**
 * 保存聊天背景图片，返回持久化路径
 * - App / 微信小程序：uni.saveFile 持久化到本地文件
 * - H5：转 base64 存入 storage
 */
export async function saveBackgroundImage(tempPath) {
	if (!tempPath) return ''
	let saved = ''
	// #ifdef APP-PLUS || MP-WEIXIN
	saved = await new Promise((resolve) => {
		uni.saveFile({
			tempFilePath: tempPath,
			success: (res) => resolve(res.savedFilePath),
			fail: () => resolve('')
		})
	})
	// #endif
	// #ifdef H5
	saved = await _fileToBase64(tempPath)
	// #endif
	if (!saved) saved = tempPath // 兜底：临时路径（当次会话有效）
	const old = getBackgroundImage()
	setSetting('bgImage', saved)
	if (old && old !== saved) {
		// #ifdef APP-PLUS || MP-WEIXIN
		uni.removeSavedFile({ filePath: old, fail: () => {} })
		// #endif
	}
	return saved
}

// #ifdef H5
/** H5 端：canvas 压缩图片为 JPEG base64（限制宽度，避免超出 localStorage 配额） */
function _fileToBase64(tempPath) {
	const MAX_WIDTH = 1080
	const QUALITY = 0.8
	return new Promise((resolve) => {
		const img = new Image()
		img.onload = () => {
			try {
				let w = img.naturalWidth || img.width
				let h = img.naturalHeight || img.height
				if (w > MAX_WIDTH) {
					h = Math.round((h * MAX_WIDTH) / w)
					w = MAX_WIDTH
				}
				const canvas = document.createElement('canvas')
				canvas.width = w
				canvas.height = h
				canvas.getContext('2d').drawImage(img, 0, 0, w, h)
				resolve(canvas.toDataURL('image/jpeg', QUALITY))
			} catch (e) {
				console.error('[storage] 图片压缩失败', e)
				resolve('')
			}
		}
		img.onerror = () => resolve('')
		img.src = tempPath
	})
}
// #endif
