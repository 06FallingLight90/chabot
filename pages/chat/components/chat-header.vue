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
		padding: 16rpx 30rpx;
		background: #ffffff;
		border-bottom: 1rpx solid #eee;
	}

	.header-left {
		display: flex;
		align-items: baseline;
	}

	.persona {
		font-size: 30rpx;
		font-weight: 600;
		color: #333;
	}

	.model {
		margin-left: 16rpx;
		font-size: 22rpx;
		color: #999;
	}

	.header-right {
		display: flex;
		align-items: center;
	}

	.h-btn {
		font-size: 26rpx;
		color: #666;
		padding: 8rpx 16rpx;
	}

	.h-btn.primary {
		color: #5b7cfa;
		font-weight: 600;
	}

	.scene-bar {
		display: flex;
		align-items: center;
		padding: 12rpx 30rpx;
		background: rgba(91, 124, 250, 0.08);
		border-bottom: 1rpx solid #eee;
	}

	.scene-dot {
		width: 12rpx;
		height: 12rpx;
		border-radius: 50%;
		background: #5b7cfa;
		margin-right: 12rpx;
		flex-shrink: 0;
	}

	.scene-text {
		flex: 1;
		font-size: 24rpx;
		color: #666;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
