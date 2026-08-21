<template>
	<view class="input-bar">
		<input
			class="input"
			:value="modelValue"
			confirm-type="send"
			:disabled="loading"
			placeholder="输入消息…"
			@input="onInput"
			@confirm="doSend"
			@focus="$emit('focus')"
		/>
		<text class="emoji-btn" :class="{ on: emojiOn }" @tap="$emit('toggle-emoji')">表情</text>
		<button class="send-btn" :disabled="loading || !modelValue.trim()" @tap="doSend">发送</button>
	</view>
</template>

<script>
	export default {
		name: 'ChatInputBar',
		props: {
			modelValue: { type: String, default: '' },
			loading: { type: Boolean, default: false },
			emojiOn: { type: Boolean, default: false }
		},
		emits: ['update:modelValue', 'send', 'toggle-emoji', 'focus'],
		methods: {
			onInput(e) {
				this.$emit('update:modelValue', e && e.detail && e.detail.value !== undefined ? e.detail.value : '')
			},
			doSend() {
				const text = this.modelValue.trim()
				if (!text || this.loading) return
				this.$emit('send', text)
			}
		}
	}
</script>

<style scoped>
	.input-bar {
		display: flex;
		align-items: center;
		padding: 16rpx 24rpx;
		padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
		background: #ffffff;
		border-top: 1rpx solid #eee;
	}

	.input {
		flex: 1;
		height: 76rpx;
		background: #f2f3f5;
		border-radius: 38rpx;
		padding: 0 30rpx;
		font-size: 28rpx;
	}

	.emoji-btn {
		margin-left: 16rpx;
		font-size: 26rpx;
		color: #666;
		padding: 8rpx 16rpx;
	}

	.emoji-btn.on {
		color: #5b7cfa;
		font-weight: 600;
	}

	.send-btn {
		margin-left: 20rpx;
		height: 76rpx;
		line-height: 76rpx;
		padding: 0 40rpx;
		font-size: 28rpx;
		color: #fff;
		background: #5b7cfa;
		border-radius: 38rpx;
	}

	.send-btn[disabled] {
		background: #c8d0fa;
		color: #fff;
	}
</style>
