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
 * 发起一次对话补全
 * @param {{baseUrl:string, apiKey:string, model:string, messages:Array, temperature?:number, maxTokens?:number}} opts
 * @returns {Promise<{text:string}>}
 */
export async function chatCompletion(opts) {
	const { baseUrl, apiKey, model, messages, temperature = 0.8, maxTokens = 1024 } = opts
	const url = (baseUrl || '').replace(/\/+$/, '') + '/chat/completions'
	addLog('req', `LLM 请求 ${model}`, _reqDetail(url, messages))

	let res
	try {
		res = await uniRequest({
			url,
			method: 'POST',
			timeout: 120000,
			header: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer ' + apiKey
			},
			data: {
				model,
				messages,
				temperature,
				max_tokens: maxTokens
			}
		})
	} catch (e) {
		addLog('err', 'LLM 网络错误', e.message)
		throw new Error('网络错误：' + e.message)
	}

	if (res.statusCode >= 200 && res.statusCode < 300) {
		const data = res.data || {}
		const choice = data.choices && data.choices[0]
		if (choice && choice.message && typeof choice.message.content === 'string') {
			const usage = data.usage && data.usage.total_tokens ? ` · tokens: ${data.usage.total_tokens}` : ''
			addLog(
				'res',
				`LLM 响应 200`,
				`model=${model}${usage}\n--- 返回内容 ---\n${choice.message.content}\n--- 概要预览 ---\n${_preview(choice.message.content)}`
			)
			return { text: choice.message.content }
		}
		addLog('err', 'LLM 响应格式异常', _preview(JSON.stringify(res.data || {}), 120))
		throw new Error('接口返回格式异常')
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
