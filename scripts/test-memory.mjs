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
assert(sys.content.includes('[记忆容量]') && sys.content.includes('/20'), 'system 注入 L1 容量状态（chat.js → buildSystemPrompt 接线）')
assert(captured.data.messages[captured.data.messages.length - 1].content === '你好', '末尾为用户消息')
assert(captured.data.stream === false, '请求显式关闭流式（兼容 Ollama 默认流式）')
assert(kv.get('chabot_conversations')[0].messages.length === 2, '对话落库 2 条（存于会话）')
assert(chat.listConversations()[0].title === '你好', '会话标题取首条用户消息')
// chat.memoryStore 与 ms 共享底层存储 _memories，sendMessage 解析出新记忆
const chatMems = chat.memoryStore.listMemories()
assert(chatMems.some((r) => r.content.includes('冰美式')), '聊天链路包含冰美式记忆')
assert(chatMems.length >= ms.listMemories().length, '聊天链路记忆数 ≥ 手动写入数')
// 落库应保存清理后的文本，Scene/Memory 标记不能混入历史（否则切页重载会显示在气泡里）
const stored5 = kv.get('chabot_conversations')[0].messages
assert(!stored5[1].content.includes('Memory:') && !stored5[1].content.includes('Scene:'), '落库内容不含 Scene/Memory 标记行')
assert(!chat.getHistoryForUI().some((m) => /^\s*(Scene|Memory)\s*[:：]/i.test(m.content)), 'UI 历史无 Scene/Memory 标记行')

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
assert(chat.getConversationSettings().personalityId === 'gentle', '保存设置写入当前会话（conv2 变 gentle）')

assert(chat.openConversation(firstId), '切回旧会话')
assert(chat.memoryStore.listMemories().length === memCount, '旧会话记忆独立保留')
assert(chat.getConversationSettings().personalityId === 'tsundere', '旧会话设置独立保留（不受其他会话影响）')
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
// 快速切换：读取预设 → 应用到当前会话设置
const apply = storage.getApiProfile(0)
chat.saveSettings({ ...chat.getConversationSettings(), ...apply })
assert(chat.getConversationSettings().model === 'deepseek-chat', '应用预设后当前会话设置已切换')

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

console.log('\n[16] 会话独立设置（仅作用于当前对话）')
chat.saveConversationPersonality('koishi', '')
assert(chat.getConversationSettings().personalityId === 'koishi', '当前会话人格已改为 koishi')
assert(chat.getSettings().personalityId === 'gentle', '全局默认设置不受影响')
chat.startNewConversation()
assert(chat.getConversationSettings().personalityId === 'koishi', '新对话复制当前设置（koishi）')
chat.saveConversationPersonality('custom', '你是暗夜精灵')
assert(chat.getConversationSettings().personalityId === 'custom', '自定义人格已选中')
assert(chat.getConversationSettings().customPrompt === '你是暗夜精灵', '自定义提示词已保存')
assert(chat.openConversation(firstId), '切回第一个会话')
assert(chat.getConversationSettings().personalityId === 'tsundere', '第一个会话设置独立保留（不受其他会话影响）')

console.log('\n[17] 手动新建记忆与多选删除')
const before17 = ms.listMemories().length
ms.addMemory('用户手工新建的一条记忆', 4, 'L2')
let list17 = ms.listMemories()
assert(list17.length === before17 + 1, '新建记忆新增 1 条')
const new17 = list17.find((r) => r.content === '用户手工新建的一条记忆')
assert(!!new17 && new17.importance === 4, '新建记忆优先级正确')
assert(!!new17 && new17.level === 'L2', '新建记忆级别正确')
// 新建超低优先级自动降 L3 的一致性兜底
ms.addMemory('一条临时琐事', 1, 'L2')
const low17 = ms.listMemories().find((r) => r.content === '一条临时琐事')
assert(!!low17 && low17.level === 'L3', 'importance≤2 自动降 L3')
ms.deleteMemories([new17.id, low17.id])
assert(ms.listMemories().length === before17, '批量删除生效（多选删除底层接口）')

