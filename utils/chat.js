/**
 * 聊天服务 —— 编排一次完整对话：
 * 检索记忆 → 组装 system（人格 + 记忆指南 + 记忆上下文）→ 调用 LLM →
 * 落库对话 → 解析 Memory 行入库 → 定期维护
 */

import {
	initStorage,
	getChatRows,
	addChatRow,
	clearChat,
	truncateChat,
	getSetting,
	setSetting,
	getSceneHistory,
	setScene,
	getConversations,
	getActiveConversationId,
	createConversation,
	switchConversation,
	deleteConversation,
	getConversationCompression,
	setConversationCompression,
	getConversationPersonality,
	getConversationSettingsRaw,
	setConversationSettingsRaw,
	duplicateConversationToNew,
	duplicateMemoriesToNew,
	truncateSceneHistory
} from './storage.js'
import { MemoryStore, parseMemoryLine } from './memory.js'
import { buildSystemPrompt, buildNowText, getPersonalityById, getPersonaName } from './prompts.js'
import { chatCompletion } from './llm.js'
import { addLog } from './log.js'
import { getEmojiMap, emojiListForPrompt, extractEmojiNames } from './emojis.js'

export const memoryStore = new MemoryStore()

const HISTORY_ENTRIES = 15 // 每轮注入的对话历史条数（上限）
const MAINTENANCE_INTERVAL_MS = 30 * 60 * 1000 // 维护节流间隔（30 分钟）
const COMPRESS_KEEP_TAIL = 10 // 压缩时保留的最近完整消息条数
const COMPRESS_MIN_NEW = 4 // 每次压缩至少新增这么多条才执行
const COMPRESS_CHUNK = 80 // 单次压缩请求处理的最大消息条数（超出分批多次调用）
const COMPRESS_SYSTEM = `你是对话压缩助手。把对话压缩成一份精炼概要，用于替代原文作为后续上下文。
要求：保留关键事实、用户偏好、已做的决定、约定和正在进行的事；保留重要人物/时间/地点信息；
用中文，150 字以内，只输出概要本身，不要解释、不要分段标题。`

/** 初始化存储（幂等，App.vue onLaunch 调用） */
export function initChatService() {
	initStorage()
	memoryStore.maintenance()
	setSetting('lastMaintenance', new Date().toISOString())
}

/**
 * 节流维护：距离上次维护超过间隔才执行（App 进入前台 / 页面 onShow 调用）。
 * 对话后的主动维护仍走 memoryStore.maintenance()，不受此限制。
 */
export function maybeMaintenance() {
	const last = getSetting('lastMaintenance', '')
	if (last) {
		const t = Date.parse(last)
		if (!Number.isNaN(t) && Date.now() - t < MAINTENANCE_INTERVAL_MS) return
	}
	memoryStore.maintenance()
	setSetting('lastMaintenance', new Date().toISOString())
}

/** 人格名称（含自定义，供 UI 展示） */
export function personaName(id) {
	return getPersonaName(id)
}

/** 全局默认设置（无设置快照的会话回退用；设置面板编辑的是当前会话设置） */
export function getSettings() {
	const personalityId = getSetting('personalityId', 'gentle')
	return {
		baseUrl: getSetting('baseUrl', 'https://api.openai.com/v1'),
		apiKey: getSetting('apiKey', ''),
		model: getSetting('model', 'gpt-5.4-mini'),
		temperature: parseFloat(getSetting('temperature', '0.8')),
		reasoningEffort: getSetting('reasoningEffort', 'none'), // 思考模式：none 关闭 / high 开启 / '' 跟随模型（Ollama 等兼容接口经 reasoning_effort 控制）
		personalityId,
		customPrompt: getSetting('customPrompt', ''),
		timeMode: getSetting('timeMode', 'real'), // 情景时间模式：real 现实时间 / virtual 虚拟时间
		compressInterval: parseInt(getSetting('compressInterval', '0'), 10) || 0, // 自动压缩间隔（条），0=关闭
		maxRequestAttempts: parseInt(getSetting('maxRequestAttempts', '5'), 10) || 5, // 回复格式不合格时的最大请求次数（重试上限）
		emojiEnabled: getSetting('emojiEnabled', true) !== false, // 聊天表情包开关：关闭后请求不携带表情清单
		personaName: getPersonaName(personalityId)
	}
}

