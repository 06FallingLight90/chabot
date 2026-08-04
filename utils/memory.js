/**
 * 记忆核心 —— 移植自 koishi-ai-pet（pet/brain/memory.py）的设计：
 * - 三级记忆 L1/L2/L3（核心事实 / 情景记忆 / 临时信息），importance 1-5
 * - 有效重要性 = 基础分 × 时间半衰期衰减 × 回忆强化因子
 * - 关键词检索 + 轻量文本相似度去重（近似重复合并、召回冷却、复读加权）
 * - 分层召回：核心槽 + 新鲜槽 + MMR 多样性槽
 * - 维护：L3 过期清理、L2→L3 降级、容量淘汰
 */

import { getMemories, replaceMemories, persistMemories, nextMemoryId } from './storage.js'

const MAX_MEMORIES = 200 // 记忆最大容量
const RECALL_COUNT = 10 // 每次对话召回的记忆条数
const RECALL_COOLDOWN_SECONDS = 300 // 记忆召回冷却时间（秒）
const L3_EXPIRE_DAYS = 3 // L3 临时记忆过期天数
const DEDUP_THRESHOLD = 0.6 // 近似重复阈值（低于此值视为不同记忆）
const DUPLICATE_THRESHOLD = 0.85 // 高相似阈值（高于此值触发冷却拦截）
const L2_DEMOTE_THRESHOLD = 2.2 // effective_importance 低于此值的非永久记忆降级
const L3_PROMOTE_WINDOW_MS = 6 * 3600 * 1000 // L3 高频访问升级窗口
const L3_PROMOTE_HITS = 6 // 窗口内访问次数达到该值 → L3 升 L2
const COOLDOWN_BOOST_CAP = 5 // 冷却期复读 importance 奖励上限
const RECALL_BONUS_TAU_DAYS = 0.5 // 回忆强化半衰期（天）
const RECALL_BONUS_MAX = 0.5 // 回忆强化最大加成比例
const BLOCKED_TTL_MS = 120 * 1000 // 被冷却拦截内容的保留时间

const HALF_LIFE = {
	// level: { importance: 半衰期(天) }，仅 L1+importance=5 永不衰减
	L1: { 5: Infinity, 4: 30, 3: 21, 2: 14, 1: 7 },
	L2: { 5: 60, 4: 30, 3: 14, 2: 7, 1: 3 },
	L3: { 5: 3, 4: 3, 3: 2, 2: 1, 1: 1 }
}
const LEVEL_ORDER = { L1: 0, L2: 1, L3: 2 }

const STOP_WORDS = new Set([
	'的', '地', '得', '了', '着', '过', '吗', '呢', '吧', '啊', '呀', '哦', '哇', '嘛', '呗', '么',
	'我', '你', '他', '她', '它', '我们', '你们', '他们', '她们', '它们',
	'这', '那', '这个', '那个', '这些', '那些', '这里', '那里', '这样', '那样',
	'自己', '别人', '大家', '谁', '什么', '怎么', '怎样', '为什么', '哪', '哪里',
	'在', '和', '与', '及', '或', '把', '被', '让', '给', '对', '从', '向', '往', '于',
	'以', '为', '由', '跟', '同', '关于', '除了',
	'因为', '所以', '如果', '虽然', '但是', '而且', '并且', '还是', '或者', '然后', '接着', '由于', '即使', '只要', '只有',
	'很', '非常', '太', '更', '最', '也', '还', '就', '都', '已经', '正在', '将要', '马上', '立刻',
	'不', '没', '没有', '不是', '不要', '不能', '别', '勿', '未',
	'会', '能', '可以', '应该', '可能', '必须', '需要', '或许', '也许',
	'又', '再', '只', '只是', '仅仅', '甚至', '其实', '确实', '真的', '当然',
	'一定', '肯定', '大概', '经常', '偶尔', '一直', '总是', '从不', '永远',
	'比如', '例如', '不过', '此外', '另外',
	'是', '有', '说', '做', '看', '想', '觉得', '知道', '感觉', '认为', '要', '去', '来', '到', '上', '下', '进', '出',
	'个', '些', '种', '类', '一', '二', '三', '几', '多', '少',
	'现在', '以前', '以后', '之前', '之后', '今天', '明天', '昨天', '刚才', '未来'
])

