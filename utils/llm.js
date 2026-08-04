/**
 * LLM 客户端 —— 调用任意 OpenAI 兼容的 /chat/completions 接口
 */

function uniRequest(options) {
	return new Promise((resolve, reject) => {
		uni.request({
			...options,
			success: (res) => resolve(res),
			fail: (err) => reject(new Error((err && err.errMsg) || '网络请求失败'))
		})
	})
}

/**
 * 发起一次对话补全
 * @param {{baseUrl:string, apiKey:string, model:string, messages:Array, temperature?:number, maxTokens?:number}} opts
 * @returns {Promise<{text:string}>}
 */
export async function chatCompletion(opts) {
	const { baseUrl, apiKey, model, messages, temperature = 0.8, maxTokens = 1024 } = opts
	const url = (baseUrl || '').replace(/\/+$/, '') + '/chat/completions'

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
		throw new Error('网络错误：' + e.message)
	}

	if (res.statusCode >= 200 && res.statusCode < 300) {
		const data = res.data || {}
		const choice = data.choices && data.choices[0]
		if (choice && choice.message && typeof choice.message.content === 'string') {
			return { text: choice.message.content }
		}
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
	throw new Error(`${map[res.statusCode] || '请求失败'}(${res.statusCode})${detail ? '：' + detail : ''}`)
}
