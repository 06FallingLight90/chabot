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
// 等待数毫秒，确保新写入的 created_at 晚于此前记忆，避免 queryRecent 因毫秒级并列跳过目标
await new Promise((r) => setTimeout(r, 10))
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
assert(captured.data.stream === false, '请求显式关闭流式（兼容 Ollama 默认流式）')
assert(kv.get('chabot_conversations')[0].messages.length === 2, '对话落库 2 条（存于会话）')
assert(chat.listConversations()[0].title === '你好', '会话标题取首条用户消息')
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

console.log('\n[9] 会话管理（历史对话 / 开始新对话）')
let convs = chat.listConversations()
assert(convs.length === 1, '当前只有 1 个会话')
const firstId = convs[0].id
assert(chat.activeConversationId() === firstId, '当前会话为第一个会话')
chat.startNewConversation()
assert(chat.getHistoryForUI().length === 0, '开始新对话后当前消息为空')
assert(chat.listConversations().length === 2, '旧会话归档保留，共 2 个会话')
const newId = chat.activeConversationId()
assert(newId !== firstId, '当前会话已切到新会话')
storage.addChatRow('user', '新会话的首条消息')
assert(chat.getHistoryForUI().length === 1, '新会话写入 1 条')
assert(chat.openConversation(firstId), '切回旧会话成功')
assert(chat.getHistoryForUI().length >= 2, '旧会话消息已恢复')
assert(chat.listConversations()[0].title === '新会话的首条消息', '新会话标题自动生成')
assert(chat.removeConversation(newId), '删除第二个会话')
assert(chat.listConversations().length === 1, '删除后回到 1 个会话')
assert(chat.activeConversationId() === firstId, '删除非当前会话不影响当前会话')

console.log('\n[10] 上下文压缩（LLM 概要 + 后续注入）')
// 补足消息量：当前会话（含此前 3 轮）再落库 10 轮
for (let i = 0; i < 10; i++) {
	storage.addChatRow('user', '压缩测试消息' + i)
	storage.addChatRow('assistant', '回复' + i)
}
const rowCount = chat.getHistoryForUI().length
globalThis.uni.request = (opts) => {
	captured = opts
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '这是压缩后的对话概要，保留了关键信息。' } }] } })
}
const compressed = await chat.compressContext(true)
assert(compressed === true, '手动压缩执行成功')
const cp = storage.getConversationCompression()
assert(cp.summary.includes('对话概要'), '概要已保存')
assert(cp.compressedUntil === rowCount - 10, `压缩进度 = 总数 - 保留尾部（${cp.compressedUntil}）`)
globalThis.uni.request = (opts) => {
	captured = opts
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '好的~' } }] } })
}
await chat.sendMessage('压缩后继续聊')
assert(captured.data.messages.some((m) => m.role === 'system' && m.content.includes('此前对话概要')), '后续请求注入压缩概要')
const sysCount = captured.data.messages.filter((m) => m.role === 'system').length
assert(sysCount === 1, '仅一条 system 消息（概要已并入首条）')
assert(captured.data.messages[0].role === 'system', 'system 位于消息最前（Ollama 模板要求）')
const sentAll = captured.data.messages.map((m) => m.content).join('\n')
assert(!sentAll.includes('压缩测试消息0'), '被压缩的早期消息不再发送')
assert(!sentAll.includes('你好'), '更早的原始消息不再发送')

console.log('\n[11] 调试日志（LLM 请求/响应 + 操作日志 + 清空）')
const logsMod = await import('../utils/log.js')
let logs = logsMod.getLogs()
assert(logs.some((l) => l.type === 'req' && l.msg.includes('LLM 请求')), '包含 LLM 请求日志')
assert(logs.some((l) => l.type === 'res' && l.msg.includes('LLM 响应')), '包含 LLM 响应日志')
const reqLog = logs.find((l) => l.type === 'req')
assert(reqLog.detail.includes('请求内容') && reqLog.detail.includes('压缩后继续聊'), '请求日志包含完整请求内容')
const resLog = logs.find((l) => l.type === 'res')
assert(resLog.detail.includes('返回内容') && resLog.detail.includes('好的~'), '响应日志包含完整返回内容')
const compLog = logs.find((l) => l.type === 'info' && l.msg.includes('压缩上文'))
assert(compLog.detail.includes('压缩后上文') && compLog.detail.includes('这是压缩后的对话概要'), '压缩日志包含完整压缩后上文')
assert(logs.some((l) => l.type === 'info' && l.msg.includes('发送消息')), '包含操作日志（发送消息）')
assert(logs.some((l) => l.type === 'info' && l.msg.includes('压缩上文')), '包含操作日志（压缩上文）')
const newest = logs[0]
assert(newest && newest.time && newest.msg, '日志含时间与摘要字段')
logsMod.addLog('err', '测试错误', 'detail-text')
assert(logsMod.getLogs()[0].type === 'err', '错误日志可记录且排在最前')
const logsBefore = logsMod.getLogs().length
logsMod.clearLogs()
assert(logsMod.getLogs().length === 0 && logsBefore > 0, '清空日志生效')