const nowIso = () => new Date().toISOString()
const daysAgoIso = (d) => new Date(Date.now() - d * 86400000).toISOString()

// ---------- 轻量文本相似度 ----------
function charNGrams(text, n = 2) {
	const clean = String(text).replace(/[^\w\u4e00-\u9fa5]/g, '').toLowerCase()
	const set = new Set()
	if (clean.length < n) {
		if (clean) set.add(clean)
		return set
	}
	for (let i = 0; i <= clean.length - n; i++) set.add(clean.slice(i, i + n))
	return set
}

function jaccard(a, b) {
	if (!a.size || !b.size) return 0
	let inter = 0
	for (const x of a) if (b.has(x)) inter++
	const union = a.size + b.size - inter
	return union ? inter / union : 0
}

/** 轻量 LCS 相似度（替代 Python difflib.SequenceMatcher.ratio） */
function sequenceRatio(a, b) {
	a = String(a)
	b = String(b)
	const m = a.length
	const n = b.length
	if (!m || !n) return 0
	let prev = new Array(n + 1).fill(0)
	for (let i = 1; i <= m; i++) {
		const cur = new Array(n + 1).fill(0)
		for (let j = 1; j <= n; j++) {
			cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
		}
		prev = cur
	}
	return (2 * prev[n]) / (m + n)
}

/** 综合相似度：Jaccard(0.6) 抗增删 + 序列相似度(0.4) 抗语序打乱 */
function computeSimilarity(t1, t2) {
	if (!t1 || !t2) return 0
	return 0.6 * jaccard(charNGrams(t1), charNGrams(t2)) + 0.4 * sequenceRatio(t1, t2)
}

// ---------- 记忆存储 ----------
export class MemoryStore {
	constructor() {
		this._recallTimes = new Map() // id -> 最近召回时间戳
		this._recentlyBlocked = [] // [{content, time}]
	}

	_rows() {
		return getMemories()
	}

	_halfLife(row) {
		const map = HALF_LIFE[row.level] || HALF_LIFE.L2
		const v = map[row.importance]
		return v === undefined ? 45 : v
	}

	/** 回忆强化因子：刚被访问时 >1，随时间衰减回 1.0 */
	_recencyFactor(row) {
		if (!row.last_accessed_at) return 1
		const t = Date.parse(row.last_accessed_at)
		if (Number.isNaN(t)) return 1
		const ageDays = (Date.now() - t) / 86400000
		const bonus = RECALL_BONUS_MAX * Math.pow(0.5, ageDays / RECALL_BONUS_TAU_DAYS)
		return 1 + bonus
	}

	/** 有效重要性 = 基础分 × 时间半衰期衰减 × 回忆强化 */
	effectiveImportance(row) {
		const base = row.importance || 3
		let decay = 1
		const hl = this._halfLife(row)
		if (hl !== Infinity) {
			const t = Date.parse(row.created_at || '')
			if (!Number.isNaN(t)) {
				const ageDays = (Date.now() - t) / 86400000
				decay = Math.pow(0.5, ageDays / hl)
			}
		}
		return Math.min(5, base * decay * this._recencyFactor(row))
	}

	// ---------- 保存 ----------
	save(category, content, keywords, importance = 3, level = 'L2') {
		if (!content || !String(content).trim()) return
		const existing = this._keywordFindSimilar(content, keywords)[0]
		if (existing) {
			const textSim = computeSimilarity(content, existing.content)
			// 仅近似重复(≥0.85)受冷却限制；中等相似视为合理更新，允许合并
			if (textSim >= DUPLICATE_THRESHOLD && this._isInCooldown(existing.id, content)) return
			const merged = this._doMerge(existing, content, keywords, importance, level)
			Object.assign(existing, merged)
			persistMemories()
		} else {
			getMemories().push({
				id: nextMemoryId(),
				category,
				content,
				keywords: (keywords || []).join(','),
				importance,
				level,
				created_at: nowIso(),
				last_accessed_at: null,
				access_count: 0
			})
			persistMemories()
		}
		this._enforceCapacity()
	}

