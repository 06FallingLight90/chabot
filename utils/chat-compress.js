/**
 * 聊天服务 —— 压缩域：
 * 把上文交给 LLM 压缩为概要（手动触发 / 每轮回复后自动检查）
 */

import { getChatRows, getConversationCompression, setConversationCompression } from './storage.js'
import { chatCompletion } from './llm.js'
import { addLog } from './log.js'
import { getConversationSettings } from './chat-settings.js'

const COMPRESS_KEEP_TAIL = 10 // 压缩时保留的最近完整消息条数
const COMPRESS_MIN_NEW = 4 // 每次压缩至少新增这么多条才执行
const COMPRESS_CHUNK = 80 // 单次压缩请求处理的最大消息条数（超出分批多次调用）
const COMPRESS_SYSTEM = `你是对话压缩助手。把对话压缩成一份精炼概要，用于替代原文作为后续上下文。
要求：保留关键事实、用户偏好、已做的决定、约定和正在进行的事；保留重要人物/时间/地点信息；
用中文，150 字以内，只输出概要本身，不要解释、不要分段标题。`

let _compressing = false

/**
 * 把上文交给 LLM 压缩为概要（手动或自动触发）。
 * 压缩范围：上次压缩进度之后、保留尾部之前的消息；超过单批上限时分批调用。
 * @param {boolean} force 手动触发传 true，忽略间隔/新增量限制
 * @returns {Promise<boolean>} 是否实际执行了压缩
 */
export async function compressContext(force = false) {
	if (_compressing) return false
	const rows = getChatRows()
	const keepTail = COMPRESS_KEEP_TAIL
	if (rows.length <= keepTail + COMPRESS_MIN_NEW) return false

	const { summary: prev, compressedUntil } = getConversationCompression()
	const since = Math.min(compressedUntil, rows.length - keepTail)
	const cut = Math.max(since, rows.length - keepTail)
	if (!force && cut - since < COMPRESS_MIN_NEW) return false
	if (cut <= since) return false

	const s = getConversationSettings()
	if (!s.apiKey || !s.baseUrl || !s.model) return false

	_compressing = true
	try {
		let merged = prev
		let cursor = since
		// 分批压缩，后一批把前一批的概要合并进来，避免单次请求过大
		while (cursor < cut) {
			const end = Math.min(cursor + COMPRESS_CHUNK, cut)
			const batch = rows.slice(cursor, end)
			const text = [
				merged ? `已有的对话概要：\n${merged}` : '',
				'以下是对话记录（越靠后越新）：',
				batch.map((r) => `${r.role === 'user' ? '用户' : '你'}：${r.content}`).join('\n'),
				'请把已有概要与新内容合并，输出一份完整的精炼概要。'
			].filter(Boolean).join('\n\n')
			const resp = await chatCompletion({
				baseUrl: s.baseUrl,
				apiKey: s.apiKey,
				model: s.model,
				messages: [
					{ role: 'system', content: COMPRESS_SYSTEM },
					{ role: 'user', content: text }
				],
				temperature: 0.3,
				maxTokens: 512,
				reasoningEffort: 'none' // 压缩任务简单，固定关闭思考，避免被思考 token 占满
			})
			const out = (resp.text || '').trim()
			if (!out) return false
			merged = out
			cursor = end
		}
		setConversationCompression(merged, cut)
		addLog(
			'info',
			'压缩上文',
			`压缩 ${cut - since} 条消息为概要（保留尾部 ${keepTail} 条）\n--- 压缩后上文 ---\n${merged}`
		)
		return true
	} catch (e) {
		addLog('err', '压缩上文失败', e.message)
		throw e
	} finally {
		_compressing = false
	}
}

/**
 * 自动压缩检查：距上次压缩新增消息达到间隔阈值则压缩。
 * 在每次对话回复落库后调用（异步、失败静默，不阻塞回复）。
 */
export async function maybeCompress() {
	if (_compressing) return false
	const interval = getConversationSettings().compressInterval
	if (!interval) return false
	const { compressedUntil } = getConversationCompression()
	if (getChatRows().length - compressedUntil < interval) return false
	addLog('info', '自动压缩触发', `间隔 ${interval} 条`)
	return compressContext()
}
