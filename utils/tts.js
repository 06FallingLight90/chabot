/**
 * TTS 语音阅读 —— 把 LLM 回复合成语音并播放（默认对接 Qwen-TTS 非实时语音合成）
 *
 * 流程：文本（剔除 $表情名$ 占位，表情包不朗读）→ 调 TTS 接口拿音频 URL →
 * InnerAudioContext 直接播放远程音频。不落地成文件：播放完即销毁播放器，
 * 不占用持久存储空间（满足"语音文件不保存，仅播放一次后删除"）。
 *
 * 接口（Qwen-TTS 非实时，阿里云百炼 / 通义千问）：
 *   POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
 *   Body: { model, input: { text, voice } }
 *   非流式响应：output.audio.url（音频文件直链，有效期 24 小时）
 *   音色列表参考：https://platform.qianwenai.com/docs/api-reference/speech-synthesis/qwen-tts/voice-list
 */

import { splitEmojiText, getEmojiMap } from './emojis.js'
import { addLog } from './log.js'

export const TTS_DEFAULT_MODEL = 'qwen3-tts-flash'
export const TTS_DEFAULT_VOICE = 'Cherry'
const TTS_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
const TTS_MAX_CHARS = 500 // Qwen-TTS 单次输入约 600 字符上限，留余量截断，避免长回复合成失败
const TTS_TIMEOUT_MS = 60000

/** HTML5 媒体错误码含义（uni InnerAudioContext onError 在 H5 端返回的 MediaError.code；App 端 uni 不暴露 code） */
const MEDIA_ERRORS = {
	1: '加载被中止（可能被系统打断）',
	2: '网络错误（音频下载失败，多为瞬时网络波动）',
	3: '解码失败（音频格式不受当前设备播放器支持）',
	4: '音频源不支持（格式或地址无效）'
}

/** 解析播放错误详情：App 端 uni 只回传 errMsg='MediaError' 且不带 code，尽力抓取所有可用字段，无法识别则输出原始结构便于排查 */
function _playErrorDetail(err) {
	if (!err) return '未知错误'
	const code = err.code !== undefined ? err.code : err.errorCode !== undefined ? err.errorCode : ''
	const msg = err.errMsg || err.message || err.msg || ''
	let raw = ''
	try { raw = JSON.stringify(err) } catch (e) { /* 忽略 */ }
	const parts = []
	if (code !== '') parts.push(`code=${code}${MEDIA_ERRORS[code] ? '（' + MEDIA_ERRORS[code] + '）' : ''}`)
	if (msg) parts.push(String(msg))
	if (raw && raw !== '{}' && raw !== '""' && raw !== '"MediaError"' && raw.indexOf('"errMsg":"MediaError"') === -1) {
		parts.push('raw=' + raw.slice(0, 200))
	}
	return parts.join(' · ') || String(err) || '未知错误'
}

/**
 * 常用音色清单（Qwen-TTS 官方音色节选，含部分方言音色；完整列表见官方文档链接）。
 * 未收录的自定义音色（如声音复刻/声音设计产物）可直接在设置里手动输入。
 */
