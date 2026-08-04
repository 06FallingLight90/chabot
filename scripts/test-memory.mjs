/**
 * 核心逻辑验证脚本（Node 环境运行，mock uni 存储）
 * 验证：Memory 行解析入库 / 近似重复合并 / 召回冷却复读加权 / 记忆检索注入 /
 *       完整聊天链路（组装→调用→落库→解析→清理展示文本）
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
	setStorageSync: (k, v) => kv.set(k, JSON.parse(JSON.stringify(v)))
}

const { initStorage } = await import('../utils/storage.js')
const { MemoryStore } = await import('../utils/memory.js')
const storage = await import('../utils/storage.js')
const chat = await import('../utils/chat.js')
const { memoryStore } = chat

initStorage()
const ms = new MemoryStore()

console.log('\n[1] Memory 行解析与保存')
ms.saveFromLine('Memory: user_fact 用户叫小明，住在北京 | keywords:小明,北京 | importance:5 | level:L1')
let list = ms.listMemories()
assert(list.length === 1, '新增 1 条记忆')
assert(list[0].level === 'L1' && list[0].importance === 5, `解析出 L1/importance=5（实际 L1/${list[0].importance}）`)
assert(list[0].keywords === '小明,北京', `关键词正确（${list[0].keywords}）`)

console.log('\n[2] 近似重复合并（同内容再次保存，不新增）')
ms.saveFromLine('Memory: user_fact 用户叫小明，住在北京 | keywords:小明 | importance:3 | level:L2')
list = ms.listMemories()
assert(list.length === 1, '同内容再次保存应合并为 1 条')
assert(list[0].level === 'L1' && list[0].importance === 5, `合并保留较高 level/importance（实际 L1/${list[0].importance}）`)

console.log('\n[2b] 全角→箭头兼容')
ms.save('preference', '用户讨厌吃香菜', ['香菜'], 4, 'L2')
ms.saveFromLine('Memory: 修改 用户讨厌吃香菜 → 用户现在可以接受香菜了')
assert(!!ms.listMemories().find((r) => r.content === '用户现在可以接受香菜了'), '全角→也能匹配修改')

console.log('\n[2c] 冒号分隔格式兼容 "category: content"')
ms.saveFromLine('Memory: user_fact: 用户手机号是13800138000 | keywords:手机号 | importance:5 | level:L1')
assert(ms.listMemories().some((r) => r.content === '用户手机号是13800138000'), '冒号分隔也能解析')

console.log('\n[2d] 修改操作（先建后改）')
	ms.save('event', '用户正在准备考研', ['考研'], 4, 'L2')
	list = ms.listMemories()
	const before = list.length
ms.saveFromLine('Memory: 修改 用户正在准备考研 → 用户考研已上岸 | keywords:考研,上岸 | importance:5 | level:L1')
list = ms.listMemories()
assert(list.length === before, '修改不增加条数')
const updated = list.find((r) => r.content === '用户考研已上岸')
assert(!!updated && updated.importance === 5 && updated.level === 'L1', '修改后 importance=5 level=L1')
assert(!list.find((r) => r.content === '用户正在准备考研'), '旧内容已替换')

console.log('\n[2e] 删除操作（先建后删）')
ms.save('conversation', '用户养了一只叫团子的橘猫', ['团子', '橘猫'], 4, 'L2')
list = ms.listMemories()
const before2 = list.length
ms.saveFromLine('Memory: 删除 用户养了一只叫团子的橘猫')
list = ms.listMemories()
assert(list.length === before2 - 1, `删除后减少 1 条（${list.length}）`)
assert(!list.find((r) => r.content.includes('团子')), '团子记忆已删除')

console.log('\n[3] 补回测试所需数据')
ms.save('conversation', '用户养了一只叫团子的橘猫', ['团子', '橘猫'], 4, 'L2')
ms.save('event', '用户正在准备考研', ['考研'], 4, 'L2')
list = ms.listMemories()
assert(list.length > 1, '补回后有多条记忆')
const ctx = ms.retrieveContext('团子今天怎么样了')
assert(ctx.includes('团子'), '检索上下文包含团子记忆')

console.log('\n[4] 召回冷却 + 复读加权')
ms.retrieveContext('团子') // 触发召回 → 进入冷却
ms.save('conversation', '用户养了一只叫团子的橘猫', ['团子', '橘猫'], 4, 'L2') // 冷却期内再次保存
const tuan = ms.listMemories().find((r) => r.content.includes('团子'))
assert(tuan.importance === 5, `冷却期复读 importance 4→5（实际 ${tuan.importance}）`)
const ctx2 = ms.retrieveContext('团子')
assert(ctx2.includes('请勿重复输出'), '冷却拦截后上下文提示勿重复输出')

console.log('\n[5] 完整聊天链路（mock LLM）')
chat.saveSettings({
	baseUrl: 'https://api.example.com/v1',
	apiKey: 'sk-test',
	model: 'gpt-test',
	temperature: 0.8,
	personalityId: 'gentle',
	customPrompt: ''
})
let captured = null
globalThis.uni.request = (opts) => {
	captured = opts
	opts.success({
		statusCode: 200,
		data: {
			choices: [
				{
					message: {
						content:
							'嗨～今天过得怎么样？\nScene: 用户下午在咖啡馆闲聊\nMemory: user_preference 用户喜欢喝冰美式 | keywords:冰美式 | importance:4 | level:L2'
					}
				}
			]
		}
	})
}
const r = await chat.sendMessage('你好')
assert(r.saved === 1, '解析出 1 条记忆并入库')
assert(r.reply.includes('嗨') && !r.reply.includes('Memory:') && !r.reply.includes('Scene:'), '展示文本已清理 Memory/Scene 行')
assert(storage.getScene() === '用户下午在咖啡馆闲聊', 'Scene 行已更新当前情景')
const sys = captured.data.messages[0]
assert(sys.role === 'system' && sys.content.includes('[记忆]'), 'system 包含记忆指南')
assert(sys.content.includes('[情景]') && sys.content.includes('当前时间'), 'system 包含情景指南与时间')
assert(captured.data.messages[captured.data.messages.length - 1].content === '你好', '末尾为用户消息')
assert(kv.get('chabot_chat_history').length === 2, '对话落库 2 条')
// chat.memoryStore 与 ms 共享底层存储 _memories，sendMessage 解析出新记忆
const chatMems = chat.memoryStore.listMemories()
assert(chatMems.some((r) => r.content.includes('冰美式')), '聊天链路包含冰美式记忆')
assert(chatMems.length >= ms.listMemories().length, '聊天链路记忆数 ≥ 手动写入数')

console.log('\n[6] 记忆注入 system（命中用户新话题）')
globalThis.uni.request = (opts) => {
	captured = opts
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '冰美式确实提神！' } }] } })
}
await chat.sendMessage('冰美式好喝吗')
assert(captured.data.messages[0].content.includes('冰美式'), '检索到的记忆注入 system prompt')
assert(captured.data.messages[0].content.includes('用户当前情景'), '当前情景注入 system prompt')

console.log('\n[7] 维护函数可执行')
ms.maintenance()
assert(true, 'maintenance() 无异常')

console.log('\n[8] 虚拟时间模式不发送现实时间')
chat.saveSettings({
	baseUrl: 'https://api.example.com/v1',
	apiKey: 'sk-test',
	model: 'gpt-test',
	temperature: 0.8,
	personalityId: 'gentle',
	customPrompt: '',
	timeMode: 'virtual'
})
globalThis.uni.request = (opts) => {
	captured = opts
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '好的' } }] } })
}
await chat.sendMessage('测试一下')
assert(!captured.data.messages[0].content.includes('当前时间'), '虚拟时间模式不注入现实时间')
// 恢复现实时间
chat.saveSettings({
	baseUrl: 'https://api.example.com/v1',
	apiKey: 'sk-test',
	model: 'gpt-test',
	temperature: 0.8,
	personalityId: 'gentle',
	customPrompt: '',
	timeMode: 'real'
})

console.log('\n================================')
if (failed === 0) {
	console.log('全部断言通过 ✓')
	process.exit(0)
} else {
	console.error(`${failed} 项断言失败 ✗`)
	process.exit(1)
}