	/**
	 * 解析 LLM 输出的 Memory 行并保存。
	 * 兼容三种操作：
	 *   Memory: 类别 内容 | keywords:.. | importance:.. | level:..   ← 新增
	 *   Memory: 修改 原内容 → 新内容 | keywords:.. | ...              ← 修改
	 *   Memory: 删除 原内容                                            ← 删除
	 */
	saveFromLine(line) {
		line = (line || '').trim().replace(/^memory[:：]\s*/i, '')
		if (!line) return false

		// 删除: Memory: 删除 原内容
		if (/^删除\s+/i.test(line)) {
			const target = line.replace(/^删除\s+/i, '').trim()
			return this._deleteByContent(target)
		}

		// 修改: Memory: 修改 原内容 → 新内容 | keywords:.. | ...
		// 兼容半角→全角→箭头和破折号等多种变体
		const modMatch = line.match(/^修改\s+(.+?)\s*(?:→|→|—)\s*(.+)$/i)
		if (modMatch) {
			const oldContent = modMatch[1].trim()
			const rest = modMatch[2].trim()
			return this._modifyByContent(oldContent, rest)
		}

		// 新增（原逻辑）：兼容 "category content | ..." 与 "category: content | ..."
		let m = line.match(/^\[([\w]+)\][:：]?\s*(.+)$/)
		if (!m) m = line.match(/^(\w+)[:：]?\s+(.+)$/)
		if (!m) return false
		const category = m[1]
		const parts = m[2].split('|').map((p) => p.trim()).filter(Boolean)
		if (!parts.length) return false
		let content = parts[0]
		let keywords = []
		let importance = 3
		let level = 'L2'
		for (const part of parts.slice(1)) {
			if (part.startsWith('keywords:')) {
				keywords = part.slice(9).split(',').map((k) => k.trim()).filter(Boolean)
			} else if (part.startsWith('importance:')) {
				const v = parseInt(part.slice(11).trim(), 10)
				if (!Number.isNaN(v)) importance = v
			} else if (part.startsWith('level:')) {
				const l = part.slice(6).trim().toUpperCase()
				if (LEVEL_ORDER[l] !== undefined) level = l
			}
		}
		if (!keywords.length) keywords = this.extractKeywords(content)
		importance = Math.max(1, Math.min(5, importance))
		if (level === 'L1' && importance < 3) importance = 3
		if (level === 'L3' && importance > 4) importance = 4
		if (importance <= 2 && level !== 'L1') level = 'L3'
		this.save(category, content, keywords, importance, level)
		return true
	}

	/** 按内容查找记忆（逐字匹配），返回 row 或 null */
	_findByContent(content) {
		return this._rows().find((r) => r.content === content) || null
	}

	/** 删除指定内容的记忆 */
	_deleteByContent(content) {
		const rows = this._rows()
		const idx = rows.findIndex((r) => r.content === content)
		if (idx < 0) return false
		rows.splice(idx, 1)
		persistMemories()
		return true
	}

	/** 修改：找到原内容 → 替换为新内容+新参数 */
	_modifyByContent(oldContent, rest) {
		const row = this._findByContent(oldContent)
		if (!row) return false
		// 解析 rest：新内容 + 可选 | keywords:.. | importance:.. | level:..
		const parts = rest.split('|').map((p) => p.trim()).filter(Boolean)
		const newContent = parts[0] || ''
		if (!newContent) return false
		let keywords = []
		let importance = row.importance
		let level = row.level
		for (const part of parts.slice(1)) {
			if (part.startsWith('keywords:')) {
				keywords = part.slice(9).split(',').map((k) => k.trim()).filter(Boolean)
			} else if (part.startsWith('importance:')) {
				const v = parseInt(part.slice(11).trim(), 10)
				if (!Number.isNaN(v)) importance = v
			} else if (part.startsWith('level:')) {
				const l = part.slice(6).trim().toUpperCase()
				if (LEVEL_ORDER[l] !== undefined) level = l
			}
		}
		if (!keywords.length) keywords = this.extractKeywords(newContent)
		importance = Math.max(1, Math.min(5, importance))
		if (level === 'L1' && importance < 3) importance = 3
		if (level === 'L3' && importance > 4) importance = 4
		if (importance <= 2 && level !== 'L1') level = 'L3'
		Object.assign(row, {
			content: newContent,
			keywords: keywords.join(','),
			importance,
			level
		})
		persistMemories()
		return true
	}

