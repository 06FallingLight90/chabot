/**
 * 表情包逻辑验证脚本（Node 环境运行，mock uni 存储）
 * 验证：表情名校验 / 新增、改名、删除 / 映射与清单 / $表情名$ 解析拆分 / 占位提取
 */
let failed = 0

function assert(cond, msg) {
	if (cond) {
		console.log('  ✓ ' + msg)
	} else {
		failed++
		console.error('  ✗ ' + msg)
	}
}

// ---- mock uni 存储（H5/小程序降级路径）----
const kv = new Map()
globalThis.uni = {
	getStorageSync: (k) => (kv.has(k) ? kv.get(k) : ''),
	setStorageSync: (k, v) => kv.set(k, JSON.parse(JSON.stringify(v))),
	// Node 中 #ifdef APP-PLUS || MP-WEIXIN 代码块仍会执行，需补齐 removeSavedFile
	removeSavedFile: () => {}
}

const {
	getEmojis,
	getEmojiMap,
	emojiListForPrompt,
	validateEmojiName,
	addEmojiData,
	renameEmoji,
	deleteEmoji,
	reorderEmojis,
	splitEmojiText,
	extractEmojiNames
} = await import('../utils/emojis.js')

console.log('\n[1] 表情名校验')
assert(!validateEmojiName('').ok, '空名拒绝')
assert(!validateEmojiName('   ').ok, '纯空格拒绝')
assert(!validateEmojiName('字'.repeat(21)).ok, '超 20 字拒绝')
assert(validateEmojiName('字'.repeat(20)).ok, '恰好 20 字允许')
assert(!validateEmojiName('小狗$高兴').ok, '含 $ 拒绝')
assert(!validateEmojiName('小狗\n高兴').ok, '含换行拒绝')

console.log('\n[2] 新增表情')
const a = addEmojiData('小狗高兴', 'src://dog')
const b = addEmojiData('猫猫无语', 'src://cat')
assert(getEmojis().length === 2, '新增 2 个表情')
assert(!validateEmojiName('小狗高兴').ok, '重复名拒绝')
let threw = false
try {
	addEmojiData('小狗高兴', 'src://x')
} catch (e) {
	threw = true
}
assert(threw, '重复名新增抛错')

console.log('\n[3] 改名')
renameEmoji(a.id, '大狗开心')
assert(getEmojiMap()['大狗开心'] === 'src://dog', '改名生效')
assert(!getEmojiMap()['小狗高兴'], '旧名不再可用')
threw = false
try {
	renameEmoji(b.id, '大狗开心')
} catch (e) {
	threw = true
}
assert(threw, '改名撞名抛错')
renameEmoji(a.id, '大狗开心')
assert(getEmojis().length === 2, '改成自身名不报错')

console.log('\n[4] 清单与映射')
assert(emojiListForPrompt().length === 2, '清单 2 个')
assert(emojiListForPrompt()[0] === '大狗开心', '清单顺序正确')

console.log('\n[5] $表情名$ 解析拆分')
const map = getEmojiMap()
let segs = splitEmojiText('你好 $大狗开心$ 很高兴认识你', map)
assert(
	segs.length === 3 &&
		segs[0].text === '你好' &&
		segs[1].type === 'emoji' &&
		segs[1].src === 'src://dog' &&
		segs[2].text === '很高兴认识你',
	'文本-表情-文本拆为 3 段（文本去除表情侧空白）'
)
segs = splitEmojiText('$猫猫无语$', map)
assert(segs.length === 1 && segs[0].type === 'emoji', '纯表情单段')
segs = splitEmojiText('你好', map)
assert(segs.length === 1 && segs[0].type === 'text' && segs[0].text === '你好', '无占位原文单段')
segs = splitEmojiText('$不存在的名$', map)
assert(
	segs.length === 1 && segs[0].type === 'text' && segs[0].text === '$不存在的名$',
	'未知表情名原样保留为文本'
)
segs = splitEmojiText('', map)
assert(segs.length === 0, '空串拆分为 0 段')
segs = splitEmojiText('$大狗开心$$猫猫无语$', map)
assert(segs.length === 2 && segs[0].type === 'emoji' && segs[1].type === 'emoji', '连续两个表情拆为 2 段')
segs = splitEmojiText('$大狗开心$ $猫猫无语$', map)
assert(segs.length === 2 && segs[0].type === 'emoji' && segs[1].type === 'emoji', '表情间空格跳过，不产生空气泡')
segs = splitEmojiText('$大狗开心$\n\n$猫猫无语$', map)
assert(segs.length === 2 && segs[0].type === 'emoji' && segs[1].type === 'emoji', '表情间换行跳过，不产生空气泡')
segs = splitEmojiText('  $大狗开心$   ', map)
assert(segs.length === 1 && segs[0].type === 'emoji', '表情首尾空白跳过')
segs = splitEmojiText('唔~学长好乖…… $大狗开心$\n\n$猫猫无语$', map)
assert(
	segs.length === 3 && segs[0].text === '唔~学长好乖……' && segs[1].type === 'emoji' && segs[2].type === 'emoji',
	'文本+多个表情混合：文本段正确且空白不产生空气泡'
)

console.log('\n[6] 占位名提取（LLM 回复校验）')
assert(extractEmojiNames('好的 $大狗开心$').join(',') === '大狗开心', '提取已知占位')
assert(extractEmojiNames('$瞎编的$ $大狗开心$').join(',') === '瞎编的,大狗开心', '提取含未知占位')
assert(extractEmojiNames('没有占位').length === 0, '无占位返回空')
assert(extractEmojiNames('$' + '超'.repeat(21) + '$').length === 0, '超过 20 字的 $..$ 不视为占位')

console.log('\n[7] 拖拽重排')
reorderEmojis([b.id, a.id])
let order = getEmojis().map((e) => e.id)
assert(order[0] === b.id && order[1] === a.id, '重排后顺序为 b,a')
reorderEmojis(['not-exist-id'])
order = getEmojis().map((e) => e.id)
assert(order.length === 2 && order[0] === b.id && order[1] === a.id, '未知 id 被忽略且不丢项')
reorderEmojis([a.id])
order = getEmojis().map((e) => e.id)
assert(order.length === 2 && order[0] === a.id && order[1] === b.id, '仅给出部分 id 时其余自动补位')

console.log('\n[8] 删除')
assert(deleteEmoji(a.id) === true, '删除成功')
assert(getEmojis().length === 1, '删除后剩 1 个')
assert(deleteEmoji('not-exist') === false, '删除不存在返回 false')
assert(deleteEmoji(b.id) === true, '删除成功')
assert(getEmojis().length === 0, '全部删除后为空')

console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`)
process.exit(failed === 0 ? 0 : 1)
