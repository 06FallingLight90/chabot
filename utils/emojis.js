/**
 * 表情包数据层 —— 全局共享的表情列表（不随会话切换）
 *
 * 每个表情 { id, name, src, created_at }：
 * - name 表情名：上传时必填、全局唯一、≤20 字、不含 $/换行；消息中用 $表情名$ 引用
 * - src 图片：App / 微信小程序为 uni.saveFile 持久化路径，H5 为压缩后的 PNG base64
 *
 * 存储键 chabot_emojis（uni storage，跨端可用）。表情数量与图片大小设上限，
 * 避免 H5 localStorage 配额（约 5MB）被大图打满。
 */

const KEY_EMOJIS = 'chabot_emojis'

export const EMOJI_MAX_COUNT = 50 // 表情数量上限
export const EMOJI_MAX_NAME_LEN = 20 // 表情名长度上限（字），与 $名$ 占位解析的正则上限一致
const EMOJI_IMG_MAX_WIDTH = 300 // H5 压缩后的图片最大宽度（px）
const EMOJI_IMG_MAX_BYTES = 300 * 1024 // H5 base64 单图大小上限（约 300KB）

let _emojis = [] // 内存缓存（活数据）
let _loaded = false

/** 首次访问时从存储加载（幂等） */
function _ensureLoaded() {
	if (_loaded) return
	_loaded = true
	if (typeof uni !== 'undefined' && uni.getStorageSync) {
		const v = uni.getStorageSync(KEY_EMOJIS)
		_emojis = Array.isArray(v) ? v.filter((e) => e && typeof e.name === 'string' && e.name && e.src) : []
	} else {
		_emojis = []
	}
}

function _persist() {
	if (typeof uni !== 'undefined' && uni.setStorageSync) {
		try {
			uni.setStorageSync(KEY_EMOJIS, _emojis)
		} catch (e) {
			console.error('[emojis] 保存失败:', e)
		}
	}
}

/** 表情列表（副本） */
export function getEmojis() {
	_ensureLoaded()
	return _emojis.map((e) => ({ ...e }))
}

/** 表情名 → 图片 映射（渲染与校验用） */
export function getEmojiMap() {
	_ensureLoaded()
	const map = {}
	for (const e of _emojis) map[e.name] = e.src
	return map
}

/** 表情名清单（供 LLM 提示词注入） */
export function emojiListForPrompt() {
	_ensureLoaded()
	return _emojis.map((e) => e.name)
}

/**
 * 校验表情名：必填 / ≤20 字 / 不含 $ 与换行 / 全局唯一（改名时排除自身）
 * @param {string} name
 * @param {string} [excludeId] 排除的表情 id（改名时传入自身）
 * @returns {{ok:boolean, reason?:string}}
 */
export function validateEmojiName(name, excludeId) {
	const n = String(name || '').trim()
	if (!n) return { ok: false, reason: '请填写表情名' }
	if (n.length > EMOJI_MAX_NAME_LEN) return { ok: false, reason: `表情名不能超过 ${EMOJI_MAX_NAME_LEN} 字` }
	if (n.indexOf('$') !== -1 || /[\r\n]/.test(n)) return { ok: false, reason: '表情名不能包含 $ 或换行' }
	_ensureLoaded()
	for (const e of _emojis) {
		if (e.name === n && e.id !== excludeId) return { ok: false, reason: `表情名「${n}」已存在` }
	}
	return { ok: true }
}

/**
 * 以已持久化的 src 直接新增表情（图片保存由 addEmoji 负责；测试/导入场景可直用）
 * @param {string} name 表情名
 * @param {string} src 图片路径 / base64
 * @returns {{id:string, name:string, src:string, created_at:string}} 新增的表情副本
 */
export function addEmojiData(name, src) {
	const v = validateEmojiName(name)
	if (!v.ok) throw new Error(v.reason)
	_ensureLoaded()
	if (_emojis.length >= EMOJI_MAX_COUNT) throw new Error(`表情数量已达上限（${EMOJI_MAX_COUNT} 个）`)
	if (!src) throw new Error('缺少表情图片')
	const item = {
		id: 'e' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e4),
		name: name.trim(),
		src,
		created_at: new Date().toISOString()
	}
	_emojis.push(item)
	_persist()
	return { ...item }
}

