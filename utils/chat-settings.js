/**
 * 聊天服务 —— 设置域：
 * 全局默认设置读取 / 会话设置快照读写（每个对话独享一份）/ 会话人格保存
 */

import {
	getSetting,
	getConversationSettingsRaw,
	setConversationSettingsRaw,
	getConversationPersonality
} from './storage.js'
import { getPersonaName } from './prompts.js'
import { addLog } from './log.js'

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
		// 语音阅读（TTS）：默认关闭；开启后 LLM 新回复会自动合成语音播放
		ttsEnabled: getSetting('ttsEnabled', false) !== false,
		ttsApiKey: getSetting('ttsApiKey', ''),
		ttsModel: getSetting('ttsModel', 'qwen3-tts-flash'),
		ttsVoice: getSetting('ttsVoice', 'Cherry'),
		// 拟真聊天：仅现实时间模式生效；AI 在随机时间主动发消息（每条 ≤1 句、连续表情 ≤2）
		proactiveEnabled: getSetting('proactiveEnabled', false),
		proactiveStartHour: getSetting('proactiveStartHour', 9), // 主动消息时段起（时）
		proactiveEndHour: getSetting('proactiveEndHour', 23), // 主动消息时段止（时）
		proactiveLevel: getSetting('proactiveLevel', 'medium'), // 频率档位 low/medium/high
		proactiveCustomSeconds: parseInt(getSetting('proactiveCustomSeconds', '0'), 10) || 0, // 调试：自定义倒计时（秒），>0 时覆盖档位
		bubbleOpacity: (() => {
			const n = parseFloat(getSetting('bubbleOpacity', '1'))
			return Number.isFinite(n) ? Math.max(0.2, Math.min(1, n)) : 1
		})(), // 聊天气泡背景不透明度 0.2~1（1=不透明）
		personaName: getPersonaName(personalityId)
	}
}

/** 归一化设置对象（saveSettings / saveConversationPersonality / 新对话复制统一调用） */
export function normalizeSettings(s) {
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
		emojiEnabled: !s || s.emojiEnabled !== false,
		ttsEnabled: !s || s.ttsEnabled !== false,
		ttsApiKey: String(s && s.ttsApiKey ? s.ttsApiKey : '').trim(),
		ttsModel: String(s && s.ttsModel ? s.ttsModel : '').trim() || 'qwen3-tts-flash',
		ttsVoice: String(s && s.ttsVoice ? s.ttsVoice : '').trim() || 'Cherry',
		// 拟真聊天：开关默认关；时段钳制在 0-23；档位白名单
		proactiveEnabled: !!s && s.proactiveEnabled === true,
		proactiveStartHour: (() => {
			const n = parseInt(s && s.proactiveStartHour, 10)
			return Number.isNaN(n) ? 9 : Math.max(0, Math.min(23, n))
		})(),
		proactiveEndHour: (() => {
			const n = parseInt(s && s.proactiveEndHour, 10)
			return Number.isNaN(n) ? 23 : Math.max(0, Math.min(23, n))
		})(),
		proactiveLevel: ['low', 'medium', 'high'].includes(s && s.proactiveLevel) ? s.proactiveLevel : 'medium',
		// 自定义倒计时（秒）：0=用档位；钳制在 0-3600，供调试快速触发
		proactiveCustomSeconds: (() => {
			const n = parseInt(s && s.proactiveCustomSeconds, 10)
			return Number.isNaN(n) ? 0 : Math.max(0, Math.min(3600, n))
		})(),
		// 聊天气泡背景不透明度：钳制 0.2~1，1=完全不透明
		bubbleOpacity: (() => {
			const n = parseFloat(s && s.bubbleOpacity)
			return Number.isFinite(n) ? Math.max(0.2, Math.min(1, n)) : 1
		})()
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
		merged.ttsEnabled = raw.ttsEnabled === undefined ? s.ttsEnabled : raw.ttsEnabled !== false
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