console.log('\n[18] 聊天记录导出文本组装')
const exp = await import('../utils/export.js')
const exportText = exp.buildChatExportText()
assert(exportText.length > 0, '导出文本非空')
assert(exportText.includes('导出时间：'), '导出文本包含导出时间')
assert(exportText.includes('用户：') && exportText.includes('AI：'), '导出文本包含用户/AI 行')
assert(!exportText.includes('undefined'), '导出文本无 undefined/null 残留')

console.log('\n[19] 旧数据标记行展示兜底（切页重载不显示 Scene/Memory）')
// 模拟早期落库的含标记完整回复：UI 加载时应剔除标记、保留正文
storage.addChatRow('assistant', '测试回复正文\nScene: 用户在测试\nMemory: user_fact 旧数据测试 | keywords:测试 | importance:3 | level:L2')
const uiOld = chat.getHistoryForUI()
const lastOld = uiOld[uiOld.length - 1]
assert(lastOld.content.includes('测试回复正文'), '正常文本保留')
assert(!lastOld.content.includes('Scene:') && !lastOld.content.includes('Memory:'), '旧数据标记行在 UI 展示时被剔除')

console.log('\n[20] 回复格式校验与自动重试')
chat.saveSettings({ ...chat.getConversationSettings(), maxRequestAttempts: 5 })
// 第 1 次只输出 Memory 标记、无对话文本 → 自动重试，第 2 次正常
let failOnce = true
globalThis.uni.request = (opts) => {
	captured = opts
	if (failOnce) {
		failOnce = false
		opts.success({
			statusCode: 200,
			data: { choices: [{ message: { content: 'Memory: user_fact 重试测试 | keywords:测试 | importance:3 | level:L2' } }] }
		})
		return
	}
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '这次格式正常啦' } }] } })
}
let r20 = await chat.sendMessage('格式校验测试')
assert(r20.reply === '这次格式正常啦', '重试后返回格式正确的回复')
assert(!r20.reply.includes('Memory:') && !r20.reply.includes('Scene:'), '展示文本不含标记')
let log20 = logsMod.getLogs()
assert(log20.some((l) => l.msg.includes('回复格式不合格')), '日志记录格式不合格并重试')
// 非法 Memory 行（删除操作无目标内容）也触发重试
let badOnce = true
globalThis.uni.request = (opts) => {
	captured = opts
	if (badOnce) {
		badOnce = false
		opts.success({ statusCode: 200, data: { choices: [{ message: { content: '正常文本\nMemory: 删除' } }] } })
		return
	}
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '第二版正常' } }] } })
}
let r20b = await chat.sendMessage('格式校验2')
assert(r20b.reply === '第二版正常', '非法 Memory 行触发重试')
// 伪 Memory 行：含 | keywords:/| importance:/| level: 结构但缺少 Memory: 前缀（如 "✅ 更新：3. xxx"）
let fakeOnce = true
globalThis.uni.request = (opts) => {
	captured = opts
	if (fakeOnce) {
		fakeOnce = false
		opts.success({
			statusCode: 200,
			data: {
				choices: [
					{
						message: {
							content:
								'别跑掉喔，好想要抓紧你。\n✅ 更新：3. user confusion: breathing machine status | keywords:呼吸机 | importance:2 | level:L3'
						}
					}
				]
			}
		})
		return
	}
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '伪格式修复后正常回复' } }] } })
}
let r20c = await chat.sendMessage('伪记忆行测试')
assert(r20c.reply === '伪格式修复后正常回复', '伪 Memory 行（缺少 Memory: 前缀）触发重试')
// 行内 Scene 标记：Scene: 未独立成行（如 "正文 [Scene: xxx]"）也触发重试
let inlineOnce = true
globalThis.uni.request = (opts) => {
	captured = opts
	if (inlineOnce) {
		inlineOnce = false
		opts.success({
			statusCode: 200,
			data: {
				choices: [{ message: { content: '那些复杂的声音……早就坏掉了呢……🌀🧸✨ [Scene: 发光雾中，恋歪头看着用户沉默]' } }]
			}
		})
		return
	}
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '行内Scene修复后回复' } }] } })
}
let r20d = await chat.sendMessage('行内Scene测试')
assert(r20d.reply === '行内Scene修复后回复', '行内 Scene 标记（未独立成行）触发重试')
// 全部尝试都格式不合格 → 达到上限抛错
globalThis.uni.request = (opts) => {
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: 'Scene: 只有场景' } }] } })
}
let threw20 = false
try {
	await chat.sendMessage('格式全部失败')
} catch (e) {
	threw20 = e.message.includes('格式')
}
assert(threw20, '达到最大请求次数后抛错')
log20 = logsMod.getLogs()
assert(log20.some((l) => l.type === 'err' && l.msg.includes('已达请求上限')), '日志记录达上限错误')
// 达上限后：仅落库用户请求（不落库错误回复），"重新生成"基于请求缓存重发且不重复记录用户消息
const rowsFail = storage.getChatRows()
assert(rowsFail[rowsFail.length - 1].role === 'user' && rowsFail[rowsFail.length - 1].content === '格式全部失败', '达上限后仅落库用户请求，无错误回复行')
assert(!rowsFail.some((r) => r.error), '无 error 标记行')
assert(chat.popLastAssistant() === '格式全部失败', '达上限后可重新生成（返回最近一次请求）')
// 模拟聊天页"重新生成"路径（persistUser:false）：只新增 assistant 行，不重复记录用户消息
const rowsBefore20 = storage.getChatRows().length
globalThis.uni.request = (opts) => {
	captured = opts
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '重新生成后的正常回复' } }] } })
}
await chat.sendMessage('格式全部失败', { persistUser: false })
const rowsAfter20 = storage.getChatRows()
assert(rowsAfter20.length === rowsBefore20 + 1, '重新生成只新增 assistant 行，不重复记录用户消息')
assert(rowsAfter20[rowsAfter20.length - 1].role === 'assistant' && rowsAfter20[rowsAfter20.length - 1].content === '重新生成后的正常回复', '重新生成后正常落库新回复')
assert(rowsAfter20[rowsAfter20.length - 2].role === 'user' && rowsAfter20[rowsAfter20.length - 2].content === '格式全部失败', '用户消息仅保留一条')
// 发送失败后重新生成：只处理本次失败请求，不误删此前正常的回复
const failRowsBefore20 = storage.getChatRows().length
globalThis.uni.request = (opts) => {
	captured = opts
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: 'Scene: 只有场景' } }] } })
}
try {
	await chat.sendMessage('失败但前面有正常回复')
} catch (e) {
	/* 预期抛错 */
}
assert(storage.getChatRows().length === failRowsBefore20 + 1, '失败后仅新增用户消息')
assert(chat.popLastAssistant() === '失败但前面有正常回复', '失败后可重新生成该请求')
assert(storage.getChatRows().length === failRowsBefore20 + 1, '此前正常回复未被误删')
globalThis.uni.request = (opts) => {
	captured = opts
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '成功回复' } }] } })
}
await chat.sendMessage('失败但前面有正常回复', { persistUser: false })
const rowsFail2 = storage.getChatRows()
assert(rowsFail2[rowsFail2.length - 1].role === 'assistant' && rowsFail2[rowsFail2.length - 1].content === '成功回复', '重新生成成功落库新回复')
assert(rowsFail2[rowsFail2.length - 2].content === '失败但前面有正常回复', '用户消息仍只有一条')
assert(rowsFail2.some((r) => r.content === '重新生成后的正常回复'), '此前正常回复仍保留')

