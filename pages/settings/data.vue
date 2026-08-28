<template>
	<view class="ss-page" :class="themeClass">
		<view class="ss-tipbar">数据管理：清空操作即时生效、无法撤销，请谨慎操作。</view>

		<view class="ss-card">
			<view class="ss-title">数据管理</view>
			<button class="ss-danger-btn" @tap="clearChats">清空对话</button>
			<button class="ss-danger-btn" @tap="clearData">清空记忆与对话</button>
			<view class="ss-hint">清空对话仅清空当前会话消息；清空记忆与对话会删除所有记忆与对话记录。小程序端需在公众平台配置 request 合法域名；App 端保持联网即可。</view>
		</view>
	</view>
</template>

<script>
	import { clearConversation } from '../../utils/chat.js'
	import { clearAllData } from '../../utils/storage.js'

	export default {
		methods: {
			clearChats() {
				uni.showModal({
					title: '清空对话',
					content: '确定清空对话历史吗？',
					success: (res) => {
						if (res.confirm) {
							clearConversation()
							uni.showToast({ title: '已清空', icon: 'success' })
						}
					}
				})
			},
			clearData() {
				uni.showModal({
					title: '清空全部数据',
					content: '将删除所有记忆与对话记录，且不可恢复。确定继续？',
					success: (res) => {
						if (res.confirm) {
							clearAllData()
							uni.showToast({ title: '已清空', icon: 'success' })
						}
					}
				})
			}
		}
	}
</script>

<style>
	.ss-danger-btn {
		margin-bottom: 20rpx;
		height: 80rpx;
		line-height: 80rpx;
		font-size: 28rpx;
		color: var(--c-danger);
		background: var(--c-card);
		border: 1rpx solid var(--c-danger-light);
		border-radius: 12rpx;
	}
</style>