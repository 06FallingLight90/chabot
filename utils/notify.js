/**
 * 跨端系统通知层（仅"收到拟真主动消息时弹系统通知"场景使用）。
 *
 * - App（Android/iOS）：`plus.push.createMessage` 本地通知
 * - H5：浏览器 Web Notification API
 * - 微信小程序：无任意系统通知能力，一律返回 false（调用方自行降级）
 *
 * 通知仅在应用处于**后台**时弹出——前台用户正在聊天页，弹通知反而打扰，
 * 消息已由发送链路本身刷新展示。平台不支持 / 未授权 / 前台时均静默跳过，不抛错。
 * Node 测试环境无 plus/window，所有访问均做能力探测，保证可被安全 import。
 */
import { addLog } from './log.js'

let _foreground = true // 默认按前台处理（安全）

/** App/页面 onShow/onHide 时同步前台/后台状态 */
export function setForeground(v) {
	_foreground = !!v
}

/** 当前是否处于后台（H5 优先用页面可见性，其次是 App 的 foreground 标记） */
function isHiddenNow() {
	try {
		if (typeof document !== 'undefined') {
			if (document.hidden !== undefined) return !!document.hidden
			if (document.visibilityState !== undefined) return document.visibilityState === 'hidden'
		}
	} catch (e) { /* ignore */ }
	return !_foreground
}

/** 当前平台是否具备系统通知能力 */
export function isNotificationSupported() {
	// #ifdef APP-PLUS
	try {
		if (typeof plus !== 'undefined' && plus.push && plus.push.createMessage) return true
	} catch (e) { /* ignore */ }
	// #endif
	// #ifdef H5
	try {
		const N = typeof window !== 'undefined' && window.Notification
		if (N) return true
	} catch (e) { /* ignore */ }
	// #endif
	return false
}

/**
 * 申请系统通知权限（幂等，不阻塞）。开启拟真聊天时调用。
 * App Android 13+=POST_NOTIFICATIONS 运行时权限；H5=Notification.requestPermission。
 * @returns {Promise<boolean>} 是否具备通知能力（是否真正授权不在此强等待）
 */
export function requestNotifyPermission() {
	// #ifdef APP-PLUS
	try {
		if (typeof plus !== 'undefined' && plus.android && plus.android.runtimeMainActivity) {
			const Build = plus.android.importClass('android.os.Build')
			if (Build && Build.VERSION && Build.VERSION.SDK_INT >= 33) {
				const Manifest = plus.android.importClass('android.Manifest$permission')
				const ActivityCompat = plus.android.importClass('androidx.core.app.ActivityCompat')
				const main = plus.android.runtimeMainActivity()
				if (
					ActivityCompat &&
					ActivityCompat.checkSelfPermission &&
					ActivityCompat.checkSelfPermission(main, Manifest.POST_NOTIFICATIONS) !== 0
				) {
					ActivityCompat.requestPermissions(main, [Manifest.POST_NOTIFICATIONS], 1)
					addLog('info', '拟真通知权限', '已请求 Android 13+ POST_NOTIFICATIONS 权限')
				}
			}
		}
	} catch (e) {
		addLog('info', '拟真通知权限', 'App 权限申请不可用：' + (e && e.message))
	}
	// #endif
	// #ifdef H5
	try {
		const N = typeof window !== 'undefined' && window.Notification
		if (N && N.permission !== 'granted' && N.requestPermission) {
			N.requestPermission().then((p) => {
				addLog('info', '拟真通知权限', 'H5 通知权限：' + p)
			}).catch(() => { })
		}
	} catch (e) { /* ignore */ }
	// #endif
	return Promise.resolve(isNotificationSupported())
}

/**
 * 收到拟真主动消息时弹系统通知。仅当处于后台且平台支持时实际弹出；否则静默跳过。
 * @param {string} text 通知正文（拟真主动消息文本）
 * @param {string} [title] 通知标题，默认「AI 伙伴」
 * @returns {boolean} 是否实际弹出
 */
export function notifyProactive(text, title = 'AI 伙伴') {
	if (isHiddenNow()) {
		// #ifdef APP-PLUS
		try {
			if (typeof plus !== 'undefined' && plus.push && plus.push.createMessage) {
				plus.push.createMessage(String(text), {}, { title })
				return true
			}
		} catch (e) { /* ignore */ }
		// #endif
		// #ifdef H5
		{
			try {
				const N = typeof window !== 'undefined' && window.Notification
				if (N && N.permission === 'granted') {
					try {
						new N(title, { body: String(text), tag: 'chabot-proactive', icon: '/static/logo.png' })
						return true
					} catch (e) { /* 带 icon 构造失败则不带 icon 重试 */ }
					try {
						new N(title, { body: String(text), tag: 'chabot-proactive' })
						return true
					} catch (e2) { /* ignore */ }
				}
			} catch (e) { /* ignore */ }
		}
		// #endif
	}
	return false
}