console.log('\n[21] 重新生成撤回响应记录的情景与记忆')
chat.startNewConversation()
// 准备：已有记忆 + 已有情景，随后响应新增记忆并更新情景
chat.memoryStore.save('user_fact', '用户养了一只狗', ['狗'], 4, 'L2')
storage.setScene('用户在客厅')
globalThis.uni.request = (opts) => {
	captured = opts
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '学吉他不错呀！\nScene: 用户在书房练吉他\nMemory: user_preference 用户最近开始学吉他 | keywords:吉他 | importance:4 | level:L2' } }] } })
}
let r21 = await chat.sendMessage('我在学吉他')
assert(r21.saved === 1, '响应新增了 1 条记忆')
assert(chat.memoryStore.listMemories().some((x) => x.content.includes('吉他')), '响应新增的吉他记忆已入库')
assert(storage.getScene() === '用户在书房练吉他', '响应更新了情景')
const rows21 = storage.getChatRows()
assert(rows21[rows21.length - 1].rollback && typeof rows21[rows21.length - 1].rollback.sceneLenBefore === 'number', 'assistant 行携带回滚信息')
assert(chat.popLastAssistant() === '我在学吉他', '重新生成返回被撤回的用户消息')
assert(storage.getScene() === '用户在客厅', '情景已回滚到响应前')
assert(!chat.memoryStore.listMemories().some((x) => x.content.includes('吉他')), '响应新增的记忆已撤回')
assert(chat.memoryStore.listMemories().some((x) => x.content.includes('狗')), '原有记忆不受影响')
const hist21 = chat.getHistoryForUI()
assert(hist21[hist21.length - 1].content === '我在学吉他', '用户消息保留，assistant 已截断')
// 修改类记忆回滚：响应修改已有记忆 → 重新生成后恢复原内容
chat.memoryStore.save('event', '用户正在准备考研', ['考研'], 4, 'L2')
globalThis.uni.request = (opts) => {
	captured = opts
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '恭喜！\nMemory: 修改 用户正在准备考研 → 用户考研已上岸 | importance:5 | level:L1' } }] } })
}
await chat.sendMessage('考研出成绩了')
assert(chat.memoryStore.listMemories().some((x) => x.content === '用户考研已上岸'), '响应已修改记忆')
chat.popLastAssistant()
const restored21 = chat.memoryStore.listMemories().find((x) => x.content === '用户正在准备考研')
assert(!!restored21 && restored21.importance === 4 && restored21.level === 'L2', '重新生成后修改的记忆恢复原内容')
assert(!chat.memoryStore.listMemories().some((x) => x.content === '用户考研已上岸'), '修改后的内容已撤回')
// 删除类记忆回滚：响应删除已有记忆 → 重新生成后恢复
globalThis.uni.request = (opts) => {
	captured = opts
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '好的\nMemory: 删除 用户养了一只狗' } }] } })
}
await chat.sendMessage('狗送走了')
assert(!chat.memoryStore.listMemories().some((x) => x.content.includes('狗')), '响应已删除记忆')
chat.popLastAssistant()
assert(chat.memoryStore.listMemories().some((x) => x.content.includes('狗')), '重新生成后删除的记忆已恢复')