	/** 合并策略：保留较长内容、合并关键词、取较高 level */
	_doMerge(existing, content, keywords, importance, level) {
		const mergedContent = content.length >= existing.content.length ? content : existing.content
		const kw = new Set([...(existing.keywords || '').split(',').filter(Boolean), ...(keywords || [])])
		let mergedImportance = existing.importance
		let mergedLevel = this._mergeLevel(existing.level, level)
		const contentChanged = content.length > existing.content.length
		if (contentChanged) mergedImportance = Math.max(existing.importance, importance)
		return { content: mergedContent, keywords: [...kw].join(','), importance: mergedImportance, level: mergedLevel }
	}

	_mergeLevel(a, b) {
		return (LEVEL_ORDER[a] || 1) <= (LEVEL_ORDER[b] || 1) ? a : b
	}

	/** 召回冷却：冷却期内再次保存 → 拦截 + 复读加权（importance 奖励，有上限） */
	_isInCooldown(id, content) {
		const last = this._recallTimes.get(id)
		if (last && (Date.now() - last) / 1000 < RECALL_COOLDOWN_SECONDS) {
			if (content) this._recordBlocked(content)
			this._boostImportance(id)
			return true
		}
		return false
	}

	_boostImportance(id) {
		const r = this._rows().find((x) => x.id === id)
		if (!r) return
		if (r.importance < COOLDOWN_BOOST_CAP) {
			r.importance += 1
			persistMemories()
		}
	}

	_recordBlocked(content) {
		this._recentlyBlocked.push({ content, time: Date.now() })
		const cutoff = Date.now() - BLOCKED_TTL_MS
		this._recentlyBlocked = this._recentlyBlocked.filter((b) => b.time > cutoff)
	}

	/** 最近被拦截的记忆内容（供上下文反馈，避免 LLM 重复输出） */
	getRecentlyBlocked() {
		const cutoff = Date.now() - BLOCKED_TTL_MS
		return this._recentlyBlocked.filter((b) => b.time > cutoff).map((b) => b.content)
	}

	_cleanupRecallTimes() {
		const cutoff = Date.now() - RECALL_COOLDOWN_SECONDS * 2000
		for (const [k, v] of this._recallTimes) if (v < cutoff) this._recallTimes.delete(k)
	}

	// ---------- 检索 ----------
	/** 关键词提取（无 jieba 的降级方案：按标点切分 + 停用词过滤） */
	extractKeywords(text) {
		const tokens = String(text).split(/[\s,，。！？、；：\n]+/)
		const kws = []
		for (const t of tokens) {
			if (t.length >= 2 && !STOP_WORDS.has(t) && !/^\d+$/.test(t)) {
				kws.push(t)
				if (kws.length >= 5) break
			}
		}
		return kws
	}

