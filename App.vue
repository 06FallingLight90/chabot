<script>
	import { initChatService, maybeMaintenance } from './utils/chat.js'

	export default {
		onLaunch: function() {
			// 初始化持久化并执行一次记忆维护（L3 过期清理/降级/容量控制）
			initChatService()
			console.log('App Launch')
		},
		onShow: function() {
			// 每次进入前台时检查并执行节流维护
			maybeMaintenance()
			console.log('App Show')
		},
		onHide: function() {
			console.log('App Hide')
		}
	}
</script>

<style>
	/*每个页面公共css */
</style>