console.log('\n[22] 虚拟时间模式相对衰减（剧情时刻基准）')
// 当前会话设为 virtual，再新建会话（复制 virtual 设置、记忆为空），避免残留记忆的访问时间干扰剧情时刻
chat.saveSettings({ ...chat.getConversationSettings(), timeMode: 'virtual' })
chat.startNewConversation()
const st22 = chat.memoryStore
// 构造两条现实时间 10 天前创建的记忆
st22.addMemory('虚拟剧情旧记忆A', 4, 'L2')
st22.addMemory('虚拟剧情旧记忆B', 4, 'L2')
for (const r of st22.listMemories()) {
	r.created_at = new Date(Date.now() - 10 * 86400000).toISOString()
}
storage.persistMemories()
// 虚拟模式：无新剧情推进 → 剧情时刻 = 10 天前 → 相对年龄 0 → 不衰减
const oldA = st22.listMemories().find((r) => r.content === '虚拟剧情旧记忆A')
assert(st22.effectiveImportance(oldA) >= 3.99, '虚拟模式现实中断 10 天记忆不衰减')
// 同一条记忆在 real 模式（临时切换会话快照）应正常衰减
storage.setConversationPersonality({ ...storage.getConversationPersonality(), timeMode: 'real' })
assert(st22.effectiveImportance(oldA) < 3.99, '同一记忆 real 模式正常衰减')
storage.setConversationPersonality({ ...storage.getConversationPersonality(), timeMode: 'virtual' })
// 新记忆产生后，剧情时刻推进 → 旧记忆相对衰减
st22.addMemory('虚拟剧情新记忆', 4, 'L2')
const oldB = st22.listMemories().find((r) => r.content === '虚拟剧情旧记忆B')
const newM = st22.listMemories().find((r) => r.content === '虚拟剧情新记忆')
assert(st22.effectiveImportance(oldB) < 3.99, '新记忆产生后旧记忆相对衰减')
assert(st22.effectiveImportance(newM) >= 3.99, '最新记忆不衰减')
// 时间标签：虚拟模式为相对指示
assert(st22.formatTime(newM.created_at) === '（较新）', `虚拟模式时间标签为相对指示（${st22.formatTime(newM.created_at)}）`)