/** 归一化设置对象（saveSettings / saveConversationPersonality / 新对话复制统一调用） */
function normalizeSettings(s) {
	return {
		baseUrl: String(s && s.baseUrl ? s.baseUrl : '').trim(),
		apiKey: String(s && s.apiKey ? s.apiKey : '').trim(),
		model: String(s && s.model ? s.model : '').trim(),
		temperature: Number.isFinite(parseFloat(s && s.temperature)) ? parseFloat(s.temperature) : 0.8,
		reasoningEffort: (s && s.reasoningEffort) || '',
		personalityId: (s && s.personalityId) || 'gentle',
		customPrompt: String(s && s.customPrompt ? s.customPrompt : '').trim(),
		timeMode: s && s.timeMode === 'virtual' ? 'virtual' : 'real',
		compressInterval: parseInt(s && s.compressInterval, 10) || 0,
		maxRequestAttempts: Math.max(1, Math.min(20, parseInt(s && s.maxRequestAttempts, 10) || 5)),
		emojiEnabled: !s || s.emojiEnabled !== false
	}
}

/** 保存设置到当前会话（每个对话独享一份设置，设置面板与之同步） */
export function saveSettings(s) {
	setConversationSettingsRaw(normalizeSettings(s))
}

/**
 * 当前会话生效设置 = 会话设置快照（无快照回退全局；旧数据兼容仅人格子集的快照）。
 * 每个会话独立一套完整设置，切换会话即切换设置。
 */
export function getConversationSettings() {
	const s = getSettings()
	const raw = getConversationSettingsRaw()
	if (raw) {
		const merged = { ...s, ...raw }
		merged.temperature = Number.isFinite(parseFloat(raw.temperature)) ? parseFloat(raw.temperature) : s.temperature
		merged.compressInterval = parseInt(raw.compressInterval, 10) || 0
		merged.maxRequestAttempts = Math.max(1, Math.min(20, parseInt(raw.maxRequestAttempts, 10) || 5))
		merged.personaName = getPersonaName(merged.personalityId || s.personalityId)
		return merged
	}
	// 旧数据：会话仅存人格子集（personalityId/customPrompt/timeMode）
	const p = getConversationPersonality()
	return {
		...s,
		personalityId: (p && p.personalityId) || s.personalityId,
		customPrompt: p && p.customPrompt !== undefined ? p.customPrompt : s.customPrompt,
		timeMode: (p && p.timeMode) || s.timeMode,
		personaName: getPersonaName((p && p.personalityId) || s.personalityId)
	}
}

/**
 * 保存当前会话的人格设置（写入会话设置快照，仅作用于当前对话，不影响其他会话）。
 * timeMode 可选：不传则沿用当前会话生效的模式，保持会话内的情景时间设置不漂移。
 */
export function saveConversationPersonality(personalityId, customPrompt, timeMode) {
	const s = getConversationSettings()
	setConversationSettingsRaw(
		normalizeSettings({
			...s,
			personalityId,
			customPrompt: personalityId === 'custom' ? (customPrompt || '') : '',
			timeMode: timeMode !== undefined ? timeMode : s.timeMode
		})
	)
	addLog('info', '会话人格', `${getPersonaName(personalityId)}${personalityId === 'custom' ? '（自定义）' : ''}`)
}

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

let _lastRequest = '' // 最近一次请求内容缓存，"重新生成"直接重发（不重复落库用户消息）

