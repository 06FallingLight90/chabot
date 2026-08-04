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
	getSetting,
	setSetting,
	getScene,
	setScene
} from './storage.js'
import { MemoryStore } from './memory.js'
import { buildSystemPrompt, buildNowText, getPersonalityById, getPersonaName } from './prompts.js'
import { chatCompletion } from './llm.js'

export const memoryStore = new MemoryStore()

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
		personalityId,
		customPrompt: getSetting('customPrompt', ''),
		timeMode: getSetting('timeMode', 'real'), // 情景时间模式：real 现实时间 / virtual 虚拟时间
		personaName: getPersonaName(personalityId)
	}
}

/** 保存设置 */
export function saveSettings(s) {
	setSetting('baseUrl', (s.baseUrl || '').trim())
	setSetting('apiKey', (s.apiKey || '').trim())
	setSetting('model', (s.model || '').trim())
	setSetting('temperature', String(s.temperature))
	setSetting('personalityId', s.personalityId)
	setSetting('customPrompt', s.customPrompt || '')
	setSetting('timeMode', s.timeMode === 'virtual' ? 'virtual' : 'real')
}

/** 聊天页历史（返回副本，避免 UI 直接改坏存储数组） */
export function getHistoryForUI() {
	return getChatRows().slice()
}

/** 清空对话 */
export function clearConversation() {
	clearChat()
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
	rows.splice(cutIdx, rows.length - cutIdx)
	// 落盘：全量重写 storage
	if (typeof uni !== 'undefined' && uni.setStorageSync) {
		try { uni.setStorageSync('chabot_chat_history', rows) } catch (e) {}
	}
	return lastUser
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

	// 2. 组装 system prompt（人格 + 规则 + 记忆指南 + 情景指南 + 当前状态 + 记忆）
	// 仅"现实时间"模式注入当前真实时间供情景判断；虚拟时间模式不发送
	const personalityPrompt =
		s.personalityId === 'custom' ? s.customPrompt : getPersonalityById(s.personalityId).prompt
	const system = buildSystemPrompt(
		personalityPrompt || '你是友好的聊天伙伴。',
		memoryText,
		getScene(),
		s.timeMode === 'virtual' ? '' : buildNowText()
	)

	// 3. 组装 messages：system + 历史 + 当前用户消息
	const messages = [{ role: 'system', content: system }]
	for (const h of getChatRows().slice(-HISTORY_ENTRIES)) {
		messages.push({ role: h.role, content: h.content })
	}
	messages.push({ role: 'user', content: userText })

	// 4. 调用 LLM
	const reply = await chatCompletion({
		baseUrl: s.baseUrl,
		apiKey: s.apiKey,
		model: s.model,
		messages,
		temperature: s.temperature
	})

	// 5. 落库对话
	addChatRow('user', userText)
	addChatRow('assistant', reply.text)

	// 6. 解析 Scene / Memory 行：Scene 更新当前情景，Memory 入库，均从展示文本剔除
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
	if (newScene) setScene(newScene)
	const cleanReply = cleanLines.join('\n').trim()

	// 7. 定期维护（L3 过期清理 / 降级 / 容量控制）
	memoryStore.maintenance()

	return { reply: cleanReply || '…', saved }
}
