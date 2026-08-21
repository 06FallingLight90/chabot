<template>
	<view class="page">
		<view class="toolbar">
			<view class="count">共 {{ emojis.length }} 个表情</view>
			<view class="tool-btn" @tap="startUpload">上传表情</view>
		</view>

		<scroll-view scroll-y class="list">
			<view v-if="!emojis.length" class="empty">暂无表情，点右上角「上传表情」添加</view>
			<view v-for="e in emojis" :key="e.id" class="card">
				<image class="card-img" :src="e.src" mode="aspectFit" />
				<view class="card-main">
					<text class="card-name">${{ e.name }}$</text>
					<text class="card-time">{{ fmtTime(e.created_at) }}</text>
				</view>
				<view class="card-ops">
					<text class="edit" @tap="startRename(e)">改名</text>
					<text class="del" @tap="confirmDelete(e)">删除</text>
				</view>
			</view>
		</scroll-view>

		<!-- 名称输入弹窗（上传 / 改名共用，上传支持批量逐张命名） -->
		<view v-if="showName" class="mask" @tap="closeName">
			<view class="edit-panel" @tap.stop>
				<view class="edit-title">{{ mode === 'upload' ? '上传表情（' + (uploadIndex + 1) + '/' + uploadQueue.length + '）' : '修改表情名' }}</view>
				<view class="preview-wrap">
					<image class="preview-img" :src="previewSrc" mode="aspectFit" />
				</view>
				<input
					class="name-input"
					v-model="nameDraft"
					maxlength="20"
					:placeholder="mode === 'upload' ? '给表情起个名字，如：小狗高兴' : '输入新的表情名'"
				/>
				<view class="edit-btns">
					<button class="edit-btn cancel" @tap="closeName">取消</button>
					<button class="edit-btn ok" @tap="saveName">保存</button>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	import { getEmojis, addEmoji, renameEmoji, deleteEmoji } from '../../utils/emojis.js'
	import { formatMemoryTime } from '../../utils/memory.js'

	export default {
		data() {
			return {
				emojis: [],
				showName: false,     // 名称输入弹窗
				mode: 'upload',      // upload 上传 / rename 改名
				nameDraft: '',       // 表情名输入草稿
				previewSrc: '',      // 弹窗中预览的图片
				uploadQueue: [],     // 批量选择待命名的图片临时路径数组
				uploadIndex: 0,      // 当前命名到第几张（0 起）
				editingId: null      // 改名模式：表情 id
			}
		},
		onShow() {
			this.refresh()
		},
		methods: {
			refresh() {
				this.emojis = getEmojis()
			},
			fmtTime(t) {
				return formatMemoryTime(t) || '刚刚'
			},
			startUpload() {
				uni.chooseImage({
					count: 9,
					sizeType: ['compressed'],
					success: (res) => {
						const paths = (res.tempFilePaths || []).filter(Boolean)
						if (!paths.length) return
						this.mode = 'upload'
						this.editingId = null
						this.uploadQueue = paths
						this.uploadIndex = 0
						this.previewSrc = paths[0]
						this.nameDraft = ''
						this.showName = true
					}
				})
			},
			startRename(e) {
				this.mode = 'rename'
				this.editingId = e.id
				this.nameDraft = e.name
				this.previewSrc = e.src
				this.showName = true
			},
			closeName() {
				this.showName = false
				this.uploadQueue = []
				this.uploadIndex = 0
			},
			saveName() {
				const name = this.nameDraft.trim()
				if (!name) {
					uni.showToast({ title: '请填写表情名', icon: 'none' })
					return
				}
				try {
					if (this.mode === 'upload') {
						uni.showLoading({ title: '保存中…' })
						addEmoji(this.uploadQueue[this.uploadIndex], name)
							.then(() => {
								uni.hideLoading()
								this.uploadIndex++
								// 还有待命名的图片：继续下一张
								if (this.uploadIndex < this.uploadQueue.length) {
									this.previewSrc = this.uploadQueue[this.uploadIndex]
									this.nameDraft = ''
									return
								}
								// 全部命名完成
								const total = this.uploadQueue.length
								this.closeName()
								this.refresh()
								uni.showToast({ title: '已添加 ' + total + ' 个表情', icon: 'success' })
							})
							.catch((e) => {
								uni.hideLoading()
								uni.showToast({ title: e && e.message ? e.message : '保存失败', icon: 'none' })
							})
					} else {
						renameEmoji(this.editingId, name)
						this.closeName()
						this.refresh()
						uni.showToast({ title: '已修改', icon: 'success' })
					}
				} catch (e) {
					uni.showToast({ title: e && e.message ? e.message : '操作失败', icon: 'none' })
				}
			},
			confirmDelete(e) {
				uni.showModal({
					title: '删除表情',
					content: `确定删除表情「${e.name}」吗？历史消息中已引用的位置将显示为文本。`,
					success: (res) => {
						if (res.confirm) {
							deleteEmoji(e.id)
							this.refresh()
							uni.showToast({ title: '已删除', icon: 'none' })
						}
					}
				})
			}
		}
	}
</script>

<style>
	.page {
		height: 100vh;
		display: flex;
		flex-direction: column;
		background: #f7f8fa;
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20rpx 30rpx;
		background: #ffffff;
		border-bottom: 1rpx solid #eee;
	}

	.count {
		font-size: 26rpx;
		color: #999;
	}

	.tool-btn {
		font-size: 28rpx;
		color: #5b7cfa;
		padding: 8rpx 20rpx;
	}

	.list {
		flex: 1;
	}

	.empty {
		padding: 160rpx 0;
		text-align: center;
		font-size: 26rpx;
		color: #bbb;
	}

	.card {
		display: flex;
		align-items: center;
		margin: 20rpx 30rpx;
		padding: 20rpx;
		background: #ffffff;
		border-radius: 16rpx;
		box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);
	}

	.card-img {
		width: 120rpx;
		height: 120rpx;
		border-radius: 12rpx;
		flex-shrink: 0;
	}

	.card-main {
		flex: 1;
		min-width: 0;
		margin-left: 24rpx;
		display: flex;
		flex-direction: column;
	}

	.card-name {
		font-size: 30rpx;
		color: #333;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card-time {
		margin-top: 8rpx;
		font-size: 22rpx;
		color: #bbb;
	}

	.card-ops {
		display: flex;
		flex-shrink: 0;
		margin-left: 16rpx;
	}

	.edit {
		font-size: 26rpx;
		color: #5b7cfa;
		padding: 8rpx 16rpx;
	}

	.del {
		font-size: 26rpx;
		color: #f53f3f;
		padding: 8rpx 16rpx;
	}

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

	.edit-panel {
		width: 640rpx;
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

	.preview-wrap {
		display: flex;
		justify-content: center;
		margin-bottom: 24rpx;
	}

	.preview-img {
		width: 200rpx;
		height: 200rpx;
		border-radius: 12rpx;
	}

	.name-input {
		width: 100%;
		height: 76rpx;
		background: #f2f3f5;
		border-radius: 12rpx;
		padding: 0 24rpx;
		box-sizing: border-box;
		font-size: 28rpx;
	}

	.edit-btns {
		display: flex;
		margin-top: 32rpx;
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
</style>
