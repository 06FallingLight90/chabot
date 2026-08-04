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
const KEY_CHAT = 'chabot_chat_history'

let _memories = []
let _chat = []
let _initialized = false

/** 初始化存储：加载内存数据（幂等） */
export function initStorage() {
	if (_initialized) return
	_memories = _get(KEY_MEMORIES)
	_chat = _get(KEY_CHAT)
	_initialized = true
}

/** 当前记忆数组（活引用） */
export function getMemories() {
	return _memories
}

/** 当前对话数组（活引用） */
export function getChatRows() {
	return _chat
}

/** 用新数组整体替换记忆并落盘 */
export function replaceMemories(arr) {
	_memories = arr || []
	persistMemories()
}

/** 全量持久化记忆（小数据量，全量重写简单可靠） */
export function persistMemories() {
	_set(KEY_MEMORIES, _memories)
}

/** 追加一条对话记录并落盘 */
export function addChatRow(role, content) {
	const row = { id: _nextId(_chat), role, content, created_at: new Date().toISOString() }
	_chat.push(row)
	_set(KEY_CHAT, _chat)
	return row
}

/** 清空对话历史 */
export function clearChat() {
	_chat = []
	_set(KEY_CHAT, [])
}

/** 清空全部数据（记忆 + 对话） */
export function clearAllData() {
	_memories = []
	_chat = []
	_set(KEY_MEMORIES, [])
	_set(KEY_CHAT, [])
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

// ---------- 当前情景 ----------

/** 当前情景（LLM 每轮更新，用户可查看/修改） */
export function getScene() {
	return getSetting('scene', '')
}

export function setScene(v) {
	setSetting('scene', v || '')
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
