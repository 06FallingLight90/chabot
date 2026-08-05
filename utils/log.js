/**
 * 调试日志 —— 记录 LLM 请求/响应/错误及关键操作，供设置页「调试日志」面板查看。
 * 环形缓冲：超出 MAX_LOGS 条数时丢弃最旧日志，避免存储无限增长。
 *
 * 日志类型 type：
 *   req    LLM 请求
 *   res    LLM 响应
 *   err    错误
 *   info   其它操作
 */

const KEY_LOGS = 'chabot_debug_logs'
const MAX_LOGS = 200
const MAX_DETAIL_CHARS = 30000 // 单条详情最大字符数（防止完整请求/响应内容撑爆存储）

let _seq = 0

function _read() {
	if (typeof uni === 'undefined' || !uni.getStorageSync) return []
	const v = uni.getStorageSync(KEY_LOGS)
	return Array.isArray(v) ? v : []
}

function _write(logs) {
	if (typeof uni !== 'undefined' && uni.setStorageSync) {
		try {
			uni.setStorageSync(KEY_LOGS, logs)
		} catch (e) {
			console.error('[log] 日志保存失败:', e)
		}
	}
}

/**
 * 追加一条调试日志
 * @param {'req'|'res'|'err'|'info'} type
 * @param {string} msg 摘要（列表主展示）
 * @param {string} detail 详情（可选，折叠展示）
 */
export function addLog(type, msg, detail) {
	_seq++
	const entry = {
		id: Date.now().toString(36) + '_' + _seq,
		time: new Date().toISOString(),
		type: type || 'info',
		msg: String(msg || ''),
		detail: detail ? String(detail).slice(0, MAX_DETAIL_CHARS) : ''
	}
	const logs = _read()
	logs.push(entry)
	if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS)
	_write(logs)
}

/** 全部日志（新 → 旧） */
export function getLogs() {
	return _read().slice().reverse()
}

/** 清空全部日志 */
export function clearLogs() {
	_write([])
}