/** 保存表情图片为持久化 src（App/小程序存文件，H5 转小尺寸 PNG base64），失败返回空串 */
async function _saveEmojiImage(tempPath) {
	let saved = ''
	// #ifdef APP-PLUS || MP-WEIXIN
	saved = await new Promise((resolve) => {
		uni.saveFile({
			tempFilePath: tempPath,
			success: (res) => resolve(res.savedFilePath || ''),
			fail: () => resolve('')
		})
	})
	// #endif
	// #ifdef H5
	saved = await _h5EmojiToBase64(tempPath)
	// #endif
	return saved
}

// #ifdef H5
/** H5 端：canvas 把图片压缩为小尺寸 PNG base64（保留透明，限制宽度与体积） */
function _h5EmojiToBase64(tempPath) {
	return new Promise((resolve) => {
		const img = new Image()
		img.onload = () => {
			try {
				let w = img.naturalWidth || img.width
				let h = img.naturalHeight || img.height
				if (w > EMOJI_IMG_MAX_WIDTH) {
					h = Math.round((h * EMOJI_IMG_MAX_WIDTH) / w)
					w = EMOJI_IMG_MAX_WIDTH
				}
				const canvas = document.createElement('canvas')
				canvas.width = w
				canvas.height = h
				canvas.getContext('2d').drawImage(img, 0, 0, w, h)
				const dataUrl = canvas.toDataURL('image/png')
				// base64 长度 × 3/4 ≈ 字节数，超限视为失败（提示重新选择更小图片）
				if (dataUrl.length * 0.75 > EMOJI_IMG_MAX_BYTES) return resolve('')
				resolve(dataUrl)
			} catch (e) {
				console.error('[emojis] 图片压缩失败', e)
				resolve('')
			}
		}
		img.onerror = () => resolve('')
		img.src = tempPath
	})
}
// #endif

/**
 * 选择图片后新增表情（校验 → 保存图片 → 落库）
 * @param {string} tempPath uni.chooseImage 返回的临时路径
 * @param {string} name 表情名
 * @returns {Promise<object>} 新增的表情副本
 */
export async function addEmoji(tempPath, name) {
	const v = validateEmojiName(name)
	if (!v.ok) throw new Error(v.reason)
	if (!tempPath) throw new Error('未选择图片')
	const src = await _saveEmojiImage(tempPath)
	if (!src) throw new Error('图片保存失败，请换一张图片重试')
	return addEmojiData(name, src)
}

/** 修改表情名（唯一性校验排除自身） */
export function renameEmoji(id, newName) {
	const v = validateEmojiName(newName, id)
	if (!v.ok) throw new Error(v.reason)
	_ensureLoaded()
	const e = _emojis.find((x) => x.id === id)
	if (!e) throw new Error('表情不存在')
	e.name = newName.trim()
	_persist()
	return { ...e }
}

/** 删除表情（顺带清理已保存的图片文件），不存在返回 false */
export function deleteEmoji(id) {
	_ensureLoaded()
	const idx = _emojis.findIndex((e) => e.id === id)
	if (idx < 0) return false
	const [removed] = _emojis.splice(idx, 1)
	_persist()
	if (removed.src) {
		// #ifdef APP-PLUS || MP-WEIXIN
		uni.removeSavedFile({ filePath: removed.src, fail: () => { } })
		// #endif
	}
	return true
}

/** 新建正则：匹配 $表情名$ 占位（名 1~20 字，不含 $ 与换行） */
function _emojiTokenRe() {
	return /\$([^$\n]{1,20})\$/g
}

/** 提取文本中所有 $表情名$ 占位名（含清单外的未知名），供 LLM 回复校验使用 */
export function extractEmojiNames(text) {
	const names = []
	const re = _emojiTokenRe()
	let m
	while ((m = re.exec(String(text || ''))) !== null) names.push(m[1])
	return names
}

/**
 * 把消息文本按 $表情名$ 拆分为段数组（纯函数，供消息渲染与测试）。
 * @param {string} content 原始消息（可含 $名$ 占位）
 * @param {Object} [map] 表情名 → 图片（getEmojiMap() 的结果）
 * @returns {Array<{type:'text', text:string}|{type:'emoji', name:string, src:string}>}
 *          清单外的未知 $名$ 原样保留在文本段中
 */
export function splitEmojiText(content, map) {
	const text = String(content || '')
	const out = []
	const re = _emojiTokenRe()
	let last = 0
	let m
	while ((m = re.exec(text)) !== null) {
		const name = m[1]
		if (last < m.index) out.push({ type: 'text', text: text.slice(last, m.index) })
		const src = map && map[name]
		out.push(src ? { type: 'emoji', name, src } : { type: 'text', text: m[0] })
		last = re.lastIndex
	}
	if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
	return out
}
