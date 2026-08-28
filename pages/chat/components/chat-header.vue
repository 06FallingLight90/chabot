<template>
	<view>
		<view class="header">
			<view class="header-left">
				<text class="persona" @tap="$emit('open-persona')">{{ personaName }}</text>
				<text class="model">{{ model }}</text>
			</view>
			<view class="header-right">
				<text class="h-btn" @tap="$emit('open-history')">历史</text>
				<text class="h-btn primary" @tap="$emit('new-chat')">新对话</text>
				<text class="h-btn" @tap="$emit('clear')">清空</text>
			</view>
		</view>

		<view class="scene-bar" v-if="scene" @tap="$emit('open-scene-edit')">
			<view class="scene-dot"></view>
			<text class="scene-text">{{ scene }}</text>
		</view>
	</view>
</template>

<script>
	export default {
		name: 'ChatHeader',
		props: {
			personaName: { type: String, default: '' },
			model: { type: String, default: '' },
			scene: { type: String, default: '' }
		},
		emits: ['open-persona', 'open-history', 'new-chat', 'clear', 'open-scene-edit']
	}
</script>

<style scoped>
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20rpx 30rpx;
		background: var(--c-brand-gradient);
		border-bottom: none;
	}

	.header-left {
		display: flex;
		align-items: baseline;
	}

	.persona {
		font-size: 30rpx;
		font-weight: 600;
		color: #fff;
	}

	.model {
		margin-left: 16rpx;
		font-size: 22rpx;
		color: rgba(255, 255, 255, 0.75);
	}

	.header-right {
		display: flex;
		align-items: center;
	}

	.h-btn {
		font-size: 26rpx;
		color: rgba(255, 255, 255, 0.9);
		padding: 8rpx 16rpx;
	}

	.h-btn.primary {
		color: #fff;
		font-weight: 600;
		background: rgba(255, 255, 255, 0.18);
		border-radius: var(--c-radius-full);
		padding: 8rpx 20rpx;
	}

	.scene-bar {
		display: flex;
		align-items: center;
		padding: 12rpx 30rpx;
		background: var(--c-card);
		box-shadow: 0 2rpx 10rpx rgba(91, 124, 250, 0.12);
		border-bottom: none;
		margin: 0 24rpx;
		border-radius: 0 0 var(--c-radius-md) var(--c-radius-md);
	}

	.scene-dot {
		width: 12rpx;
		height: 12rpx;
		border-radius: 50%;
		background: var(--c-primary);
		margin-right: 12rpx;
		flex-shrink: 0;
		box-shadow: 0 0 0 4rpx var(--c-primary-light);
	}

	.scene-text {
		flex: 1;
		font-size: 24rpx;
		color: var(--c-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
