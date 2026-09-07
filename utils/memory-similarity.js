/**
 * 轻量文本相似度 —— 从 memory.js 拆分（纯函数，零依赖）。
 * 检索去重 / 近似合并 / MMR 多样性选择共用。
 */

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
export function computeSimilarity(t1, t2) {
	if (!t1 || !t2) return 0
	return 0.6 * jaccard(charNGrams(t1), charNGrams(t2)) + 0.4 * sequenceRatio(t1, t2)
}