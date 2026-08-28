<template>
	<!-- 自绘底部导航栏：替代原生 tabBar（原生在 App 端不支持运行时换肤，无法跟随深浅色主题）。
		 跟随主题令牌 var(--c-*)，固定在屏幕底部；页面需预留 calc(var(--ctab-h) + env(safe-area-inset-bottom)) 的底部空间。 -->
	<view class="cust-tab">
		<view
			v-for="(it, i) in tabs"
			:key="it.page"
			class="cust-tab-item"
			:class="{ on: i === active }"
			@tap="switchTo(it)"
		>
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
		data() {
			return {
				tabs: [
					{ page: '/pages/chat/chat', text: '聊天' },
					{ page: '/pages/memory/memory', text: '记忆' },
					{ page: '/pages/settings/settings', text: '设置' }
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
		height: calc(var(--ctab-h, 112rpx) + env(safe-area-inset-bottom));
		z-index: 900;
		display: flex;
		align-items: center;
		box-sizing: border-box;
		padding: 10rpx 24rpx;
		padding-bottom: calc(10rpx + env(safe-area-inset-bottom));
		background: var(--c-card);
		border-top: 1rpx solid var(--c-line);
		box-shadow: 0 -4rpx 20rpx rgba(15, 18, 29, 0.05);
	}

	.cust-tab-item {
		flex: 1;
		height: 92rpx;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--c-radius-full);
		color: var(--c-text-aid);
		font-size: 28rpx;
		transition: background 0.2s, color 0.2s;
	}

	.cust-tab-item.on {
		color: #fff;
		background: var(--c-brand-gradient);
		font-weight: 600;
		box-shadow: 0 4rpx 12rpx rgba(91, 124, 250, 0.3);
	}
</style>