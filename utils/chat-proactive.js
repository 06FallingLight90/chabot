/**
 * 聊天服务 —— 拟真聊天域：
 * 前台定时器调度（随机时间节点主动发消息）+ 回前台补发（catch-up）+ 主动消息发送链路。
 *
 * 生效条件（当前会话）：proactiveEnabled 开启 且 timeMode=real（现实时间）。
 * 低后台占用设计：单条链式 setTimeout（非轮询，空闲零唤醒），退后台**不清定时器**——
 * 单条 pending timeout 后台零 CPU；H5 隐藏标签页会被浏览器节流（约 1 次/分钟，够用）；
 * App 后台 JS 挂起时定时器不触发，回前台由 catchUpProactive 检测到期补发。
 *
 * 主动消息格式（与普通回复一致，由 parseAndValidateReply 强制校验）：
 * 每条 ≤1 句、连续表情 ≤2，多条消息用换行分隔；话题临近结束时模型用短句/表情收尾。
 */

import {
	getChatRows,
	addChatRow,
	getSceneHistory,
	setScene,
	getConversationCompression
} from './storage.js'
import { memoryStore } from './chat-state.js'
import { getConversationSettings } from './chat-settings.js'
import { buildSystemPrompt, buildNowText, getPersonalityById } from './prompts.js'
import { chatCompletion } from './llm.js'
import { addLog } from './log.js'
import { emojiListForPrompt } from './emojis.js'
import { maybeCompress } from './chat-compress.js'
import { parseAndValidateReply } from './chat.js'

// ---------- 常量 ----------

/** 频率档位 → 随机间隔区间（分钟） */
const LEVEL_RANGES = {
	low: [45, 120],
	medium: [15, 45],
	high: [5, 15]
}
const IDLE_CUTOFF_MS = 60 * 60 * 1000 // 距上次用户消息超过 60 分钟不再主动发（用户已离开）
const TICK_MAX_MS = 60 * 60 * 1000 // 单次定时最长 60 分钟：即使间隔更长也先醒一次，保证窗口/设置变化及时响应
const HISTORY_ENTRIES = 15 // 主动消息注入的对话历史条数（上限，与 sendMessage 一致）

// ---------- 状态 ----------

let _timer = null // 当前定时器
let _dueAt = 0 // 下一触发时刻（退后台期间保留，供回前台补发判断）
let _suppressed = false // 聊天页 loading 时抑制（等待 LLM 回复期间不打扰）
let _busy = false // 主动请求进行中（防止重入）

function _clearTimer() {
	if (_timer) {
		clearTimeout(_timer)
		_timer = null
	}
}

/** 聊天页同步 loading 状态：true 时调度器到期不发（用户在等 LLM 回复） */
export function setProactiveSuppressed(v) {
	const was = _suppressed
	_suppressed = !!v
	// 解除抑制时若调度器已失活（如 loading 期间到期未重排），立即重排，避免此后不再触发
	if (!_suppressed && was && !_timer) _schedule()
}

/**
 * 功能是否开启（与瞬时抑制无关）：开关 + 现实时间 + API 配置齐备。
 * 调度重排只看此项——只要功能开着就持续重排，loading 抑制只拦截"到期发送"不拦截重排，
 * 保证任何时序下调度器都不会失活（否则会表现为"等待调度"、只能重启恢复）。
 */
function _featureOn(s) {
	return !!(
		s &&
		s.proactiveEnabled === true &&
		s.timeMode === 'real' &&
		s.apiKey &&
		s.baseUrl &&
		s.model
	)
}

/** 当前会话是否具备主动发送的基本条件（功能开启 + 未被 loading 抑制） */
function _canRun(s) {
	return _featureOn(s) && !_suppressed
}

/** 最近一条用户消息时间（无则 0） */
function _lastUserAt() {
	const rows = getChatRows()
	for (let i = rows.length - 1; i >= 0; i--) {
		if (rows[i].role === 'user') return Date.parse(rows[i].created_at) || 0
	}
	return 0
}

/** 当前时刻是否在主动消息时段窗口内 */
function _inWindow(s) {
	return new Date().getHours() >= s.proactiveStartHour && new Date().getHours() < s.proactiveEndHour
}

/** 到期触发门禁（非调试）：时段窗口 + 已有用户消息 + 未超空闲冷却 */
function _canFire(s) {
	if (!_canRun(s)) return false
	if (!_inWindow(s)) return false
	const lastUserAt = _lastUserAt()
	if (!lastUserAt) return false
	if (Date.now() - lastUserAt > IDLE_CUTOFF_MS) return false
	return true
}

