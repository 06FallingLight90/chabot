/**
 * LLM 客户端 —— 调用任意 OpenAI 兼容的 /chat/completions 接口
 * 每次请求/响应/错误都会写入调试日志（utils/log.js）
 */

import { addLog } from './log.js'

function uniRequest(options) {
	return new Promise((resolve, reject) => {
		uni.request({
			...options,
			success: (res) => resolve(res),
			fail: (err) => reject(new Error((err && err.errMsg) || '网络请求失败'))
		})
	})
}

/** 单行预览：压缩换行并截断（仅用于摘要列展示） */
function _preview(text, n = 80) {
	const t = String(text || '').replace(/\s+/g, ' ').trim()
	return t.length > n ? t.slice(0, n) + '…' : t
}

/** 构建请求日志详情：完整 messages 序列化，供调试面板展开查看 */
function _reqDetail(url, messages) {
	const promptChars = messages.reduce((n, m) => n + (m && m.content ? String(m.content).length : 0), 0)
	const lines = [`URL: ${url}`, `消息数: ${messages.length} · 内容约 ${promptChars} 字符`, '--- 请求内容 ---']
	try {
		lines.push(JSON.stringify(messages, null, 1))
	} catch (e) {
		lines.push('(请求内容序列化失败)')
	}
	return lines.join('\n')
}

/**
 * 兜底解析 SSE 流式文本（data: {...} 逐行）。某些兼容服务（如个别 Ollama 配置）
 * 可能无视 stream:false 仍返回流式，本客户端按非流式解析会拿不到内容，这里尝试
 * 逐行合并增量 content，兼容 choices[0].delta.content / choices[0].message.content /
 * Ollama 原生 message.content 三种字段。
 * @param {*} data 响应 data（字符串或对象）
 * @returns {string} 合并后的完整文本，无流式内容则返回空串
 */
function _parseStreamingText(data) {
	const text = typeof data === 'string' ? data : data && typeof data === 'object' ? '' : String(data || '')
	if (!text) return ''
	let out = ''
	for (const line of text.split('\n')) {
		const m = line.match(/^data:\s*(.*)$/)
		if (!m) continue
		const payload = m[1].trim()
		if (!payload || payload === '[DONE]') continue
		try {
			const obj = JSON.parse(payload)
			if (obj && obj.choices && obj.choices[0]) {
				const chunk = obj.choices[0].delta || obj.choices[0].message || {}
				if (typeof chunk.content === 'string') out += chunk.content
			} else if (obj && obj.message && typeof obj.message.content === 'string') {
				out += obj.message.content
			}
		} catch (e) {
			/* 非 JSON 行忽略 */
		}
	}
	return out
}

/**
 * 发起一次对话补全
 * @param {{baseUrl:string, apiKey:string, model:string, messages:Array, temperature?:number, maxTokens?:number, reasoningEffort?:string}} opts
 *        reasoningEffort: 'none' 关闭思考 / 'high'|'medium'|'low' 开启思考 / '' 跟随模型。
 *        Ollama 兼容接口经 reasoning_effort 控制 Qwen3 等思考模型的思考模式；原生 think 参数在该端点不生效。
 * @returns {Promise<{text:string}>}
 */
export async function chatCompletion(opts) {
	const { baseUrl, apiKey, model, messages, temperature = 0.8, maxTokens = 1024, reasoningEffort } = opts
	const url = (baseUrl || '').replace(/\/+$/, '') + '/chat/completions'
	addLog('req', `LLM 请求 ${model}`, _reqDetail(url, messages))

	const buildData = (withReasoning) => {
		const data = {
			model,
			messages,
			temperature,
			max_tokens: maxTokens,
			// 显式关闭流式：OpenAI 默认非流式，但 Ollama 等兼容接口默认 stream=true（SSE），
			// 本客户端按非流式 JSON 解析，必须强制 stream=false，否则返回流式数据解析不出内容
			stream: false
		}
		if (withReasoning && reasoningEffort) data.reasoning_effort = reasoningEffort
		return data
	}
	const doRequest = (data) =>
		uniRequest({
			url,
			method: 'POST',
			timeout: 120000,
			header: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer ' + apiKey
			},
			data
		})

	let res
	try {
		res = await doRequest(buildData(true))
		// 服务端不识别 reasoning_effort（如部分 OpenAI 兼容服务）会返回 400，移除该参数后降级重试一次
		if (res.statusCode === 400 && reasoningEffort) {
			addLog('info', '思考参数降级', '服务端返回 400，移除 reasoning_effort 后重试')
			res = await doRequest(buildData(false))
		}
	} catch (e) {
		addLog('err', 'LLM 网络错误', e.message)
		throw new Error('网络错误：' + e.message)
	}

	if (res.statusCode >= 200 && res.statusCode < 300) {
		const data = res.data || {}
		const choice = data.choices && data.choices[0]
		let content = choice && choice.message ? choice.message.content : undefined
		// 思考型模型（Qwen3 等）可能把全部输出放进 reasoning/thinking 字段而 content 为空，
		// 此时兜底展示思考内容，避免"请求成功却无返回"的假象
		let fromReasoning = false
		if ((typeof content !== 'string' || !content.trim()) && choice && choice.message) {
			const r = choice.message.reasoning || choice.message.thinking
			if (r) {
				content = r
				fromReasoning = true
			}
		}
		if (typeof content === 'string') {
			const usage = data.usage
			? ` · prompt:${data.usage.prompt_tokens ?? '-'} completion:${data.usage.completion_tokens ?? '-'} total:${data.usage.total_tokens ?? '-'}`
			: ''
			addLog(
				'res',
				`LLM 响应 200${fromReasoning ? '（思考内容）' : ''}`,
				`model=${model}${usage}\n--- 返回内容 ---\n${content}\n--- 概要预览 ---\n${_preview(content)}`
			)
			return { text: content }
		}
		// 兜底：个别兼容服务无视 stream:false 仍返回 SSE 流式，逐行合并增量内容
		const streamText = _parseStreamingText(res.data)
		if (streamText) {
			addLog(
				'res',
				`LLM 响应 200（流式兼容）`,
				`model=${model}\n--- 返回内容 ---\n${streamText}\n--- 概要预览 ---\n${_preview(streamText)}`
			)
			return { text: streamText }
		}
		let raw = ''
		try {
			raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || {}, null, 1)
		} catch (e) {
			raw = String(res.data || '')
		}
		addLog('err', 'LLM 响应格式异常', `status=${res.statusCode}\n${raw.slice(0, 500)}`)
		throw new Error('接口返回格式异常（详情见调试日志）')
	}

	const err = (res.data && res.data.error) || {}
	const detail = err.message || err.type || JSON.stringify(err)
	const map = {
		400: '请求参数错误',
		401: 'API Key 无效',
		403: '无权限访问',
		404: '接口地址不正确',
		429: '请求过于频繁',
		500: '服务端错误',
		502: '网关错误'
	}
	addLog('err', `LLM 请求失败(${res.statusCode})`, detail || (map[res.statusCode] || '未知错误'))
	throw new Error(`${map[res.statusCode] || '请求失败'}(${res.statusCode})${detail ? '：' + detail : ''}`)
}
