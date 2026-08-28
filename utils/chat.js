/**
 * 聊天服务 —— 门面 + 消息域：
 * 对外统一导出（其余域拆分至 chat-settings / chat-conversations / chat-compress），
 * 本文件承载发送主链路：检索记忆 → 组装 system → 调用 LLM → 落库 → 维护，
 * 以及"重新生成"的撤回逻辑与回复格式校验。
 */

import {
	initStorage,
	getChatRows,
	addChatRow,
	truncateChat,
	getSetting,
	setSetting,
	getSceneHistory,
	setScene,
	truncateSceneHistory,
	getConversationCompression
} from './storage.js'
import { memoryStore, lastRequest } from './chat-state.js'
import {
	personaName,
	getSettings,
	saveSettings,
	getConversationSettings,
	saveConversationPersonality
} from './chat-settings.js'
import {
	getHistoryForUI,
	clearConversation,
	listConversations,
	activeConversationId,
	startNewConversation,
	openConversation,
	removeConversation,
	copyConversationToNew,
	copyMemoriesToNew
} from './chat-conversations.js'
import { compressContext, maybeCompress } from './chat-compress.js'
import { parseMemoryLine } from './memory.js'
import { buildSystemPrompt, buildNowText, getPersonalityById } from './prompts.js'
import { chatCompletion } from './llm.js'
import { addLog } from './log.js'
import { getEmojiMap, emojiListForPrompt, extractEmojiNames } from './emojis.js'

// ---------- 对外统一导出（门面） ----------
// chat.js 保持为唯一入口，各调用方（页面/工具/测试）的导入路径不变

export {
	memoryStore,
	personaName,
	getSettings,
	saveSettings,
	getConversationSettings,
	saveConversationPersonality,
	getHistoryForUI,
	clearConversation,
	listConversations,
	activeConversationId,
	startNewConversation,
	openConversation,
	removeConversation,
	copyConversationToNew,
	copyMemoriesToNew,
	compressContext,
	maybeCompress
}

// ---------- 消息域 ----------

const HISTORY_ENTRIES = 15 // 每轮注入的对话历史条数（上限）
const MAINTENANCE_INTERVAL_MS = 30 * 60 * 1000 // 维护节流间隔（30 分钟）

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

/**
 * 用户点"重新生成"时调用：移除待重发请求对应的最后一条助手回复（撤回其情景与记忆）。
 * 返回待重发内容——优先取最近一次请求缓存，无缓存（如重启后）回退到当前会话最后一条用户消息；
 * 若无可重发内容则返回空串。用户消息保留在存储中，重发（persistUser:false）不再重复落库。
 */
