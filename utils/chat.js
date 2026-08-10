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
	setConversationPersonality,
	duplicateConversationToNew,
	duplicateMemoriesToNew
} from './storage.js'
import { MemoryStore } from './memory.js'
import { buildSystemPrompt, buildNowText, getPersonalityById, getPersonaName } from './prompts.js'
import { chatCompletion } from './llm.js'
import { addLog } from './log.js'

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

/** 当前设置 */
export function getSettings() {
	const personalityId = getSetting('personalityId', 'gentle')
	return {
		baseUrl: getSetting('baseUrl', 'https://api.openai.com/v1'),
		apiKey: getSetting('apiKey', ''),
		model: getSetting('model', 'gpt-4o-mini'),
		temperature: parseFloat(getSetting('temperature', '0.8')),
		reasoningEffort: getSetting('reasoningEffort', 'none'), // 思考模式：none 关闭 / high 开启 / '' 跟随模型（Ollama 等兼容接口经 reasoning_effort 控制）
		personalityId,
		customPrompt: getSetting('customPrompt', ''),
		timeMode: getSetting('timeMode', 'real'), // 情景时间模式：real 现实时间 / virtual 虚拟时间
		compressInterval: parseInt(getSetting('compressInterval', '0'), 10) || 0, // 自动压缩间隔（条），0=关闭
		personaName: getPersonaName(personalityId)
	}
}

/** 保存设置 */
export function saveSettings(s) {
	setSetting('baseUrl', (s.baseUrl || '').trim())
	setSetting('apiKey', (s.apiKey || '').trim())
	setSetting('model', (s.model || '').trim())
	setSetting('temperature', String(s.temperature))
	setSetting('reasoningEffort', s.reasoningEffort || '')
	setSetting('personalityId', s.personalityId)
	setSetting('customPrompt', s.customPrompt || '')
	setSetting('timeMode', s.timeMode === 'virtual' ? 'virtual' : 'real')
	setSetting('compressInterval', String(s.compressInterval || 0))
}

/**
 * 当前会话生效设置 = 全局 API 配置 + 会话人格快照（快照为空时回退全局人格）。
 * 每个会话独立记忆自己的人格设置，切换会话即切换人格。
 */
export function getConversationSettings() {
	const s = getSettings()
	const p = getConversationPersonality()
	const personalityId = (p && p.personalityId) || s.personalityId
	const customPrompt = p && p.customPrompt !== undefined ? p.customPrompt : s.customPrompt
	const timeMode = (p && p.timeMode) || s.timeMode
	return {
		...s,
		personalityId,
		customPrompt,
		timeMode,
		personaName: getPersonaName(personalityId)
	}
}

/** 把当前全局人格设置快照到当前会话 */
function snapshotPersonality() {
	const s = getSettings()
	setConversationPersonality({
		personalityId: s.personalityId,
		customPrompt: s.customPrompt || '',
		timeMode: s.timeMode
	})
}

/**
 * 保存当前会话的人格设置（写入会话快照，仅作用于当前对话，不影响全局与其他会话）。
 * timeMode 沿用当前会话生效的模式，保持会话内的情景时间设置不漂移。
 */
export function saveConversationPersonality(personalityId, customPrompt) {
	const s = getConversationSettings()
	setConversationPersonality({
		personalityId,
		customPrompt: personalityId === 'custom' ? (customPrompt || '') : '',
		timeMode: s.timeMode
	})
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
	addLog('info', '清空当前对话')
}

/**
 * 移除最后一条助手消息（用户点"重新生成"时调用）。
 * 返回被移除的上一条用户消息内容，供重发使用；若无可重发内容则返回空串。
 */