export const TTS_VOICES = [
	{ name: 'Cherry', desc: '阳光积极、亲切自然小姐姐' },
	{ name: 'Serena', desc: '温柔小姐姐' },
	{ name: 'Ethan', desc: '阳光、温暖、活力、朝气（男）' },
	{ name: 'Chelsie', desc: '二次元虚拟女友' },
	{ name: 'Momo', desc: '撒娇搞怪，逗你开心' },
	{ name: 'Vivian', desc: '拽拽的、可爱的小暴躁' },
	{ name: 'Moon', desc: '率性帅气的月白（男）' },
	{ name: 'Maia', desc: '知性与温柔的碰撞' },
	{ name: 'Kai', desc: '耳朵的一场 SPA（男）' },
	{ name: 'Nofish', desc: '不会翘舌音的设计师（男）' },
	{ name: 'Bella', desc: '喝酒不打醉拳的小萝莉' },
	{ name: 'Jennifer', desc: '品牌级、电影质感般美语女声' },
	{ name: 'Ryan', desc: '节奏拉满，戏感炸裂（男）' },
	{ name: 'Katerina', desc: '御姐音色，韵律回味十足' },
	{ name: 'Aiden', desc: '精通厨艺的美语大男孩' },
	{ name: 'Eldric Sage', desc: '沉稳睿智的老者（男）' },
	{ name: 'Mia', desc: '温顺如春水，乖巧如初雪' },
	{ name: 'Mochi', desc: '聪明伶俐的小大人（男）' },
	{ name: 'Bellona', desc: '声音洪亮，字正腔圆的江湖气' },
	{ name: 'Vincent', desc: '独特的沙哑烟嗓（男）' },
	{ name: 'Bunny', desc: '“萌属性”爆棚的小萝莉' },
	{ name: 'Neil', desc: '专业新闻主持人（男）' },
	{ name: 'Elias', desc: '严谨又循循善诱的讲师' },
	{ name: 'Arthur', desc: '质朴嗓音，慢摇乡间故事（男）' },
	{ name: 'Nini', desc: '又软又黏的甜嗓，会叫哥哥' },
	{ name: 'Seren', desc: '温和舒缓，助你入眠' },
	{ name: 'Pip', desc: '调皮捣蛋的小新（男）' },
	{ name: 'Stella', desc: '甜到发腻的迷糊少女 + 爱与正义' },
	{ name: 'Jada', desc: '风风火火的沪上阿姐（上海话）' },
	{ name: 'Dylan', desc: '北京胡同里长大的少年（北京话）' },
	{ name: 'Li', desc: '耐心的瑜伽老师（南京话，男）' },
	{ name: 'Sunny', desc: '甜到你心里的川妹子（四川话）' },
	{ name: 'Rocky', desc: '幽默风趣的阿强（粤语，男）' },
	{ name: 'Kiki', desc: '甜美的港妹闺蜜（粤语）' },
	{ name: 'Peter', desc: '天津相声，专业捧哏（天津话，男）' }
]

/** 音色名清单（设置页选择器用） */
export const TTS_VOICE_NAMES = TTS_VOICES.map((v) => v.name)

/** 音色描述（未收录的自定义音色返回空串） */
export function ttsVoiceDesc(name) {
	const v = TTS_VOICES.find((x) => x.name === name)
	return v ? v.desc : ''
}

let _ctx = null // 当前播放的音频上下文（模块级，一次只播一条）
let _seq = 0    // 朗读请求序号：新请求/主动停止时自增，用于作废仍在途的合成请求

/** 停止当前朗读（新消息播放前 / 页面切换 / 卸载时调用） */
export function stopSpeaking() {
	_seq++ // 作废所有进行中的 TTS 合成请求，避免其随后创建播放器
	_stopCtx()
}

/**
 * 提取待朗读文本：按 $表情名$ 拆段，只保留文本段（表情包不朗读），并截断到接口输入上限。
 * 清单外的未知 $名$ 会保留在文本段中（与消息渲染行为一致），照常朗读。
 * @param {string} content 消息原文（可含 $表情名$ 占位）
 * @returns {string}
 */
export function textForSpeech(content) {
	const rows = splitEmojiText(content, getEmojiMap())
	const text = rows
		.filter((r) => r.type === 'text')
		.map((r) => r.text)
		.join('\n')
		.trim()
	return text.slice(0, TTS_MAX_CHARS)
}

function uniRequest(options) {
	return new Promise((resolve, reject) => {
		uni.request({
			...options,
			success: (res) => resolve(res),
			fail: (err) => reject(new Error((err && err.errMsg) || '网络请求失败'))
		})
	})
}

