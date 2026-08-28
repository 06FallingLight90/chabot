<script>
	import { initChatService, maybeMaintenance } from './utils/chat.js'
	import { catchUpProactive } from './utils/chat-proactive.js'

	export default {
		onLaunch: function() {
			// 初始化持久化并执行一次记忆维护（L3 过期清理/降级/容量控制）
			initChatService()
			console.log('App Launch')
		},
		onShow: function() {
			// 每次进入前台时检查并执行节流维护
			maybeMaintenance()
			// 拟真聊天：恢复调度；退后台期间已到期（App 挂起导致定时器未触发）则立即补发一次
			catchUpProactive()
			console.log('App Show')
		},
		onHide: function() {
			// 拟真聊天：退后台不清定时器——单条 pending timeout 后台零占用；
			// H5 隐藏标签页仍会被节流触发，App 挂起则交给 onShow 的 catchUpProactive 补发
			console.log('App Hide')
		}
	}
</script>

<style>
	/*每个页面公共css */
</style>