export function popLastAssistant() {
	const rows = getChatRows()
	// 从末尾往前找最后一个 assistant 消息，同时记录它前面的 user 消息
	let lastUser = ''
	let cutIdx = -1
	for (let i = rows.length - 1; i >= 0; i--) {
		if (rows[i].role === 'assistant' && cutIdx < 0) {
			cutIdx = i
		} else if (rows[i].role === 'user' && cutIdx >= 0) {
			lastUser = rows[i].content
			break
		}
	}
	if (cutIdx < 0) return ''
	// 移除 cutIdx 及之后所有行（即最新的 assistant + 可能之前的冗余）
	truncateChat(cutIdx)
	addLog('info', '重新生成', `截断到第 ${cutIdx} 条消息，重发：${lastUser.slice(0, 20)}`)
	return lastUser
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

/** 开始新对话：当前对话非空则归档并新建，否则复用并重置当前空对话；并快照当前人格设置 */
export function startNewConversation() {
	memoryStore.resetState()
	if (getChatRows().length) {
		createConversation()
		addLog('info', '开始新对话')
	} else {
		clearChat()
		addLog('info', '重置空对话')
	}
	snapshotPersonality()
}

/** 切换到指定会话（记忆与人格随会话切换，重置召回状态） */
export function openConversation(id) {
	const ok = switchConversation(id)
	if (ok) {
		memoryStore.resetState()
		addLog('info', '切换会话', id)
	}
	return ok
}

/** 删除指定会话 */
export function removeConversation(id) {
	const ok = deleteConversation(id)
	if (ok) {
		memoryStore.resetState()
		addLog('info', '删除会话', id)
	}
	return ok
}

/** 复制当前会话（消息+记忆+人格）到新会话并切换 */
export function copyConversationToNew() {
	duplicateConversationToNew()
	memoryStore.resetState()
	addLog('info', '复制对话到新会话')
}

/** 复制当前会话的记忆到新会话并切换 */
export function copyMemoriesToNew() {
	duplicateMemoriesToNew()
	memoryStore.resetState()
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

	const s = getSettings()
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
	const interval = getSettings().compressInterval
	if (!interval) return false
	const { compressedUntil } = getConversationCompression()
	if (getChatRows().length - compressedUntil < interval) return false
	addLog('info', '自动压缩触发', `间隔 ${interval} 条`)
	return compressContext()
}

/**
 * 发送一条用户消息
 * @param {string} userText
 * @returns {Promise<{reply:string, saved:number}>} reply 为清理掉 Memory 行后的回复
 */
export async function sendMessage(userText) {
	const s = getSettings()
	if (!s.apiKey) throw new Error('请先在「设置」中填写 API Key')
	if (!s.baseUrl) throw new Error('请先在「设置」中填写接口地址')
	if (!s.model) throw new Error('请先在「设置」中填写模型名称')

	// 1. 检索记忆（核心槽 + 新鲜槽 + MMR 多样性槽）
	const memoryText = memoryStore.retrieveContext(userText)
	addLog('info', '发送消息', userText.slice(0, 40))

	// 2. 组装 system prompt（人格 + 规则 + 记忆指南 + 情景指南 + 当前状态 + 记忆）
	// 人格/时间模式取当前会话快照；API 配置取全局
	const conv = getConversationSettings()
	const personalityPrompt =
		conv.personalityId === 'custom' ? conv.customPrompt : getPersonalityById(conv.personalityId).prompt
	const system = buildSystemPrompt(
		personalityPrompt || '你是友好的聊天伙伴。',
		memoryText,
		getSceneHistory(),
		conv.timeMode === 'virtual' ? '' : buildNowText()
	)

	// 3. 组装 messages：system + 未压缩历史 + 当前用户消息
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

	// 4. 调用 LLM
	const reply = await chatCompletion({
		baseUrl: s.baseUrl,
		apiKey: s.apiKey,
		model: s.model,
		messages,
		temperature: s.temperature,
		reasoningEffort: s.reasoningEffort // 默认关闭思考（none），本地思考模型（如 Qwen3.5）默认思考会占满输出 token 导致回复为空
	})

	// 5. 解析 Scene / Memory 行：Scene 更新当前情景，Memory 入库，均从展示文本剔除
	let saved = 0
	let newScene = null
	const cleanLines = []
	for (const line of reply.text.split('\n')) {
		if (/^\s*Scene\s*[:：]/i.test(line)) {
			newScene = line
				.replace(/^\s*Scene\s*[:：]\s*/i, '')
				.replace(/^["'""'']+|["'""'']+$/g, '') // 去掉 LLM 可能加上的引号
				.replace(/[。！!]$/, '')              // 去掉末尾标点
				.trim()
			continue
		}
		if (/^\s*Memory\s*[:：]/i.test(line)) {
			if (memoryStore.saveFromLine(line)) saved++
			continue
		}
		cleanLines.push(line)
	}
	if (newScene) {
		setScene(newScene)
		addLog('info', '情景更新', newScene)
	}
	if (saved > 0) addLog('info', `记忆入库 ${saved} 条`)
	let cleanReply = cleanLines.join('\n').trim()
	// 原始回复非空但清理后为空：模型只输出了 Scene/Memory 结构化标记行，未生成对话内容。
	// 明确提示用户，避免显示空白/省略号造成困惑（本地小模型可能出现此情况）。
	if (!cleanReply && reply.text && reply.text.trim()) {
		addLog(
			'info',
			'回复内容为空',
			`模型仅输出了 ${saved} 条记忆/${newScene ? '1' : '0'} 条情景标记，未生成对话文本\n--- 原始返回 ---\n${reply.text}`
		)
		cleanReply = '（模型仅输出了记忆/情景标记，未生成对话内容）'
	}

	// 6. 落库对话：落库清理后的文本，Scene/Memory 标记不再混入历史——否则从其它页切回时
	// 重新加载历史会把标记显示在气泡里（此前 bug），也会污染上下文压缩
	addChatRow('user', userText)
	addChatRow('assistant', cleanReply || '…')

	// 7. 定期维护（L3 过期清理 / 降级 / 容量控制）
	memoryStore.maintenance()

	// 8. 自动压缩检查（异步执行，不阻塞回复展示）
	maybeCompress().catch(() => { })

	return { reply: cleanReply || '…', saved }
}