/** 停止并清理当前播放器（不参与请求序号，供播放前/主动停止调用） */
function _stopCtx() {
	if (_ctx) {
		const c = _ctx
		_ctx = null
		try { c.stop() } catch (e) { /* 已结束则忽略 */ }
		try { c.destroy() } catch (e) { /* 已销毁则忽略 */ }
	}
}

/** 调用 TTS 接口合成文本，返回音频 URL；失败返回空串（错误已写入调试日志） */
async function _synthesize({ apiKey, model, voice, text }) {
	let res
	try {
		res = await uniRequest({
			url: TTS_ENDPOINT,
			method: 'POST',
			timeout: TTS_TIMEOUT_MS,
			header: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer ' + apiKey
			},
			data: { model, input: { text, voice } }
		})
	} catch (e) {
		addLog('err', 'TTS 网络错误', e.message)
		return ''
	}
	const url = res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.output && res.data.output.audio
		? res.data.output.audio.url
		: ''
	if (!url) {
		const detail = (res.data && (res.data.message || res.data.code)) || `状态码 ${res.statusCode}`
		addLog('err', 'TTS 合成失败', String(detail).slice(0, 200))
		return ''
	}
	return url
}

/** 播放远程音频（不落地文件，播放一次即销毁）。同一时刻只保留一个播放器，播放失败返回 false。
 *  onFail：播放器触发 onError 后调用（已清理播放器），供调用方决定是否重新合成重试 */
function _play(url, voice, preview, onFail) {
	if (typeof uni.createInnerAudioContext !== 'function') {
		addLog('err', 'TTS 播放失败', '当前环境不支持 createInnerAudioContext')
		return false
	}
	_stopCtx()
	const ctx = uni.createInnerAudioContext()
	// 微信小程序：不随系统静音键静音（语音阅读场景默认外放）；部分端（如 H5）该属性为只读 getter，赋值会抛错，忽略即可
	try { ctx.obeyMuteSwitch = false } catch (e) { /* 忽略 */ }
	let ended = false
	const cleanup = () => {
		if (ended) return
		ended = true
		if (_ctx === ctx) _ctx = null
		try { ctx.destroy() } catch (e) { /* 忽略 */ }
	}
	ctx.onEnded(cleanup)
	ctx.onStop(cleanup)
	ctx.onError((err) => {
		addLog('err', 'TTS 播放失败', _playErrorDetail(err))
		cleanup()
		if (typeof onFail === 'function') onFail()
	})
	_ctx = ctx
	ctx.src = url
	// #ifdef APP-PLUS
	// App 原生播放器：src 刚设置时资源未就绪，立即 play() 可能被静默忽略（无报错、不触发 onError）。
	// 改为等 onCanplay 就绪后再 play；若 onCanplay 未触发，1s 后兜底再 play 一次（play 幂等，重复调用无害）。
	ctx.onCanplay(() => {
		if (!ended && _ctx === ctx) {
			try { ctx.play() } catch (e) { /* 忽略 */ }
		}
	})
	setTimeout(() => {
		if (!ended && _ctx === ctx) {
			try { ctx.play() } catch (e) { /* 忽略 */ }
		}
	}, 1000)
	// #endif
	// #ifndef APP-PLUS
	ctx.play()
	// #endif
	return true
}

/** 单行预览：压缩换行并截断（仅用于日志展示） */
function _preview(text, n = 40) {
	const t = String(text || '').replace(/\s+/g, ' ').trim()
	return t.length > n ? t.slice(0, n) + '…' : t
}

/** 接口测试文本（固定一小段，验证连通性/Key/音色） */
export const TTS_TEST_TEXT = '你好，我是语音阅读测试。如果你能听到这句话，说明语音接口配置正常。'

/**
 * 测试 TTS 接口是否可用：按当前配置（Key/模型/音色）发送一小段固定文本，
 * 合成成功后尝试以设置音色播放。请求/响应/错误均写入调试日志。
 * @param {{apiKey:string, model?:string, voice?:string}} [opts]
 * @returns {Promise<{ok:boolean, message:string}>}
 */