/** 同步请求缓存到当前会话的最后一条用户消息（切会话/清空后调用，避免跨会话重发错内容） */
function syncLastRequest() {
	const rows = getChatRows()
	for (let i = rows.length - 1; i >= 0; i--) {
		if (rows[i].role === 'user') {
			_lastRequest = rows[i].content
			return
		}
	}
	_lastRequest = ''
}

/**
 * 用户点"重新生成"时调用：移除待重发请求对应的最后一条助手回复（撤回其情景与记忆）。
 * 返回待重发内容——优先取最近一次请求缓存，无缓存（如重启后）回退到当前会话最后一条用户消息；
 * 若无可重发内容则返回空串。用户消息保留在存储中，重发（persistUser:false）不再重复落库。
 */
export function popLastAssistant() {
	const rows = getChatRows()
	// 待重发内容：最近一次请求缓存优先；无缓存（如重启后）回退到最后一条用户消息
	let req = _lastRequest
	if (!req) {
		for (let i = rows.length - 1; i >= 0; i--) {
			if (rows[i].role === 'user') {
				req = rows[i].content
				break
			}
		}
	}
	if (!req) return ''
	// 定位该请求对应的最后一条用户消息（从后往前匹配，取最近一次），
	// 若紧随其后有 assistant 回复则移除并撤回其情景/记忆；发送失败时无回复可移，仅重发
	for (let i = rows.length - 1; i >= 0; i--) {
		if (rows[i].role === 'user' && rows[i].content === req) {
			const reply = rows[i + 1]
			if (reply && reply.role === 'assistant') {
				rollbackAssistantEffects(reply)
				truncateChat(i + 1)
			}
			break
		}
	}
	addLog('info', '重新生成', `重发最近一次请求：${req.slice(0, 20)}`)
	return req
}