console.log('\n[23] L1 上限硬兜底（20 条自动降级）与全量召回')
// 批量写入 30 条 L1（addMemory 强制 L1 importance≥3）→ 超限部分自动降级为 L2
for (let i = 0; i < 30; i++) {
	chat.memoryStore.addMemory(`L1批量测试记忆${i}`, (i % 5) + 1, 'L1')
}
const l1s23 = chat.memoryStore.listMemories().filter((r) => r.level === 'L1')
assert(l1s23.length === 20, `L1 数量恰好收敛到上限 20（实际 ${l1s23.length}）`)
const demoted23 = chat.memoryStore.listMemories().filter((r) => r.level === 'L2' && r.content.startsWith('L1批量测试记忆'))
assert(demoted23.length === 10, `超限 10 条自动降级为 L2（实际 ${demoted23.length}）`)
assert(demoted23.some((r) => r.content === 'L1批量测试记忆0'), '重要性最低（最早创建的 i3）优先被降级')
assert(chat.memoryStore.listMemories().some((r) => r.content === 'L1批量测试记忆29'), '重要性最高的 L1 保留')
const usage23 = chat.memoryStore.l1Usage()
assert(usage23.max === 20 && usage23.count === 20, `l1Usage 返回容量状态（${usage23.count}/${usage23.max}）`)
// 全量召回：retrieveContext 输出包含所有 L1
const l1Contents23 = l1s23.map((r) => r.content)
const ctx23 = chat.memoryStore.retrieveContext('')
assert(l1Contents23.every((c) => ctx23.includes(c)), 'retrieveContext 全量召回所有 L1')
// 修改操作把 L2 提为 L1 超限时同样受硬兜底约束
chat.memoryStore.save('event', 'L1硬兜底测试-L2', ['L1'], 5, 'L2')
chat.memoryStore.saveFromLine('Memory: 修改 L1硬兜底测试-L2 → L1硬兜底测试-提级 | importance:5 | level:L1')
const l1AfterMod23 = chat.memoryStore.listMemories().filter((r) => r.level === 'L1')
assert(l1AfterMod23.length === 20, '修改提级超限时 L1 仍被约束在 20')
assert(l1AfterMod23.some((r) => r.content === 'L1硬兜底测试-提级'), '提级记忆保留（importance 最高优先）')
// 容量状态注入（buildSystemPrompt 方案 B 辅助段）
const prompts23 = await import('../utils/prompts.js')
const sys23 = prompts23.buildSystemPrompt('人格', '记忆文本', [], '', [], { count: 20, max: 20 })
assert(sys23.includes('[记忆容量]') && sys23.includes('20/20'), 'buildSystemPrompt 注入 L1 容量状态')
assert(!prompts23.buildSystemPrompt('人格', '记忆文本', [], '', [], null).includes('[记忆容量]'), '未传 l1Usage 时不注入容量段')