export async function testTts(opts = {}) {
	const apiKey = String(opts.apiKey || '').trim()
	const model = String(opts.model || '').trim() || TTS_DEFAULT_MODEL
	const voice = String(opts.voice || '').trim() || TTS_DEFAULT_VOICE
	if (!apiKey) {
		addLog('err', 'TTS 接口测试', '未填写 TTS API Key')
		return { ok: false, message: '请先填写 TTS API Key' }
	}
	addLog('info', 'TTS 接口测试', `发送测试请求 model=${model} · voice=${voice} · text=${TTS_TEST_TEXT}`)
	stopSpeaking() // 打断正在播放的语音，避免与新测试语音重叠
	const url = await _synthesize({ apiKey, model, voice, text: TTS_TEST_TEXT })
	if (!url) return { ok: false, message: '合成失败，详情见调试日志' }
	addLog('res', 'TTS 接口测试成功', `model=${model} · voice=${voice} · 开始播放测试语音`)
	let retried = false
	const ok = _play(url, voice, TTS_TEST_TEXT, async () => {
		// App 端 uni 的 onError 只回传通用 MediaError（不带错误码），多为瞬时网络/解码问题，
		// 重新合成一次（拿新 URL）自动重试
		if (retried) return
		retried = true
		addLog('info', 'TTS 播放失败，重新合成重试', '首次播放失败（MediaError），重新合成一次并重试')
		const retryUrl = await _synthesize({ apiKey, model, voice, text: TTS_TEST_TEXT })
		if (!retryUrl) return
		_play(retryUrl, voice, TTS_TEST_TEXT)
	})
	return ok
		? { ok: true, message: '测试成功，正在播放语音…' }
		: { ok: false, message: '当前环境不支持音频播放' }
}

/**
 * 合成并朗读一条消息：调 TTS 接口拿音频 URL → 直接播放（不落地文件），播完即销毁。
 * 同一时刻只播放一条，新消息到来时自动打断上一条。
 * @param {string} content 消息原文（可含 $表情名$ 占位，表情不朗读）
 * @param {{apiKey:string, model?:string, voice?:string}} [opts]
 * @returns {Promise<void>}
 */
export async function speakText(content, opts = {}) {
	const apiKey = String(opts.apiKey || '').trim()
	if (!apiKey) return
	const model = String(opts.model || '').trim() || TTS_DEFAULT_MODEL
	const voice = String(opts.voice || '').trim() || TTS_DEFAULT_VOICE
	const text = textForSpeech(content)
	if (!text) return // 无文本（如仅表情包）不朗读

	stopSpeaking()     // 打断上一条正在播放的语音（会作废旧的进行中请求）
	const seq = ++_seq // 本请求序号：响应返回时若已被更新的请求/停止取代则放弃播放

	const url = await _synthesize({ apiKey, model, voice, text })
	if (!url) return

	// 合成期间若用户已发新消息 / 停止朗读 / 页面切换，本次结果作废，不创建播放器
	if (seq !== _seq) return

	addLog('info', 'TTS 播放', `${voice} · ${_preview(text)}`)
	let retried = false
	_play(url, voice, text, async () => {
		// App 端 uni 的 onError 只回传通用 MediaError（不带错误码），多为瞬时网络/解码问题，
		// 重新合成一次（拿新 URL）自动重试；期间用户已发新消息/停止则放弃
		if (retried || seq !== _seq) return
		retried = true
		addLog('info', 'TTS 播放失败，重新合成重试', '首次播放失败（MediaError），重新合成一次并重试')
		const retryUrl = await _synthesize({ apiKey, model, voice, text })
		if (!retryUrl || seq !== _seq) return
		_play(retryUrl, voice, text)
	})
}