/** 撤回一条响应记录附带的情景与记忆变更（重新生成前调用） */
function rollbackAssistantEffects(row) {
	const rb = row && row.rollback
	if (!rb) return
	// 情景：截断到该响应之前的情景历史长度，撤掉本响应新增的情景
	if (typeof rb.sceneLenBefore === 'number') {
		truncateSceneHistory(rb.sceneLenBefore)
	}
	// 记忆：按写入顺序逆序撤销（新增→删除 / 修改→恢复原值 / 删除→重新插入）
	const undos = rb.memoryUndos
	if (Array.isArray(undos) && undos.length) {
		for (let i = undos.length - 1; i >= 0; i--) memoryStore.applyUndo(undos[i])
	}
	addLog('info', '撤回响应情景与记忆', `情景截断到 ${rb.sceneLenBefore}，撤销记忆 ${(undos && undos.length) || 0} 条`)
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

// ---------- 上下文压缩 ----------

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

/**
 * 发送一条用户消息
 * @param {string} userText
 * @param {{persistUser?: boolean}} [opts] persistUser=false 表示"重新生成"重发：
 *        用户消息已在首次发送时落库，本次只更新回复，避免重复记录同一句话
 * @returns {Promise<{reply:string, saved:number}>} reply 为清理掉 Memory 行后的回复
 */
export async function sendMessage(userText, opts = {}) {
	// 设置全部取当前会话（每个对话独享一份设置：API 配置 / 人格 / 时间模式等）
	const persistUser = opts.persistUser !== false
	const s = getConversationSettings()
	if (!s.apiKey) throw new Error('请先在「设置」中填写 API Key')
	if (!s.baseUrl) throw new Error('请先在「设置」中填写接口地址')
	if (!s.model) throw new Error('请先在「设置」中填写模型名称')

	// 缓存最近一次请求：聊天页"重新生成"直接重发该内容（重发时 persistUser:false，不重复落库用户消息）
	_lastRequest = userText

	// 记录发送前的情景历史长度：若本响应更新了情景，重新生成时据此撤回
	const sceneLenBefore = getSceneHistory().length

	// 1. 检索记忆（核心槽 + 新鲜槽 + MMR 多样性槽）
	const memoryText = memoryStore.retrieveContext(userText)
	addLog('info', '发送消息', userText.slice(0, 40))

	// 2. 组装 system prompt（人格 + 规则 + 记忆指南 + 情景指南 + 当前状态 + 记忆 + 表情包清单）
	const personalityPrompt =
		s.personalityId === 'custom' ? s.customPrompt : getPersonalityById(s.personalityId).prompt
	const system = buildSystemPrompt(
		personalityPrompt || '你是友好的聊天伙伴。',
		memoryText,
		getSceneHistory(),
		s.timeMode === 'virtual' ? '' : buildNowText(),
		// 表情包开关：禁用时不传清单（buildSystemPrompt 不注入表情包规则，LLM 不会主动使用表情）
		s.emojiEnabled ? emojiListForPrompt() : []
	)

	// 3-5. 请求 → 格式校验 → 解析：回复格式不合格时自动重试（上限 maxRequestAttempts）。
	// 每次尝试都基于同一份历史重新组装；校验通过才写入 Scene/Memory 并落库，失败尝试无副作用。
	const maxAttempts = Math.max(1, Math.min(20, parseInt(s.maxRequestAttempts, 10) || 5))
	let result = null
	let lastReason = ''
	// 任一尝试失败（网络错误 / 格式校验达上限）都只记录用户请求、不落库错误回复，
	// 聊天页"重新生成"基于最近一次请求缓存直接重发
	try {
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			// 组装 messages：system + 未压缩历史 + 当前用户消息
			// 压缩概要并入首条 system 末尾，避免出现第二条 system 消息——Ollama 等模板要求
			// system 必须在 messages 最前且只能一条，多条 system 会抛 "System message must be at the beginning"
			const { summary, compressedUntil } = getConversationCompression()
			const messages = [
				{ role: 'system', content: summary ? `${system}\n\n此前对话概要：${summary}` : system }
			]
			for (const h of getChatRows().slice(compressedUntil).slice(-HISTORY_ENTRIES)) {
				messages.push({ role: h.role, content: h.content })
			}
			messages.push({ role: 'user', content: userText })

			const reply = await chatCompletion({
				baseUrl: s.baseUrl,
				apiKey: s.apiKey,
				model: s.model,
				messages,
				temperature: s.temperature,
				reasoningEffort: s.reasoningEffort // 默认关闭思考（none），本地思考模型（如 Qwen3.5）默认思考会占满输出 token 导致回复为空
			})

			const parsed = parseAndValidateReply(reply.text)
			if (parsed.ok) {
				result = parsed
				break
			}
			lastReason = parsed.reason
			addLog('info', '回复格式不合格，自动重试', `第 ${attempt}/${maxAttempts} 次：${lastReason}`)
		}
		if (!result) {
			addLog('err', '回复格式不合格（已达请求上限）', `最大请求次数 ${maxAttempts}：${lastReason}`)
			throw new Error(`模型回复格式连续 ${maxAttempts} 次不合格（${lastReason}）`)
		}
	} catch (e) {
		// 发送失败：只落库用户请求（不落库错误回复），供"重新生成"定位本次请求
		if (persistUser) addChatRow('user', userText)
		throw e
	}

	// 6. 落库对话：落库清理后的文本，Scene/Memory 标记不再混入历史——否则从其它页切回时
	// 重新加载历史会把标记显示在气泡里（此前 bug），也会污染上下文压缩。
	// assistant 行附带 rollback 信息（响应前的情景长度 + 本响应的记忆撤销清单），
	// 重新生成时据此撤回该响应记录的情景与记忆。
	if (persistUser) addChatRow('user', userText)
	addChatRow('assistant', result.cleanReply || '…', {
		rollback: { sceneLenBefore, memoryUndos: result.memoryUndos || [] }
	})
	if (result.newScene) {
		setScene(result.newScene)
		addLog('info', '情景更新', result.newScene)
	}
	if (result.saved > 0) addLog('info', `记忆入库 ${result.saved} 条`)

	// 7. 定期维护（L3 过期清理 / 降级 / 容量控制）
	memoryStore.maintenance()

	// 8. 自动压缩检查（异步执行，不阻塞回复展示）
	maybeCompress().catch(() => { })

	return { reply: result.cleanReply || '…', saved: result.saved }
}