export function popLastAssistant() {
	const rows = getChatRows()
	// 待重发内容：最近一次请求缓存优先；无缓存（如重启后）回退到最后一条用户消息
	let req = lastRequest.value
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
	// 若其后有 assistant 回复则移除并撤回其情景/记忆（拟真模式 burst 为连续多条 assistant 行，
	// 一并移除，rollback 挂在最后一行）；发送失败时无回复可移，仅重发
	for (let i = rows.length - 1; i >= 0; i--) {
		if (rows[i].role === 'user' && rows[i].content === req) {
			let last = i
			while (last + 1 < rows.length && rows[last + 1].role === 'assistant') last++
			if (last > i) {
				rollbackAssistantEffects(rows[last])
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
	// 拟真聊天：该会话开启后，所有回复均受"每条 ≤1 句、连续表情 ≤2"约束，并按换行拆分为多条气泡
	const proactive = !!s.proactiveEnabled

	// 缓存最近一次请求：聊天页"重新生成"直接重发该内容（重发时 persistUser:false，不重复落库用户消息）
	lastRequest.value = userText

	// 记录发送前的情景历史长度：若本响应更新了情景，重新生成时据此撤回
	const sceneLenBefore = getSceneHistory().length

	// 1. 检索记忆（全量 L1 + 新鲜槽 + MMR 多样性槽）
	const memoryText = memoryStore.retrieveContext(userText)
	addLog('info', '发送消息', userText.slice(0, 40))

	// 2. 组装 system prompt（人格 + 规则 + 记忆指南 + 情景指南 + 当前状态 + 记忆 + L1 容量 + 表情包清单）
	const personalityPrompt =
		s.personalityId === 'custom' ? s.customPrompt : getPersonalityById(s.personalityId).prompt
	const system = buildSystemPrompt(
		personalityPrompt || '你是友好的聊天伙伴。',
		memoryText,
		getSceneHistory(),
		s.timeMode === 'virtual' ? '' : buildNowText(),
		// 表情包开关：禁用时不传清单（buildSystemPrompt 不注入表情包规则，LLM 不会主动使用表情）
		s.emojiEnabled ? emojiListForPrompt() : [],
		// L1 容量状态：引导 LLM 在 L1 满员时先逐字删除/修改旧 L1 再新增
		memoryStore.l1Usage(),
		// 拟真聊天：注入每条消息 ≤1 句的规则（开启时生效）
		proactive
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

			const parsed = parseAndValidateReply(reply.text, { proactive })
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
	// 拟真模式：按换行拆分多条落库（每条 ≤1 句一条气泡），rollback 挂在最后一行
	if (persistUser) addChatRow('user', userText)
	const cleanReply = result.cleanReply || '…'
	const rollback = { sceneLenBefore, memoryUndos: result.memoryUndos || [] }
	if (proactive) {
		const lines = cleanReply.split('\n').map((l) => l.trim()).filter(Boolean)
		if (!lines.length) lines.push('…')
		lines.forEach((line, idx) => {
			addChatRow('assistant', line, idx === lines.length - 1 ? { rollback } : undefined)
		})
	} else {
		addChatRow('assistant', cleanReply, { rollback })
	}
	if (result.newScene) {
		setScene(result.newScene)
		addLog('info', '情景更新', result.newScene)
	}
	if (result.saved > 0) addLog('info', `记忆入库 ${result.saved} 条`)

	// 7. 定期维护（L3 过期清理 / 降级 / 容量控制）
	memoryStore.maintenance()

	// 8. 自动压缩检查（异步执行，不阻塞回复展示）
	maybeCompress().catch(() => { })

	return { reply: cleanReply, saved: result.saved, burst: proactive ? cleanReply.split('\n').map((l) => l.trim()).filter(Boolean) : undefined }
}

/**
 * 统计文本句子数：按句末标点（。！？!?…）计，连续标点（如"哈哈。。"）合并为一处，
 * 用于拟真聊天"每条消息 ≤1 句"的校验。
 * @param {string} text
 * @returns {number}
 */
export function countSentences(text) {
	const t = String(text || '').trim()
	if (!t) return 0
	let runs = 0
	let inRun = false
	for (const ch of t) {
		if ('。！？!?…'.includes(ch)) {
			if (!inRun) {
				runs++
				inRun = true
			}
		} else {
			inRun = false
		}
	}
	return runs
}

/**
 * 校验 LLM 回复格式并解析 Scene/Memory（校验通过才写库，供 sendMessage 重试使用）：
 * - 回复必须包含对话文本（仅 Scene/Memory 标记视为不合格）
 * - Scene 行必须有内容；Memory 行必须能被 parseMemoryLine 解析
 * - 拟真模式（proactive:true）：每条文本行 ≤1 句、连续表情 ≤2，不合格触发重试
 * @param {string} text LLM 原始回复
 * @param {{proactive?: boolean}} [opts]
 * @returns {{ok:boolean, reason?:string, saved?:number, newScene?:string|null, cleanReply?:string, memoryUndos?:Array}}
 */
export function parseAndValidateReply(text, opts) {
	const proactive = !!(opts && opts.proactive)
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
		// 拟真模式：每条消息（一行）≤1 句、连续表情 ≤2，超出即判定格式不合格触发重试
		if (proactive) {
			if (countSentences(line) > 1) {
				return { ok: false, reason: `拟真模式消息超过一句话：${line.trim().slice(0, 20)}` }
			}
			if (extractEmojiNames(line).length > 2) {
				return { ok: false, reason: `拟真模式连续表情超过 2 个：${line.trim().slice(0, 20)}` }
			}
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