	/** 关键词捞候选集 + 轻量相似度匹配，返回 [row|null, score] */
	_keywordFindSimilar(content, keywords) {
		const rows = this._rows()
		let candidates = []
		if (keywords && keywords.length) {
			const kwSet = new Set(keywords)
			candidates = rows
				.filter((r) => (r.keywords || '').split(',').some((k) => kwSet.has(k)))
				.slice(0, 20)
		}
		if (candidates.length < 3) {
			const recent = [...rows].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 10)
			const seen = new Set(candidates.map((r) => r.id))
			for (const r of recent) {
				if (seen.has(r.id)) continue
				candidates.push(r)
				if (candidates.length >= 20) break
			}
		}
		let best = null
		let bestScore = 0
		for (const r of candidates) {
			const s = computeSimilarity(content, r.content)
			if (s > bestScore) {
				bestScore = s
				best = r
			}
		}
		if (best && bestScore >= DEDUP_THRESHOLD) return [best, bestScore]
		return [null, 0]
	}

	/** 关键词查询：命中数优先，再按有效重要性排序 */
	_queryByText(text, limit = 3) {
		const keywords = this.extractKeywords(text)
		if (!keywords.length) return []
		const kwSet = new Set(keywords)
		const matched = this._rows().filter((r) => (r.keywords || '').split(',').some((k) => kwSet.has(k)))
		const matchScore = (r) => (r.keywords || '').split(',').filter((k) => kwSet.has(k)).length
		matched.sort((a, b) => {
			const ms = matchScore(b) - matchScore(a)
			return ms !== 0 ? ms : this.effectiveImportance(b) - this.effectiveImportance(a)
		})
		const picked = matched.slice(0, limit)
		this.touch(picked)
		return picked
	}

	/** 核心记忆：有效重要性最高的 N 条 */
	queryCore(limit = 5) {
		const pool = [...this._rows()]
			.sort(
				(a, b) =>
					(b.importance || 0) - (a.importance || 0) ||
					(b.created_at || '').localeCompare(a.created_at || '')
			)
			.slice(0, limit * 5)
		const scored = pool.filter((r) => this.effectiveImportance(r) >= 3.5)
		scored.sort((a, b) => this.effectiveImportance(b) - this.effectiveImportance(a))
		const picked = scored.slice(0, limit)
		this.touch(picked)
		return picked
	}

	/** 新鲜记忆：最近 N 小时内的记忆 */
	queryRecent(hours = 24, limit = 3) {
		const since = new Date(Date.now() - hours * 3600000).toISOString()
		const picked = this._rows()
			.filter((r) => (r.created_at || '') >= since)
			.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
			.slice(0, limit)
		this.touch(picked)
		return picked
	}

	/** MMR 多样性选择：λ 偏相关性，(1-λ) 惩罚与已选内容的相似度 */
	_mmrSelect(candidates, selected, n, lam = 0.7) {
		const pool = [...candidates]
		const picked = []
		while (pool.length && picked.length < n) {
			let best = null
			let bestScore = -1
			for (const m of pool) {
				const rel = this.effectiveImportance(m) / 5
				const refs = [...selected.map((s) => s.content), ...picked.map((p) => p.content)]
				let maxSim = 0
				for (const r of refs) maxSim = Math.max(maxSim, computeSimilarity(m.content, r))
				const score = lam * rel - (1 - lam) * maxSim
				if (score > bestScore) {
					bestScore = score
					best = m
				}
			}
			if (!best) break
			pool.splice(pool.indexOf(best), 1)
			picked.push(best)
		}
		return picked
	}

	/** 构建记忆上下文：核心槽 + 新鲜槽 + MMR 多样性槽 */
	retrieveContext(userMessage = '') {
		const total = Math.max(3, RECALL_COUNT)
		const coreN = Math.max(1, Math.round(total * 0.3))
		const recentN = Math.max(1, Math.round(total * 0.2))
		const mmrN = Math.max(1, total - coreN - recentN)
		const mmrCandidates = Math.max(mmrN + 3, 8)

		const seen = new Set()
		const results = []
		for (const m of this.queryCore(coreN)) if (!seen.has(m.id)) { seen.add(m.id); results.push(m) }
		for (const m of this.queryRecent(24, recentN)) if (!seen.has(m.id)) { seen.add(m.id); results.push(m) }
		const candidates = this._queryByText(userMessage, mmrCandidates).filter((m) => !seen.has(m.id))
		for (const m of this._mmrSelect(candidates, results, mmrN)) if (!seen.has(m.id)) { seen.add(m.id); results.push(m) }

		if (!results.length) return ''

		// 记录召回时间用于冷却期去重
		const now = Date.now()
		for (const m of results) this._recallTimes.set(m.id, now)

		const lines = []
		for (const m of results) {
			const tag = this.effectiveImportance(m) >= 3.5 ? '（重要）' : ''
			lines.push(`- ${m.content}${formatMemoryTime(m.created_at)}${tag}`)
		}
		const blocked = this.getRecentlyBlocked()
		if (blocked.length) {
			lines.push('')
			lines.push('（以下信息已记录或正在保存，请勿重复输出 Memory 行）')
			for (const b of blocked) lines.push(`- ${b}`)
		}
		return lines.join('\n')
	}

	/** 记录访问：access_count+1；L3 高频访问升级 L2 */
	touch(items) {
		if (!items || !items.length) return
		const idSet = new Set(items.map((x) => (typeof x === 'number' ? x : x.id)))
		const now = Date.now()
		const iso = nowIso()
		let changed = false
		for (const r of this._rows()) {
			if (idSet.has(r.id)) {
				r.access_count = (r.access_count || 0) + 1
				r.last_accessed_at = iso
				changed = true
			}
		}
		if (!changed) return
		persistMemories()
		this._maybePromoteL3(idSet, now)
	}

	/** L3 短时间高频访问 → 升级 L2 */
	_maybePromoteL3(idSet, now) {
		let changed = false
		for (const r of this._rows()) {
			if (!idSet.has(r.id)) continue
			if (r.level === 'L3' && (r.access_count || 0) >= L3_PROMOTE_HITS) {
				const t = Date.parse(r.created_at)
				if (!Number.isNaN(t) && now - t < L3_PROMOTE_WINDOW_MS) {
					r.level = 'L2'
					changed = true
				}
			}
		}
		if (changed) persistMemories()
	}

	// ---------- 维护 ----------
	/** 定期维护：L3 过期清理 + 降级 + 容量控制 */
	maintenance() {
		this._cleanupRecallTimes()
		this._demoteL2toL3()
		this._enforceCapacity()
	}

	/** 降级维护：有效重要性衰减到阈值以下的非永久记忆降一级（L1+i5 永久豁免） */
	_demoteL2toL3() {
		let changed = false
		for (const r of this._rows()) {
			if ((r.level === 'L1' || r.level === 'L2') && !(r.level === 'L1' && r.importance === 5)) {
				if (this.effectiveImportance(r) < L2_DEMOTE_THRESHOLD) {
					r.level = r.level === 'L1' ? 'L2' : 'L3'
					changed = true
				}
			}
		}
		if (changed) persistMemories()
	}

	_lastAccess(r) {
		return r.last_accessed_at || r.created_at
	}

	/** 容量控制：L3 过期硬清理 → 超容量按有效重要性淘汰低权重 */
	_enforceCapacity() {
		let rows = this._rows()
		if (rows.length <= MAX_MEMORIES) {
			// 未超容量，仅做 L3 过期硬清理
			const cutoff = daysAgoIso(L3_EXPIRE_DAYS)
			const kept = rows.filter((r) => !(r.level === 'L3' && this._lastAccess(r) < cutoff))
			if (kept.length !== rows.length) replaceMemories(kept)
			return
		}
		// 阶段0：L3 硬清理
		let cutoff = daysAgoIso(L3_EXPIRE_DAYS)
		rows = rows.filter((r) => !(r.level === 'L3' && this._lastAccess(r) < cutoff))
		if (rows.length <= MAX_MEMORIES) {
			replaceMemories(rows)
			return
		}
		// 阶段1：删除超过 1 天且访问 ≤1 的 L3
		const dayAgo = daysAgoIso(1)
		rows = rows.filter((r) => !(r.level === 'L3' && this._lastAccess(r) < dayAgo && (r.access_count || 0) <= 1))
		// 阶段2：按有效重要性升序淘汰低权重（L2/L1 importance<5），不足再兜底 importance=5 的 L2
		if (rows.length > MAX_MEMORIES) {
			const excess = rows.length - MAX_MEMORIES
			const target = Math.min(excess * 2, 10)
			const demotable = rows.filter((r) => r.level !== 'L3' && r.importance < 5)
			demotable.sort((a, b) => this.effectiveImportance(a) - this.effectiveImportance(b))
			const toDelete = new Set(demotable.slice(0, target).map((r) => r.id))
			if (toDelete.size < excess) {
				const remaining = excess - toDelete.size
				const l2hi = rows.filter((r) => r.level === 'L2' && r.importance === 5 && !toDelete.has(r.id))
				l2hi.sort((a, b) => this.effectiveImportance(a) - this.effectiveImportance(b))
				for (const r of l2hi.slice(0, remaining)) toDelete.add(r.id)
			}
			rows = rows.filter((r) => !toDelete.has(r.id))
		}
		replaceMemories(rows)
	}

	// ---------- 管理接口（记忆页使用） ----------
	listMemories(filter = {}) {
		let rows = [...this._rows()]
		if (filter.level) rows = rows.filter((r) => r.level === filter.level)
		if (filter.search) {
			rows = rows.filter(
				(r) => (r.content || '').includes(filter.search) || (r.keywords || '').includes(filter.search)
			)
		}
		rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
		return rows
	}

	deleteMemories(ids) {
		const idSet = new Set(ids)
		replaceMemories(this._rows().filter((r) => !idSet.has(r.id)))
	}

	updateMemory(id, patch = {}) {
		const r = this._rows().find((x) => x.id === id)
		if (!r) return
		if (patch.content !== undefined) r.content = patch.content
		if (patch.importance !== undefined) r.importance = patch.importance
		if (patch.level !== undefined) r.level = patch.level
		if (patch.keywords !== undefined) r.keywords = patch.keywords
		persistMemories()
	}
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
