<script>
	import { initChatService, maybeMaintenance } from './utils/chat.js'
	import { catchUpProactive } from './utils/chat-proactive.js'
	import { setForeground } from './utils/notify.js'

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
			// 拟真通知：标记回到前台（回到前台时不再重复弹系统通知）
			setForeground(true)
			console.log('App Show')
		},
		onHide: function() {
			// 拟真聊天：退后台不清定时器——单条 pending timeout 后台零占用；
			// H5 隐藏标签页仍会被节流触发，App 挂起则交给 onShow 的 catchUpProactive 补发
			setForeground(false)
			console.log('App Hide')
		}
	}
</script>

<style>
	/*=========== 全局设计令牌（CSS 变量） ===========
	 * 供所有页面普通 css 引用；与 uni.scss 中的 SCSS 变量保持一致。
	 * wot 组件主题通过根节点覆盖其 --wd-* 变量实现品牌化。
	 */
	page {
		/* 自绘底部导航栏内容高度（不含安全区；页面据此预留底部空间） */
		--ctab-h: 100rpx;
		/* 品牌主色 */
		--c-primary: #5b7cfa;
		--c-primary-light: #e5ecff;
		--c-primary-dark: #4a66df;
		--c-brand-gradient: linear-gradient(135deg, #5b7cfa 0%, #8b5cf6 100%);

		/* 中性色 */
		--c-text: #1f2329;
		--c-text-secondary: #646a73;
		--c-text-aid: #9aa0a8;
		--c-bg: #f6f7fb;
		--c-card: #ffffff;
		--c-line: #e6e9f0;

		/* 状态色 */
		--c-success: #22c55e;
		--c-warning: #f7b955;
		--c-danger: #f0424b;
		--c-danger-light: #ffe9ea;

		/* L 等级 */
		--c-l1: #f0424b;
		--c-l2: #f7a325;
		--c-l3: #9aa0a8;

		/* 圆角/阴影 */
		--c-radius-sm: 8rpx;
		--c-radius-md: 16rpx;
		--c-radius-lg: 24rpx;
		--c-radius-full: 999rpx;
		--c-shadow-card: 0 6rpx 24rpx rgba(31, 35, 41, 0.06);

		/* wot 主色品牌化 */
		--wd-color-theme: #5b7cfa;
		--wd-color-success: #22c55e;
		--wd-color-warning: #f7b955;
		--wd-color-danger: #f0424b;
	}

	/* 手动主题切换（设置页）：作用在页面根 view 上。themeClass 由 main.js 全局 mixin 注入，
	 * 恒为 theme-light / theme-dark（仅手动，不随系统）。直接用 .theme-light/.theme-dark
	 * （不带 .page 限定），兼容主页面（.page）与设置子页面（.ss-page）等所有根节点类。
	 */
	.theme-light {
		--c-primary: #5b7cfa;
		--c-primary-light: #e5ecff;
		--c-primary-dark: #4a66df;
		--c-text: #1f2329;
		--c-text-secondary: #646a73;
		--c-text-aid: #9aa0a8;
		--c-bg: #f6f7fb;
		--c-card: #ffffff;
		--c-line: #e6e9f0;
		--c-danger-light: #ffe9ea;
		--c-l3: #9aa0a8;
		--c-shadow-card: 0 6rpx 24rpx rgba(31, 35, 41, 0.06);
		--wd-color-theme: #5b7cfa;
		--wd-color-danger: #f0424b;
	}

	.theme-dark {
		--c-primary: #6f8cff;
		--c-primary-light: #1e2b55;
		--c-primary-dark: #5b7cfa;
		--c-text: #e7e9ee;
		--c-text-secondary: #a7aeba;
		--c-text-aid: #5f6873;
		--c-bg: #12151c;
		--c-card: #1c2130;
		--c-line: #2a3244;
		--c-danger: #f56c76;
		--c-danger-light: #3a1f24;
		--c-l3: #5f6873;
		--c-shadow-card: 0 6rpx 24rpx rgba(0, 0, 0, 0.4);
		--wd-color-theme: #6f8cff;
		--wd-color-danger: #f56c76;
	}

	/*=========== 设置子页面共用布局（.ss- 命名空间，避免与业务页冲突） =========== */
	.ss-page {
		padding: 20rpx 30rpx calc(40rpx + env(safe-area-inset-bottom));
		background: var(--c-bg);
		min-height: 100vh;
		box-sizing: border-box;
	}
	.ss-tipbar {
		font-size: 22rpx;
		color: var(--c-text-aid);
		line-height: 1.6;
		padding: 4rpx 6rpx 20rpx;
	}
	.ss-card {
		background: var(--c-card);
		border-radius: var(--c-radius-lg);
		padding: 28rpx;
		margin-bottom: 24rpx;
		box-shadow: var(--c-shadow-card);
		border: 1rpx solid transparent;
	}
	.ss-title {
		font-size: 28rpx;
		font-weight: 600;
		color: var(--c-text);
		margin-bottom: 20rpx;
		display: flex;
		align-items: center;
	}
	.ss-title .req {
		color: var(--c-danger);
		margin-left: 6rpx;
		font-size: 26rpx;
		font-weight: 700;
	}
	.ss-row {
		margin-bottom: 20rpx;
		padding: 20rpx 24rpx;
		border-radius: 12rpx;
		background: var(--c-bg);
	}
	.ss-row-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.ss-field {
		margin-top: 20rpx;
	}
	.ss-label {
		display: block;
		font-size: 24rpx;
		color: var(--c-text-secondary);
		margin-bottom: 10rpx;
	}
	.ss-input {
		height: 80rpx;
		background: var(--c-bg);
		border-radius: 12rpx;
		padding: 0 24rpx;
		font-size: 28rpx;
		color: var(--c-text);
		box-sizing: border-box;
		width: 100%;
	}
	.ss-hint {
		margin-top: 12rpx;
		font-size: 22rpx;
		color: var(--c-text-aid);
		line-height: 1.5;
	}
	.ss-btns {
		display: flex;
		flex-wrap: wrap;
	}
	.ss-btn {
		padding: 8rpx 22rpx;
		margin-left: 12rpx;
		border-radius: 24rpx;
		border: 1rpx solid var(--c-line);
		font-size: 24rpx;
		color: var(--c-text-secondary);
		background: var(--c-card);
	}
	.ss-btn.first {
		margin-left: 0;
	}
	.ss-btn.on {
		background: var(--c-primary);
		border-color: var(--c-primary);
		color: #fff;
	}
	.ss-btn.test {
		border-color: var(--c-primary);
		color: var(--c-primary);
	}
	.ss-btn.disabled {
		opacity: 0.5;
	}
	.ss-save {
		margin: 10rpx 0 30rpx;
		height: 88rpx;
		line-height: 88rpx;
		font-size: 30rpx;
		color: #fff;
		background: var(--c-brand-gradient);
		border-radius: var(--c-radius-full);
		box-shadow: 0 6rpx 16rpx rgba(91, 124, 250, 0.35);
		font-weight: 600;
		text-align: center;
	}
	.ss-auto {
		font-size: 22rpx;
		color: var(--c-success);
		padding: 4rpx 6rpx 16rpx;
		display: inline-block;
	}
</style>
