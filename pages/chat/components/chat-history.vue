<template>
	<!-- 历史对话弹窗 -->
	<view v-if="show" class="mask" @tap="$emit('close')">
		<view class="history-panel" @tap.stop>
			<view class="edit-title">对话历史</view>
			<scroll-view scroll-y class="history-list">
				<view v-if="!convList.length" class="history-empty">暂无历史对话</view>
				<view
					v-for="c in convList"
					:key="c.id"
					class="history-item"
					:class="{ active: c.id === activeConvId }"
					@tap="select(c.id)"
				>
					<view class="history-main">
						<view class="history-title">{{ c.title }}</view>
						<view class="history-preview">{{ c.preview }}</view>
					</view>
					<view class="history-meta">
						<text class="history-time">{{ c.timeText }}</text>
						<text class="history-del" @tap.stop="confirmDelete(c)">删除</text>
					</view>
				</view>
			</scroll-view>
			<view class="copy-btns">
				<button class="edit-btn copy-btn" :disabled="loading" @tap="copyConversation">复制对话</button>
				<button class="edit-btn copy-btn" :disabled="loading" @tap="copyMemories">复制记忆</button>
			</view>
			<button class="edit-btn ok compress-btn" :disabled="loading" @tap="doCompress">压缩上文为概要</button>
			<button class="edit-btn cancel compress-btn" @tap="exportChat">导出对话为 .txt</button>
			<button class="edit-btn cancel" @tap="$emit('close')">关闭</button>
		</view>
	</view>
</template>

<script>
	import {
		listConversations,
		activeConversationId,
		openConversation,
		removeConversation,
		copyConversationToNew,
		copyMemoriesToNew,
		compressContext
	} from '../../../utils/chat.js'
	import { formatMemoryTime } from '../../../utils/memory.js'
	import { exportChatToFile } from '../../../utils/export.js'

	export default {
		name: 'ChatHistory',
		props: {
			show: { type: Boolean, default: false },
			loading: { type: Boolean, default: false }
		},
		emits: ['close', 'changed'],
		data() {
			return {
				convList: [],
				activeConvId: ''
			}
		},
		watch: {
			show(v) {
				if (v) this.refreshConversations()
			}
		},
		methods: {
			refreshConversations() {
				this.convList = listConversations().map((c) => ({
					...c,
					timeText: formatMemoryTime(c.updated_at) || '刚刚'
				}))
				this.activeConvId = activeConversationId()
			},
			select(id) {
				if (id === this.activeConvId) {
					this.$emit('close')
					return
				}
				if (openConversation(id)) {
					this.$emit('close')
					this.$emit('changed')
				}
			},
			confirmDelete(c) {
				const wasActive = c.id === this.activeConvId
				uni.showModal({
					title: '删除对话',
					content: '确定删除「' + c.title + '」吗？该对话记录将无法恢复。',
					success: (res) => {
						if (!res.confirm) return
						removeConversation(c.id)
						this.refreshConversations()
						if (wasActive) this.$emit('changed')
					}
				})
			},
			copyConversation() {
				if (this.loading) return
				copyConversationToNew()
				this.$emit('changed')
				this.$emit('close')
				uni.showToast({ title: '已复制对话到新会话', icon: 'none' })
			},
			copyMemories() {
				if (this.loading) return
				copyMemoriesToNew()
				this.$emit('changed')
				this.$emit('close')
				uni.showToast({ title: '已复制记忆到新会话', icon: 'none' })
			},
			doCompress() {
				if (this.loading) {
					uni.showToast({ title: '请等待当前回复完成', icon: 'none' })
					return
				}
				uni.showLoading({ title: '压缩中…' })
				compressContext(true)
					.then((done) => {
						uni.hideLoading()
						uni.showToast({ title: done ? '已压缩上文为概要' : '内容太少，暂无需压缩', icon: 'none' })
					})
					.catch((e) => {
						uni.hideLoading()
						uni.showToast({ title: '压缩失败：' + (e && e.message ? e.message : '未知错误'), icon: 'none' })
					})
			},
			exportChat() {
				exportChatToFile()
			}
		}
	}
</script>

<style scoped>
	.mask {
		position: fixed;
		left: 0;
		top: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.45);
		z-index: 999;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.history-panel {
		width: 660rpx;
		background: #fff;
		border-radius: 20rpx;
		padding: 32rpx;
		box-sizing: border-box;
	}

	.edit-title {
		font-size: 32rpx;
		font-weight: 600;
		color: #333;
		text-align: center;
		margin-bottom: 24rpx;
	}

	.history-list {
		height: 560rpx;
		margin-bottom: 24rpx;
	}

	.history-empty {
		padding: 80rpx 0;
		text-align: center;
		font-size: 26rpx;
		color: #bbb;
	}

	.history-item {
		display: flex;
		align-items: center;
		padding: 20rpx 24rpx;
		border-radius: 12rpx;
		background: #f7f8fa;
		margin-bottom: 16rpx;
	}

	.history-item.active {
		background: #eef1fe;
		border: 2rpx solid #5b7cfa;
		box-sizing: border-box;
	}

	.history-main {
		flex: 1;
		min-width: 0;
	}

	.history-title {
		font-size: 28rpx;
		color: #333;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.history-preview {
		margin-top: 6rpx;
		font-size: 22rpx;
		color: #999;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.history-meta {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		margin-left: 16rpx;
		flex-shrink: 0;
	}

	.history-time {
		font-size: 20rpx;
		color: #bbb;
	}

	.history-del {
		margin-top: 10rpx;
		font-size: 22rpx;
		color: #f53f3f;
		padding: 4rpx 8rpx;
	}

	.edit-btn {
		flex: 1;
		height: 80rpx;
		line-height: 80rpx;
		font-size: 28rpx;
		border-radius: 40rpx;
		margin: 0 10rpx;
	}

	.edit-btn.cancel {
		color: #666;
		background: #f2f3f5;
	}

	.edit-btn.ok {
		color: #fff;
		background: #5b7cfa;
	}

	.compress-btn {
		margin-bottom: 16rpx;
	}

	.compress-btn[disabled] {
		opacity: 0.5;
		color: #fff;
	}

	.copy-btns {
		display: flex;
		margin-bottom: 16rpx;
	}

	.copy-btn {
		flex: 1;
		height: 76rpx;
		line-height: 76rpx;
		font-size: 26rpx;
		color: #5b7cfa;
		background: #eef1fe;
		border-radius: 38rpx;
	}

	.copy-btn[disabled] {
		opacity: 0.5;
	}
</style>
