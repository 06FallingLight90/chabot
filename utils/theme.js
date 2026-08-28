/**
 * 主题模式工具：仅手动浅色/深色（light / dark），默认浅色。
 * 不做「跟随系统」：避免 App 端依赖 prefers-color-scheme / uni.onThemeChange 的不可靠性，
 * 主题始终由用户手动指定并持久化。设置页切换后即时生效。
 *
 * 视觉落地方式：页面根节点绑定 themeClass（theme-light / theme-dark），App.vue 中 .theme-dark
 * 覆盖 --c-* / --wd-* 令牌；原生导航栏由 main.js 的全局 mixin 按 __theme 同步配色。
 */
const KEY = 'chabot_theme'
const listeners = []

/** 读取当前主题（非法值一律归为浅色） */
export function getTheme() {
	let v = ''
	try {
		v = uni.getStorageSync(KEY)
	} catch (e) { /* ignore */ }
	return v === 'dark' ? 'dark' : 'light'
}

/** 设置主题并通知所有监听者（同步反映到已挂载页面）；非 dark 一律视为浅色 */
export function setTheme(t) {
	const v = t === 'dark' ? 'dark' : 'light'
	try {
		uni.setStorageSync(KEY, v)
	} catch (e) { /* ignore */ }
	listeners.forEach((fn) => { try { fn(v) } catch (e) { /* ignore */ } })
}

/** 订阅主题变化，注册后立即回调一次当前值；返回退订函数 */
export function onThemeChange(fn) {
	listeners.push(fn)
	fn(getTheme())
	return () => {
		const i = listeners.indexOf(fn)
		if (i >= 0) listeners.splice(i, 1)
	}
}