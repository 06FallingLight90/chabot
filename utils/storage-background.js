/**
 * 存储层「聊天背景图域」—— 从 storage.js 拆分。
 * App/小程序用 uni.saveFile 持久化到文件；H5 用 canvas 压缩成 JPEG base64 存 storage。
 */

import { getSetting, setSetting } from './storage-state.js'

/** 当前聊天背景（路径 或 H5 的 base64 data URL），无则空串 */
export function getBackgroundImage() {
	return getSetting('bgImage', '')
}

/** 移除聊天背景 */
export function removeBackgroundImage() {
	const old = getBackgroundImage()
	setSetting('bgImage', '')
	if (old) {
		// #ifdef APP-PLUS || MP-WEIXIN
		uni.removeSavedFile({ filePath: old, fail: () => { } })
		// #endif
	}
}

/**
 * 保存聊天背景图片，返回持久化路径
 * - App / 微信小程序：uni.saveFile 持久化到本地文件
 * - H5：转 base64 存入 storage
 */
export async function saveBackgroundImage(tempPath) {
	if (!tempPath) return ''
	let saved = ''
	// #ifdef APP-PLUS || MP-WEIXIN
	saved = await new Promise((resolve) => {
		uni.saveFile({
			tempFilePath: tempPath,
			success: (res) => resolve(res.savedFilePath),
			fail: () => resolve('')
		})
	})
	// #endif
	// #ifdef H5
	saved = await _fileToBase64(tempPath)
	// #endif
	if (!saved) saved = tempPath // 兜底：临时路径（当次会话有效）
	const old = getBackgroundImage()
	setSetting('bgImage', saved)
	if (old && old !== saved) {
		// #ifdef APP-PLUS || MP-WEIXIN
		uni.removeSavedFile({ filePath: old, fail: () => { } })
		// #endif
	}
	return saved
}

// #ifdef H5
/** H5 端：canvas 压缩图片为 JPEG base64（限制宽度，避免超出 localStorage 配额） */
function _fileToBase64(tempPath) {
	const MAX_WIDTH = 1080
	const QUALITY = 0.8
	return new Promise((resolve) => {
		const img = new Image()
		img.onload = () => {
			try {
				let w = img.naturalWidth || img.width
				let h = img.naturalHeight || img.height
				if (w > MAX_WIDTH) {
					h = Math.round((h * MAX_WIDTH) / w)
					w = MAX_WIDTH
				}
				const canvas = document.createElement('canvas')
				canvas.width = w
				canvas.height = h
				canvas.getContext('2d').drawImage(img, 0, 0, w, h)
				resolve(canvas.toDataURL('image/jpeg', QUALITY))
			} catch (e) {
				console.error('[storage] 图片压缩失败', e)
				resolve('')
			}
		}
		img.onerror = () => resolve('')
		img.src = tempPath
	})
}
// #endif