console.log('\n[12] 会话独立记忆 / 人格快照 / 情景 / 复制')
const memCount = chat.memoryStore.listMemories().length
assert(memCount > 0, '当前会话存在记忆')
storage.setScene('旧会话情景')
assert(storage.getScene() === '旧会话情景', '旧会话可记录情景')

chat.saveSettings({
	baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'gpt-test',
	temperature: 0.8, personalityId: 'tsundere', customPrompt: '', timeMode: 'real'
})
chat.startNewConversation()
assert(chat.memoryStore.listMemories().length === 0, '新会话记忆独立为空（各会话分开存储）')
assert(chat.getConversationSettings().personalityId === 'tsundere', '新会话快照人格 tsundere')
assert(storage.getScene() === '', '新会话情景独立为空')
storage.setScene('新会话情景')
assert(storage.getScene() === '新会话情景', '新会话可独立记录情景')

chat.saveSettings({
	baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'gpt-test',
	temperature: 0.8, personalityId: 'gentle', customPrompt: '', timeMode: 'real'
})
assert(chat.getConversationSettings().personalityId === 'tsundere', '全局人格变更不影响会话快照')

assert(chat.openConversation(firstId), '切回旧会话')
assert(chat.memoryStore.listMemories().length === memCount, '旧会话记忆独立保留')
assert(chat.getConversationSettings().personalityId === 'gentle', '未快照会话回退全局人格')
assert(storage.getScene() === '旧会话情景', '旧会话情景独立保留')

chat.copyConversationToNew()
assert(chat.getHistoryForUI().length >= 2, '复制对话：消息已复制')
assert(chat.memoryStore.listMemories().length === memCount, '复制对话：记忆已复制')
assert(chat.listConversations().some((c) => c.title.includes('副本')), '复制对话：标题带副本后缀')
assert(storage.getScene() === '旧会话情景', '复制对话：情景随会话复制')

assert(chat.openConversation(firstId), '再次切回旧会话')
chat.copyMemoriesToNew()
assert(chat.getHistoryForUI().length === 0, '复制记忆：新会话消息为空')
assert(chat.memoryStore.listMemories().length === memCount, '复制记忆：记忆数量一致')
assert(storage.getScene() === '', '复制记忆：新会话情景从零开始')

