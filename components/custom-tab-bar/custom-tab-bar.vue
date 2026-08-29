<template>
	<!-- 自绘底部导航栏：启用 pages.json 里 tabBar.custom=true 后，原生 tabBar 不再渲染，
		 由本组件完全接管三端底部导航，并用主题令牌 var(--c-*) 跟随手动深浅色切换。
		 固定在屏幕底部；所属页面需预留 calc(var(--ctab-h) + env(safe-area-inset-bottom)) 的底部空间。 -->
	<view class="cust-tab">
		<view
			v-for="(it, i) in tabs"
			:key="it.page"
			class="cust-tab-item"
			:class="{ on: i === active }"
			@tap="switchTo(it)"
		>
			<text class="cust-tab-ico">{{ it.ico }}</text>
			<text class="cust-tab-txt">{{ it.text }}</text>
		</view>
	</view>
</template>

<script>
	export default {
		name: 'CustomTabBar',
		props: {
			active: { type: Number, default: 0 }
		},
		mounted() {
			// `tabBar.custom:true` 仅对微信小程序隐藏原生 tabBar；H5/App 仍会渲染原生栏
			// （H5 靠 pages.json 里 list 项的 `visible:false` 隐藏）。这里在组件内再兜底
			// 显式隐藏一次（无动画、无失败回调），确保三端都只剩本自绘栏，不出现双栏。
			uni.hideTabBar({ animation: false })
		},
		data() {
			return {
				tabs: [
					{ page: '/pages/chat/chat', text: '聊天', ico: '💬' },
					{ page: '/pages/memory/memory', text: '记忆', ico: '🧠' },
					{ page: '/pages/settings/settings', text: '设置', ico: '⚙️' }
				]
			}
		},
		methods: {
			switchTo(it) {
				if (this.tabs.indexOf(it) === this.active) return
				uni.switchTab({ url: it.page })
			}
		}
	}
</script>

<style scoped>
	.cust-tab {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		height: calc(var(--ctab-h, 100rpx) + env(safe-area-inset-bottom));
		z-index: 900;
		display: flex;
		align-items: stretch;
		box-sizing: border-box;
		padding: 10rpx 24rpx;
		padding-bottom: calc(10rpx + env(safe-area-inset-bottom));
		background: var(--c-card);
		border-top: 1rpx solid var(--c-line);
		box-shadow: 0 -4rpx 20rpx rgba(15, 18, 29, 0.05);
	}

	.cust-tab-item {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		border-radius: var(--c-radius-full);
		color: var(--c-text-aid);
		font-size: 26rpx;
		transition: background 0.2s, color 0.2s;
	}

	.cust-tab-ico {
		font-size: 40rpx;
		line-height: 1;
		margin-bottom: 4rpx;
		opacity: 0.85;
		transition: opacity 0.2s;
	}

	.cust-tab-item.on {
		color: #fff;
		background: var(--c-brand-gradient);
		font-weight: 600;
		box-shadow: 0 4rpx 12rpx rgba(91, 124, 250, 0.3);
	}

	.cust-tab-item.on .cust-tab-ico {
		opacity: 1;
	}
</style>