/** 下次触发延迟（ms）：调试用自定义倒计时（proactiveCustomSeconds>0）优先；否则窗口外等到窗口起点、窗口内按档位随机间隔。始终 ≥10s（自定义）或 ≥60s，防忙循环/防误触 API 轰炸 */
function _nextDelay(s) {
	const custom = parseInt(s && s.proactiveCustomSeconds, 10) || 0
	if (custom > 0) return Math.max(10000, custom * 1000)
	const d = new Date()
	const h = d.getHours()
	const [min, max] = LEVEL_RANGES[s.proactiveLevel] || LEVEL_RANGES.medium
	const toStart = (targetHour) => {
		// 从当前时刻算起到 targetHour 整点的毫秒数（同小时时为负，代表"已过该点"）
		return (targetHour - h) * 3600000 - d.getMinutes() * 60000 - d.getSeconds() * 1000 - d.getMilliseconds()
	}
	if (h < s.proactiveStartHour) {
		return Math.max(60000, toStart(s.proactiveStartHour))
	}
	if (h >= s.proactiveEndHour) {
		return Math.max(60000, toStart(s.proactiveStartHour + 24))
	}
	return Math.max(60000, (min + Math.random() * (max - min)) * 60000)
}

// ---------- 调度器 ----------

/** 毫秒 → "X 小时 Y 分" / "X 分 Y 秒" / "X 秒"（调度日志与倒计时展示用） */
function _fmtDuration(ms) {
	const total = Math.max(0, Math.ceil((ms || 0) / 1000))
	const h = Math.floor(total / 3600)
	const m = Math.floor((total % 3600) / 60)
	const s = total % 60
	if (h > 0) return `${h} 小时 ${m} 分`
	if (m > 0) return `${m} 分 ${String(s).padStart(2, '0')} 秒`
	return `${s} 秒`
}

/** 按当前会话设置安排下一次触发（清旧定时器后重排），并在调试日志记录调度状态。只看功能开关，抑制/时段只拦发送不拦重排 */
function _schedule() {
	_clearTimer()
	const s = getConversationSettings()
	if (!_featureOn(s)) return
	const delay = _nextDelay(s)
	_dueAt = Date.now() + delay
	_timer = setTimeout(_tick, Math.min(delay, TICK_MAX_MS))
	addLog('info', '拟真聊天调度', `下次主动消息：${_fmtDuration(delay)} 后（${s.proactiveLevel} 档）`)
}

function _tick() {
	_timer = null
	// _dueAt 为 0 说明已由 catchUp 补发过，此处不应再次触发（否则重复发送）
	if (_dueAt && Date.now() >= _dueAt) {
		_dueAt = 0
		// 到期触发；未满足门禁（抑制/时段/空闲）则跳过本次，等待下一轮
		sendProactiveBurst().catch(() => { })
	}
	_schedule()
}

/**
 * 下次主动消息倒计时（毫秒）；未调度（功能未开启/尚未重排）返回 null。
 * 供设置页调试区实时显示调度状态。
 */
export function getProactiveCountdown() {
	if (!_timer || !_dueAt) return null
	const s = getConversationSettings()
	if (!_featureOn(s)) return null
	return Math.max(0, _dueAt - Date.now())
}

/**
 * 回前台补发：若退后台期间已到触发时刻，立即补发一次；随后按当前会话设置重排。
 * 幂等，可随时调用（切会话/改设置后用于让调度器立即按新状态重排）。
 */
export function catchUpProactive() {
	const s = getConversationSettings()
	if (!_featureOn(s)) {
		// 功能关闭（关闭拟真/切到虚拟时间/未配 API）：清掉在途定时器，避免残留的 no-op 触发
		_clearTimer()
		_dueAt = 0
		return
	}
	if (_dueAt && Date.now() >= _dueAt) {
		// 清掉即将到期的旧定时器，避免其随后再触发一次造成重复发送，并立即重排
		_clearTimer()
		_dueAt = 0
		sendProactiveBurst().catch(() => { })
	}
	if (!_timer) _schedule()
}

/**
 * 立即按当前会话设置重排下一次触发（修改倒计时/档位/时段/切会话后调用）。
 * 与 catchUpProactive 不同：即使定时器已挂载也强制重算（catchUp 为保持跨页倒计时不重置而跳过）。
 */
export function rearmProactive() {
	_schedule()
}

// ---------- 主动消息发送 ----------