console.log('\n[13] API 配置预设（至多 3 套快速切换）')
assert(storage.getApiProfiles().length === 0, '初始无预设')
assert(storage.saveApiProfile(0, 'DeepSeek', { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-a', model: 'deepseek-chat', temperature: 0.6 }), '保存第 1 套')
assert(storage.saveApiProfile(1, 'OpenAI', { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-b', model: 'gpt-4o-mini', temperature: 0.8 }), '保存第 2 套')
assert(storage.saveApiProfile(2, 'Kimi', { baseUrl: 'https://api.moonshot.cn/v1', apiKey: 'sk-c', model: 'moonshot-v1-8k', temperature: 0.5 }), '保存第 3 套')
assert(storage.getApiProfiles().length === 3, '已保存 3 套')
assert(storage.saveApiProfile(3, 'X', { baseUrl: 'x', apiKey: 'x', model: 'x' }) === false, '超出 3 套上限被拒绝')
let p0 = storage.getApiProfile(0)
assert(p0 && p0.model === 'deepseek-chat', '读取第 1 套模型正确')
assert(p0 && p0.apiKey === 'sk-a', '读取第 1 套 apiKey 正确')
assert(storage.saveApiProfile(1, 'OpenAI 新版', { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-b2', model: 'gpt-4o', temperature: 0.9 }), '覆盖第 2 套')
assert(storage.getApiProfiles().length === 3, '覆盖后仍是 3 套')
assert(storage.getApiProfile(1).model === 'gpt-4o', '覆盖后模型已更新')
assert(storage.deleteApiProfile(2), '删除第 3 套')
assert(storage.getApiProfiles().length === 2, '删除后剩 2 套')
assert(storage.getApiProfile(2) === null, '被删槽位读取为 null')
assert(storage.deleteApiProfile(9) === false, '越界删除被拒绝')
// 快速切换：读取预设 → 应用到全局设置
const apply = storage.getApiProfile(0)
chat.saveSettings({ ...chat.getSettings(), ...apply })
assert(chat.getSettings().model === 'deepseek-chat', '应用预设后全局设置已切换')

console.log('\n[14] SSE 流式响应兜底解析（兼容 Ollama 无视 stream:false）')
const llm = await import('../utils/llm.js')
// OpenAI 兼容流式：choices[].delta.content 增量
const sseBody = [
	'data: {"choices":[{"delta":{"role":"assistant","content":"你好"}}]}',
	'data: {"choices":[{"delta":{"content":"呀"}}]}',
	'data: {"choices":[{"delta":{"content":"，今天怎么样"}}]}',
	'data: [DONE]'
].join('\n')
globalThis.uni.request = (opts) => {
	opts.success({ statusCode: 200, data: sseBody })
}
let st = await llm.chatCompletion({
	baseUrl: 'http://192.168.1.10:11434/v1',
	apiKey: 'x',
	model: 'llama3.2',
	messages: [{ role: 'user', content: 'hi' }]
})
assert(st.text === '你好呀，今天怎么样', `流式增量已合并（实际：${st.text}）`)
// Ollama 原生流式：message.content 增量
const sseBody2 = ['data: {"message":{"role":"assistant","content":"嗨"}}', 'data: {"message":{"role":"assistant","content":"！"}}', 'data: {"done":true}'].join('\n')
globalThis.uni.request = (opts) => {
	opts.success({ statusCode: 200, data: sseBody2 })
}
st = await llm.chatCompletion({
	baseUrl: 'http://192.168.1.10:11434/v1',
	apiKey: 'x',
	model: 'llama3.2',
	messages: [{ role: 'user', content: 'hi' }]
})
assert(st.text === '嗨！', 'Ollama 原生流式格式兼容')

console.log('\n[15] 思考模式（reasoning_effort）与思考内容兜底')
let cap15 = null
// 请求携带 reasoning_effort:none
globalThis.uni.request = (opts) => {
	cap15 = opts
	opts.success({ statusCode: 200, data: { choices: [{ message: { role: 'assistant', content: '正常回答' } }] } })
}
st = await llm.chatCompletion({
	baseUrl: 'http://192.168.1.10:11434/v1',
	apiKey: 'x',
	model: 'qwen3.5:9b',
	messages: [{ role: 'user', content: 'hi' }],
	reasoningEffort: 'none'
})
assert(cap15.data.reasoning_effort === 'none', '请求携带 reasoning_effort:none')
// content 为空、reasoning 有值 → 兜底展示思考内容（Qwen3.5 的典型表现）
globalThis.uni.request = (opts) => {
	opts.success({
		statusCode: 200,
		data: { choices: [{ message: { role: 'assistant', content: '', reasoning: '思考过程…' } }] }
	})
}
st = await llm.chatCompletion({
	baseUrl: 'http://x/v1',
	apiKey: 'x',
	model: 'qwen3.5:9b',
	messages: [{ role: 'user', content: 'hi' }]
})
assert(st.text === '思考过程…', `content 为空时兜底读取 reasoning（实际：${st.text}）`)
// thinking 字段同样兜底
globalThis.uni.request = (opts) => {
	opts.success({
		statusCode: 200,
		data: { choices: [{ message: { role: 'assistant', content: '', thinking: '推理A' } }] }
	})
}
st = await llm.chatCompletion({
	baseUrl: 'http://x/v1',
	apiKey: 'x',
	model: 'qwen3.5:9b',
	messages: [{ role: 'user', content: 'hi' }]
})
assert(st.text === '推理A', 'thinking 字段兜底')
// 服务端不识别 reasoning_effort → 400 降级重试（移除参数）
let firstCall = true
globalThis.uni.request = (opts) => {
	if (firstCall) {
		firstCall = false
		opts.success({ statusCode: 400, data: { error: { message: 'Unrecognized request argument: reasoning_effort' } } })
		return
	}
	cap15 = opts
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '降级成功' } }] } })
}
st = await llm.chatCompletion({
	baseUrl: 'https://api.openai.com/v1',
	apiKey: 'sk',
	model: 'gpt-4o',
	messages: [{ role: 'user', content: 'hi' }],
	reasoningEffort: 'none'
})
assert(st.text === '降级成功', '400 后移除 reasoning_effort 降级重试成功')
assert(!('reasoning_effort' in cap15.data), '重试请求不再携带 reasoning_effort')

console.log('\n[16] 会话独立人格设置（仅作用于当前对话）')
chat.saveConversationPersonality('koishi', '')
assert(chat.getConversationSettings().personalityId === 'koishi', '当前会话人格已改为 koishi')
assert(chat.getSettings().personalityId === 'gentle', '全局人格不受影响')
chat.startNewConversation()
assert(chat.getConversationSettings().personalityId === 'gentle', '新会话回退全局人格')
chat.saveConversationPersonality('custom', '你是暗夜精灵')
assert(chat.getConversationSettings().personalityId === 'custom', '自定义人格已选中')
assert(chat.getConversationSettings().customPrompt === '你是暗夜精灵', '自定义提示词已保存')
assert(chat.openConversation(firstId), '切回第一个会话')
assert(chat.getConversationSettings().personalityId === 'gentle', '第一个会话人格独立保留（不受其他会话影响）')

console.log('\n================================')
if (failed === 0) {
	console.log('全部断言通过 ✓')
	process.exit(0)
} else {
	console.error(`${failed} 项断言失败 ✗`)
	process.exit(1)
}
