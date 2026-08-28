import App from './App'
import { getTheme, onThemeChange } from './utils/theme.js'

// 全局主题 mixin：为每个页面根节点提供 themeClass（theme-light / theme-dark），
// 处理即时换肤与原生导航栏配色。主题仅手动（__theme 恒为 light/dark）。
const themeMixin = {
	data() {
		return { __theme: getTheme() }
	},
	computed: {
		themeClass() {
			return this.__theme ? 'theme-' + this.__theme : ''
		}
	},
	watch: {
		__theme() {
			this.__applyNavbar()
		}
	},
	created() {
		this.__offTheme = onThemeChange((t) => { this.__theme = t })
	},
	onShow() {
		// 页面显示时按当前主题刷新原生导航栏
		this.__applyNavbar()
	},
	onReady() {
		// 原生导航栏就绪后再应用一次，覆盖部分端 mixin 页面钩子不触发或偏早的场景（如 App）
		this.__applyNavbar()
	},
	mounted() {
		// 最兜底：mounted 后延迟一拍再设一次，确保 App 原生导航栏已可改色
		setTimeout(() => this.__applyNavbar(), 60)
	},
	beforeUnmount() {
		if (this.__offTheme) this.__offTheme()
	},
	methods: {
		// 按当前生效主题同步原生导航栏配色；__theme 恒为 light/dark
		__applyNavbar() {
			const t = this.__theme
			const frontColor = t === 'dark' ? '#ffffff' : '#000000'
			const backgroundColor = t === 'dark' ? '#1c2130' : '#F8F8F8'
			// #ifdef APP-PLUS || H5 || MP-WEIXIN
			uni.setNavigationBarColor({ frontColor, backgroundColor })
			// #endif
		}
	}
}

// #ifndef VUE3
import Vue from 'vue'
import './uni.promisify.adaptor'
Vue.config.productionTip = false
Vue.mixin(themeMixin)
App.mpType = 'app'
const app = new Vue({
  ...App
})
app.$mount()
// #endif

// #ifdef VUE3
import { createSSRApp } from 'vue'
export function createApp() {
  const app = createSSRApp(App)
  app.mixin(themeMixin)
  return {
    app
  }
}
// #endif