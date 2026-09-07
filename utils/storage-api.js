/**
 * 存储层「API 配置预设域」—— 从 storage.js 拆分。
 * 独立于会话/记忆，存于专属键 chabot_setting_api_profiles（最多 3 套）。
 */

const KEY_API_PROFILES = 'chabot_setting_api_profiles'
const API_PROFILE_MAX = 3

/** 已保存的 API 配置预设数组（每套 {id,name,baseUrl,apiKey,model,temperature}），返回副本 */
export function getApiProfiles() {
	if (typeof uni === 'undefined' || !uni.getStorageSync) return []
	const v = uni.getStorageSync(KEY_API_PROFILES)
	return Array.isArray(v) ? v.slice() : []
}

function _setApiProfiles(arr) {
	if (typeof uni !== 'undefined' && uni.setStorageSync) {
		try {
			uni.setStorageSync(KEY_API_PROFILES, arr)
		} catch (e) {
			console.error('[storage] API 预设保存失败:', e)
		}
	}
}

/**
 * 保存/覆盖第 index（0~2）套 API 预设。
 * 超出 3 套上限返回 false；覆盖时保留原 id。
 */
export function saveApiProfile(index, name, cfg = {}) {
	index = parseInt(index, 10)
	if (!Number.isInteger(index) || index < 0 || index >= API_PROFILE_MAX) return false
	const arr = getApiProfiles()
	const old = arr[index]
	const item = {
		id: (old && old.id) || 'ap' + Date.now().toString(36) + '_' + index,
		name: String(name || '预设' + (index + 1)).trim().slice(0, 12) || '预设' + (index + 1),
		baseUrl: (cfg.baseUrl || '').trim(),
		apiKey: (cfg.apiKey || '').trim(),
		model: (cfg.model || '').trim(),
		temperature: cfg.temperature === undefined ? 0.8 : cfg.temperature
	}
	arr[index] = item
	_setApiProfiles(arr)
	return true
}

/** 删除第 index 套预设；index 越界返回 false */
export function deleteApiProfile(index) {
	index = parseInt(index, 10)
	const arr = getApiProfiles()
	if (!Number.isInteger(index) || index < 0 || index >= arr.length) return false
	arr.splice(index, 1)
	_setApiProfiles(arr)
	return true
}

/** 读取第 index 套预设（含 baseUrl/apiKey/model/temperature），不存在返回 null */
export function getApiProfile(index) {
	index = parseInt(index, 10)
	const p = getApiProfiles()[index]
	if (!p) return null
	return { baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model, temperature: p.temperature }
}