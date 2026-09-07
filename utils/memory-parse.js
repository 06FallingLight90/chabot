/**
 * 记忆格式化与 Memory 行解析 —— 从 memory.js 拆分（纯函数，零依赖）。
 * parseMemoryLine：解析 LLM 输出中的 Memory 行（新增/修改/删除），格式非法返回 null；
 * formatMemoryTime：记忆创建时间的简短中文描述。
 */

/**
 * 纯解析 Memory 行（不写入），供格式校验与 saveFromLine 复用。
 * 兼容三种操作：新增 / 修改 / 删除；格式非法返回 null。
 * @param {string} line 原始 Memory 行（含 "Memory:" 前缀）
 * @returns {{action:'delete',content:string}|{action:'modify',oldContent:string,rest:string}|{action:'add',category:string,parts:string[]}|null}
 */
export function parseMemoryLine(line) {
	line = (line || '').trim().replace(/^memory[:：]\s*/i, '')
	if (!line) return null

	// 删除: Memory: 删除 原内容
	if (/^删除\s+/i.test(line)) {
		const target = line.replace(/^删除\s+/i, '').trim()
		return target ? { action: 'delete', content: target } : null
	}

	// 修改: Memory: 修改 原内容 → 新内容 | keywords:.. | ...（兼容半角→全角→和破折号）
	const modMatch = line.match(/^修改\s+(.+?)\s*(?:→|→|—)\s*(.+)$/i)
	if (modMatch) {
		const oldContent = modMatch[1].trim()
		const rest = modMatch[2].trim()
		const parts = rest.split('|').map((p) => p.trim()).filter(Boolean)
		if (oldContent && parts.length && parts[0]) return { action: 'modify', oldContent, rest }
		return null
	}

	// 新增：兼容 "category content | ..." 与 "category: content | ..."
	let m = line.match(/^\[([\w]+)\][:：]?\s*(.+)$/)
	if (!m) m = line.match(/^(\w+)[:：]?\s+(.+)$/)
	if (!m) return null
	const category = m[1]
	const parts = m[2].split('|').map((p) => p.trim()).filter(Boolean)
	if (!parts.length || !parts[0]) return null
	return { action: 'add', category, parts }
}

/** 记忆创建时间的简短中文描述 */
export function formatMemoryTime(iso) {
	if (!iso) return ''
	const t = Date.parse(iso)
	if (Number.isNaN(t)) return ''
	const s = Math.floor((Date.now() - t) / 1000)
	if (s < 60) return '（刚刚）'
	if (s < 3600) return `（${Math.floor(s / 60)}分钟前）`
	if (s < 86400) return `（${Math.floor(s / 3600)}小时前）`
	if (s < 172800) return '（昨天）'
	if (s < 2592000) return `（${Math.floor(s / 86400)}天前）`
	return `（${iso.slice(5, 10)}）`
}