/**
 * 发送一条主动消息（拟真 burst）：组装 system（含拟真规则）+ 最近历史，调 LLM，
 * 校验后按换行拆多条落库（Scene/Memory 由校验写入），通知聊天页刷新。
 * @param {{force?: boolean}} [opts] force=true 用于调试按钮：忽略时段/空闲/间隔门禁，仅校验 API 配置
 * @returns {Promise<{lines:string[], saved:number}|null>} 未满足触发条件返回 null
 */
export async function sendProactiveBurst(opts = {}) {
	const force = !!opts.force
	const s = getConversationSettings()
	// 基本条件（开关 + 现实时间 + 未抑制）仅非调试时要求；调试按钮忽略开关/时段/空闲/抑制，但仍要求 API 配置
	if (!force && !_canRun(s)) return null
	if (!s.apiKey || !s.baseUrl || !s.model) return null
	if (!force && !_canFire(s)) return null
	if (_busy) return null
	_busy = true
	try {
		// 组装 system（与 sendMessage 一致，proactive 注入拟真规则）
		const memoryText = memoryStore.retrieveContext('')
		const personalityPrompt =
			s.personalityId === 'custom' ? s.customPrompt : getPersonalityById(s.personalityId).prompt
		const system = buildSystemPrompt(
			personalityPrompt || '你是友好的聊天伙伴。',
			memoryText,
			getSceneHistory(),
			s.timeMode === 'virtual' ? '' : buildNowText(),
			s.emojiEnabled ? emojiListForPrompt() : [],
			memoryStore.l1Usage(),
			true
		)
		const { summary, compressedUntil } = getConversationCompression()
		const messages = [
			{ role: 'system', content: summary ? `${system}\n\n此前对话概要：${summary}` : system }
		]
		for (const h of getChatRows().slice(compressedUntil).slice(-HISTORY_ENTRIES)) {
			messages.push({ role: h.role, content: h.content })
		}
		// 末尾追加内部指令（仅请求，不落库）：让模型以"主动开口"的方式输出下一条消息
		messages.push({ role: 'user', content: '（内部指令：请作为 AI 主动开口给用户发消息，只输出这条主动消息本身）' })

		// 请求 → 拟真格式校验（每条 ≤1 句、连续表情 ≤2）→ 不合格自动重试
		const maxAttempts = Math.max(1, Math.min(20, parseInt(s.maxRequestAttempts, 10) || 5))
		let result = null
		let lastReason = ''
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			const reply = await chatCompletion({
				baseUrl: s.baseUrl,
				apiKey: s.apiKey,
				model: s.model,
				messages,
				temperature: s.temperature,
				reasoningEffort: s.reasoningEffort
			})
			const parsed = parseAndValidateReply(reply.text, { proactive: true })
			if (parsed.ok) {
				result = parsed
				break
			}
			lastReason = parsed.reason
			addLog('info', '主动消息格式不合格，自动重试', `第 ${attempt}/${maxAttempts} 次：${lastReason}`)
		}
		if (!result) {
			addLog('err', '主动消息格式不合格（已达请求上限）', `最大请求次数 ${maxAttempts}：${lastReason}`)
			throw new Error(`主动消息格式连续 ${maxAttempts} 次不合格（${lastReason}）`)
		}

		// 按换行拆分多条落库（每条 ≤1 句一条气泡），rollback 挂最后一行
		const lines = (result.cleanReply || '').split('\n').map((l) => l.trim()).filter(Boolean)
		if (!lines.length) lines.push('…')
		const sceneLenBefore = getSceneHistory().length
		const rollback = { sceneLenBefore, memoryUndos: result.memoryUndos || [] }
		lines.forEach((line, idx) => {
			addChatRow('assistant', line, idx === lines.length - 1 ? { rollback } : undefined)
		})
		if (result.newScene) {
			setScene(result.newScene)
			addLog('info', '主动消息情景更新', result.newScene)
		}
		if (result.saved > 0) addLog('info', `主动消息记忆入库 ${result.saved} 条`)
		memoryStore.maintenance()
		maybeCompress().catch(() => { })
		addLog('info', '主动消息已发送', lines.join(' / '))
		// 通知聊天页刷新（uni.$emit 在 App/H5/小程序均可用；Node 测试环境无此 API，跳过）
		if (typeof uni !== 'undefined' && uni.$emit) uni.$emit('proactive-burst', { lines })
		return { lines, saved: result.saved }
	} finally {
		_busy = false
	}
}

/** 调试按钮：立即发送一条主动消息（忽略时段/空闲/间隔门禁，仅校验 API 配置与开关） */
export async function debugProactiveMessage() {
	return sendProactiveBurst({ force: true })
}