/**
 * 校验 LLM 回复格式并解析 Scene/Memory（校验通过才写库，供 sendMessage 重试使用）：
 * - 回复必须包含对话文本（仅 Scene/Memory 标记视为不合格）
 * - Scene 行必须有内容；Memory 行必须能被 parseMemoryLine 解析
 * @param {string} text LLM 原始回复
 * @returns {{ok:boolean, reason?:string, saved?:number, newScene?:string|null, cleanReply?:string}}
 */
function parseAndValidateReply(text) {
	// 表情名校验：回复中的 $名$ 必须存在于表情清单，否则判定格式不合格触发重试
	// （避免 LLM 编造清单外的名字导致聊天页渲染出"坏图"）
	const emojiMap = getEmojiMap()
	for (const name of extractEmojiNames(text)) {
		if (!emojiMap[name]) return { ok: false, reason: `回复包含未知表情名：${name}` }
	}
	const lines = String(text || '').split('\n')
	// 第一步：格式校验（不写入）
	let newScene = null
	let hasContent = false
	const cleanLines = []
	for (const line of lines) {
		if (/^\s*Scene\s*[:：]/i.test(line)) {
			newScene = line
				.replace(/^\s*Scene\s*[:：]\s*/i, '')
				.replace(/^["'""'']+|["'""'']+$/g, '') // 去掉 LLM 可能加上的引号
				.replace(/[。！!]$/, '')              // 去掉末尾标点
				.trim()
			if (!newScene) return { ok: false, reason: 'Scene 行内容为空' }
			continue
		}
		if (/^\s*Memory\s*[:：]/i.test(line)) {
			if (!parseMemoryLine(line)) return { ok: false, reason: `Memory 行格式非法：${line.trim().slice(0, 24)}` }
			continue
		}
		// 行内 Scene/Memory 标记（如 "正文 [Scene: xxx]"）：Scene/Memory 必须独立成行，
		// 行首形式已在上方分支处理，走到这里仍含 Scene:/Memory: 即未独立成行 → 判定格式非法
		if (/Scene\s*[:：]/i.test(line) || /Memory\s*[:：]/i.test(line)) {
			return { ok: false, reason: `Scene/Memory 标记未独立成行：${line.trim().slice(0, 28)}` }
		}
		// 疑似 Memory 行：含 | keywords:/| importance:/| level: 分段结构却缺少 Memory: 前缀
		// （如 "✅ 更新：3. xxx | keywords:.. | importance:.. | level:.."），判定格式非法并触发重试
		if (/\|\s*(?:keywords|importance|level):/i.test(line)) {
			return { ok: false, reason: `疑似 Memory 行缺少 Memory: 前缀：${line.trim().slice(0, 28)}` }
		}
		cleanLines.push(line)
		if (line.trim()) hasContent = true
	}
	if (!hasContent) return { ok: false, reason: '回复仅含 Scene/Memory 标记，无对话文本' }
	const cleanReply = cleanLines.join('\n').trim()

	// 第二步：校验通过，执行写入（Scene 更新情景 / Memory 入库），并收集撤销信息供重新生成回滚
	let saved = 0
	const memoryUndos = []
	for (const line of lines) {
		if (/^\s*Memory\s*[:：]/i.test(line)) {
			const undo = memoryStore.saveFromLine(line)
			if (undo) {
				saved++
				memoryUndos.push(undo)
			}
		}
	}
	return { ok: true, saved, newScene, cleanReply, memoryUndos }
}