console.log('\n[24] 拟真聊天（countSentences / 格式校验 / burst 落库 / 主动消息链路）')
// countSentences 纯函数
assert(chat.countSentences('在吗') === 0, 'countSentences：无句末标点为 0')
assert(chat.countSentences('在吗？') === 1, 'countSentences：单句为 1')
assert(chat.countSentences('哈哈。。') === 1, 'countSentences：连续标点合并为 1')
assert(chat.countSentences('好的。好的！') === 2, 'countSentences：两句为 2')
assert(chat.countSentences('嗯嗯~') === 0, 'countSentences：语气词"~"不计句')
// parseAndValidateReply 拟真模式校验
let pv = chat.parseAndValidateReply('今天天气真好。适合出门散步。', { proactive: true })
assert(pv.ok === false && pv.reason.includes('超过一句话'), '拟真模式：一条消息两句话判定不合格')
const emoMod = await import('../utils/emojis.js')
emoMod.addEmojiData('小狗', 'src://dog')
emoMod.addEmojiData('小猫', 'src://cat')
emoMod.addEmojiData('兔子', 'src://rabbit')
pv = chat.parseAndValidateReply('好的呀 $小狗$ $小猫$ $兔子$', { proactive: true })
assert(pv.ok === false && pv.reason.includes('连续表情'), '拟真模式：连续表情超过 2 个判定不合格')
pv = chat.parseAndValidateReply('在吗？\n今天天气真好~', { proactive: true })
assert(pv.ok === true, '拟真模式：换行分条且每条 ≤1 句通过校验')
pv = chat.parseAndValidateReply('在吗？', { proactive: false })
assert(pv.ok === true, '非拟真模式不受一句话约束')
// 启用拟真 + 无用户消息 → 非 force 不触发
chat.saveSettings({
	baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'gpt-test',
	temperature: 0.8, personalityId: 'gentle', customPrompt: '', timeMode: 'real',
	proactiveEnabled: true, proactiveStartMin: 0, proactiveEndMin: 1439, proactiveLevel: 'medium'
})
const pa = await import('../utils/chat-proactive.js')
const rows24 = storage.getChatRows()
assert(rows24.length === 0 || rows24.every((r) => r.role !== 'user'), '当前会话无用户消息（拟真门禁前置）')
let r24 = await pa.sendProactiveBurst()
assert(r24 === null, '非调试：尚无用户消息时不主动发（返回 null）')
const { getLogs: getDebugLogs } = await import('../utils/log.js')
assert(getDebugLogs().some((l) => l.msg === '主动消息跳过'), '被门禁拦截时必须写「主动消息跳过」日志（杜绝"只见调度、无任何输出"）')
// 自定义倒计时为调试工具：即使当前会话无用户消息，也绕过用户消息门禁照常发送
chat.saveSettings({ ...chat.getConversationSettings(), proactiveCustomSeconds: 12 })
globalThis.uni.request = (opts) => {
	captured = opts
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '测试主动消息\nScene: 用户在测试' } }] } })
}
r24 = await pa.sendProactiveBurst()
assert(!!r24 && r24.lines[0] === '测试主动消息', '自定义倒计时（调试）：无用户消息也触发发送')
chat.saveSettings({ ...chat.getConversationSettings(), proactiveCustomSeconds: 0 })
r24 = await pa.sendProactiveBurst()
assert(r24 === null, '清除自定义倒计时后，无用户消息仍不主动发（返回 null）')
// 补一条用户消息，非 force 可触发
storage.addChatRow('user', '在吗')
globalThis.uni.request = (opts) => {
	captured = opts
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '在呢~ 你吃饭了吗？\nScene: 用户晚上在家休息' } }] } })
}
r24 = await pa.sendProactiveBurst()
assert(!!r24 && r24.lines.length === 1, '非调试：到期触发发送成功（单条 burst）')
assert(captured.data.messages[0].content.includes('[拟真聊天]'), '主动消息 system 注入拟真规则')
assert(captured.data.messages[captured.data.messages.length - 1].role === 'user', '末尾为内部指令行（不落库）')
assert(storage.getChatRows()[storage.getChatRows().length - 1].content === '在呢~ 你吃饭了吗？', '主动消息落库为 assistant 行')
assert(storage.getScene() === '用户晚上在家休息', '主动消息更新情景')
// 主动消息格式不合格自动重试
let failP = true
globalThis.uni.request = (opts) => {
	captured = opts
	if (failP) {
		failP = false
		opts.success({ statusCode: 200, data: { choices: [{ message: { content: '今天过得怎么样呀。你吃饭了吗。' } }] } })
		return
	}
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '今天过得怎么样呀' } }] } })
}
r24 = await pa.sendProactiveBurst()
assert(!!r24 && r24.lines[0] === '今天过得怎么样呀', '主动消息超过一句话自动重试后成功')
// 调试按钮：忽略拟真开关仍可强制发送（仅校验 API 配置）
chat.saveSettings({ ...chat.getConversationSettings(), proactiveEnabled: false })
globalThis.uni.request = (opts) => {
	captured = opts
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '调试消息' } }] } })
}
r24 = await pa.debugProactiveMessage()
assert(!!r24 && r24.lines[0] === '调试消息', '调试按钮：未开启拟真也可强制发送一条')
// 恢复拟真开，测试 sendMessage 的 burst 拆分与重新生成移除连续行
chat.saveSettings({ ...chat.getConversationSettings(), proactiveEnabled: true })
const rowsB = storage.getChatRows().length
globalThis.uni.request = (opts) => {
	captured = opts
	opts.success({ statusCode: 200, data: { choices: [{ message: { content: '第一条\n第二条\nScene: 用户在沙发上' } }] } })
}
const r24b = await chat.sendMessage('帮我看看')
assert(Array.isArray(r24b.burst) && r24b.burst.length === 2, '拟真 sendMessage 返回 burst 数组')
const rowsAfterB = storage.getChatRows()
assert(rowsAfterB[rowsAfterB.length - 2].content === '第一条' && rowsAfterB[rowsAfterB.length - 1].content === '第二条', 'burst 按换行拆为多条 assistant 行')
assert(!!rowsAfterB[rowsAfterB.length - 1].rollback, 'burst 最后一行携带 rollback')
assert(storage.getScene() === '用户在沙发上', 'burst 回复更新情景')
assert(chat.popLastAssistant() === '帮我看看', '重新生成返回被撤回的用户消息')
assert(storage.getChatRows().length === rowsB + 1, 'burst 行全部移除，用户消息保留待重发')
assert(storage.getChatRows()[storage.getChatRows().length - 1].content === '帮我看看', '重发后最后一行为用户消息')
// 调度与倒计时：开启后 catchUpProactive 重排并返回倒计时；关闭后定时器清空
chat.saveSettings({ ...chat.getConversationSettings(), proactiveEnabled: true })
pa.catchUpProactive()
const cd = pa.getProactiveCountdown()
assert(cd !== null && cd > 0, '调度后 getProactiveCountdown 返回倒计时（毫秒）')
// 自定义倒计时：rearmProactive 强制按新值重排（>0 时固定秒数，下限 10s），清 0 恢复档位
const cdBefore = pa.getProactiveCountdown()
chat.saveSettings({ ...chat.getConversationSettings(), proactiveCustomSeconds: 30 })
pa.catchUpProactive() // catchUp 不强制重排：定时器已挂载时保持原倒计时
assert(pa.getProactiveCountdown() === cdBefore || (pa.getProactiveCountdown() !== null && Math.abs(pa.getProactiveCountdown() - cdBefore) < 1000), 'catchUp 不改设置时不重置倒计时')
pa.rearmProactive()
const cdCustom = pa.getProactiveCountdown()
assert(cdCustom !== null && cdCustom >= 25000 && cdCustom <= 31000, 'rearm 后自定义 30 秒倒计时约 30 秒')
chat.saveSettings({ ...chat.getConversationSettings(), proactiveCustomSeconds: 0 })
pa.rearmProactive()
const cdLevel = pa.getProactiveCountdown()
assert(cdLevel !== null && cdLevel >= 60000, '清 0 后恢复档位随机间隔（≥60s）')
// 调度鲁棒性：loading 抑制只拦发送不杀调度；解除后仍健康
pa.setProactiveSuppressed(true)
pa.catchUpProactive()
assert(pa.getProactiveCountdown() !== null, '抑制期间调度器仍保持重排（倒计时存在）')
pa.setProactiveSuppressed(false)
assert(pa.getProactiveCountdown() !== null, '解除抑制后调度健康（倒计时恢复）')
chat.saveSettings({ ...chat.getConversationSettings(), proactiveEnabled: false })
pa.catchUpProactive()
assert(pa.getProactiveCountdown() === null, '关闭拟真后无倒计时（定时器已清空）')
// 关闭拟真，恢复常规行为
chat.saveSettings({ ...chat.getConversationSettings(), proactiveEnabled: false })

console.log('\n================================')
if (failed === 0) {
	console.log('全部断言通过 ✓')
	process.exit(0)
} else {
	console.error(`${failed} 项断言失败 ✗`)
	process.exit(1)
}
