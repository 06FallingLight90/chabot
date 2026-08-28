<template>
	<!-- 表情栏：展示全部表情，点击插入 $表情名$ 占位；长按拖动可调整网格顺序；常驻渲染，展开/收起带平滑过渡 -->
	<view class="emoji-panel" :class="{ 'panel-open': open }">
		<scroll-view :scroll-y="!dragId" class="emoji-list">
			<view class="emoji-grid">
				<view v-if="!list.length" class="emoji-empty">还没有表情包，点下方「上传表情」添加</view>
				<view
					v-for="e in list"
					:key="e.id"
					class="emoji-item"
					:class="{ dragging: dragId === e.id }"
					:style="dragId === e.id ? { position: 'fixed', left: dragX + 'px', top: dragY + 'px', zIndex: 99 } : ''"
					@tap.stop="insertEmoji(e)"
					@touchstart="onEmojiTouchStart($event, e)"
					@touchmove="onEmojiTouchMove($event, e)"
					@touchend="onEmojiTouchEnd"
					@touchcancel="onEmojiTouchEnd"
				>
					<image class="emoji-thumb" :src="e.src" mode="aspectFit" />
					<text class="emoji-name">{{ e.name }}</text>
				</view>
			</view>
		</scroll-view>
		<view class="emoji-tools">
			<text class="emoji-tool" @tap="startUploadEmoji">上传表情</text>
			<text class="emoji-tool" @tap="openEmojiManage">管理</text>
		</view>

		<!-- 上传表情：名称输入弹窗（批量选择后逐张命名） -->
		<view v-if="showEmojiName" class="mask" @tap="closeEmojiName">
			<view class="edit-panel" @tap.stop>
				<view class="edit-title">上传表情（{{ uploadIndex + 1 }}/{{ uploadQueue.length }}）</view>
				<view class="preview-wrap">
					<image class="preview-img" :src="emojiPendingSrc" mode="aspectFit" />
				</view>
				<input
					class="emoji-name-input"
					v-model="emojiNameDraft"
					maxlength="20"
					placeholder="给表情起个名字，如：小狗高兴"
				/>
				<view class="edit-btns">
					<button class="edit-btn cancel" @tap="closeEmojiName">取消</button>
					<button class="edit-btn ok" @tap="confirmEmojiName">保存</button>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	import { addEmoji, reorderEmojis } from '../../../utils/emojis.js'

	export default {
		name: 'ChatEmojiPanel',
		props: {
			open: { type: Boolean, default: false },
			emojis: { type: Array, default: () => [] }
		},
		emits: ['insert', 'change'],
		data() {
			return {
				list: [],              // 本地展示列表（随 emojis 同步，拖拽期间临时重排）
				showEmojiName: false,  // 上传表情名称输入弹窗
				emojiNameDraft: '',    // 表情名输入草稿
				emojiPendingSrc: '',   // 当前命名中图片的临时路径
				uploadQueue: [],       // 批量选择待命名的图片临时路径数组
				uploadIndex: 0,        // 当前命名到第几张（0 起）
				dragId: '',            // 当前拖拽中的表情 id（空=未拖拽，表情栏可正常滚动）
				dragX: 0,              // 拖拽项 fixed 定位（px）
				dragY: 0
			}
		},
		watch: {
			open(v) {
				if (v) this.list = this.emojis.slice()
			},
			emojis(v) {
				this.list = (v || []).slice()
			}
		},
		methods: {
			insertEmoji(e) {
				// 长按进入过拖拽模式的松手会抑制一次 tap，避免误发送表情
				if (this._suppressTap) {
					this._suppressTap = false
					return
				}
				this.$emit('insert', e.name)
			},
			// ---- 表情栏拖拽排序（touch 事件：短按=发送表情 / 滑动=滚动面板 / 长按 1 秒=拖动排序）----
			onEmojiTouchStart(ev, emoji) {
				const t = ev.touches && ev.touches[0]
				if (!t) return
				this._suppressTap = false
				this._dragStartX = t.clientX
				this._dragStartY = t.clientY
				this._dragEmojiId = emoji.id
				this._dragStartIndex = this.list.findIndex((e) => e.id === emoji.id)
				this._dragMoved = false
				this._itemRects = null
				// 预取所有格子位置（异步，长按结束时大概率已就绪）
				this.queryEmojiRects()
				// 长按 1 秒进入拖动模式；期间手指移动（滑动表情栏）则取消
				this._longPressTimer = setTimeout(() => {
					this._longPressTimer = null
					this.enterDragMode()
				}, 1000)
			},
			onEmojiTouchMove(ev, emoji) {
				if (!this._dragEmojiId) return
				const t = ev.touches && ev.touches[0]
				if (!t) return
				// 未进入拖拽：移动超过阈值视为滑动表情栏，取消长按计时
				if (!this.dragId) {
					const dx = t.clientX - this._dragStartX
					const dy = t.clientY - this._dragStartY
					if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
					if (this._longPressTimer) {
						clearTimeout(this._longPressTimer)
						this._longPressTimer = null
					}
					return
				}
				// 拖拽中：标记发生过移动，跟随手指并实时重排
				this._dragMoved = true
				this.dragX = this._dragBaseX + (t.clientX - this._dragStartX)
				this.dragY = this._dragBaseY + (t.clientY - this._dragStartY)
				this.updateDragOrder(t)
			},
			onEmojiTouchEnd() {
				if (this._longPressTimer) {
					clearTimeout(this._longPressTimer)
					this._longPressTimer = null
				}
				if (this.dragId) {
					// 本次触摸进入过拖拽模式：抑制随后的 tap（防止松手误发送表情）
					this._suppressTap = true
					if (this._dragMoved && this._pendingOrder) {
						reorderEmojis(this._pendingOrder)
						this.$emit('change')
					}
					this.dragId = ''
				}
				this._dragEmojiId = ''
				this._dragMoved = false
				this._pendingOrder = null
				this._itemRects = null
			},
			// 长按达标：进入拖动模式，被拖表情略微放大并随触屏点移动
			enterDragMode() {
				this.dragId = this._dragEmojiId
				const rect = this._itemRects && this._itemRects[this._dragStartIndex]
				if (rect) {
					this._dragBaseX = rect.left
					this._dragBaseY = rect.top
				} else {
					this._dragBaseX = this._dragStartX
					this._dragBaseY = this._dragStartY
				}
				// 初始位置 = 被拖项原位置（后续 touchmove 在其上叠加位移）
				this.dragX = this._dragBaseX
				this.dragY = this._dragBaseY
			},
			// 一次性获取表情网格中所有格子的位置（视觉顺序，用于计算插入位置）
			queryEmojiRects() {
				uni.createSelectorQuery()
					.in(this)
					.selectAll('.emoji-item')
					.boundingClientRect((rects) => {
						if (Array.isArray(rects) && rects.length) this._itemRects = rects
					})
					.exec()
			},
			// 根据手指位置计算目标格子索引并实时重排（插入后后面的表情顺延一位）
			updateDragOrder(t) {
				if (!this._itemRects || !this._itemRects.length) return
				let target = -1
				for (let i = 0; i < this._itemRects.length; i++) {
					const r = this._itemRects[i]
					if (t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom) {
						target = i
						break
					}
				}
				if (target < 0) return
				const from = this.list.findIndex((e) => e.id === this.dragId)
				if (from < 0 || from === target) return
				const list = this.list.slice()
				const [moved] = list.splice(from, 1)
				list.splice(target, 0, moved)
				this.list = list
				this._pendingOrder = list.map((e) => e.id)
			},
			startUploadEmoji() {
				uni.chooseImage({
					count: 9,
					sizeType: ['compressed'],
					success: (res) => {
						const paths = (res.tempFilePaths || []).filter(Boolean)
						if (!paths.length) return
						this.uploadQueue = paths
						this.uploadIndex = 0
						this.emojiPendingSrc = paths[0]
						this.emojiNameDraft = ''
						this.showEmojiName = true
					}
				})
			},
			closeEmojiName() {
				this.showEmojiName = false
				this.uploadQueue = []
				this.uploadIndex = 0
			},
			confirmEmojiName() {
				const name = this.emojiNameDraft.trim()
				if (!name) {
					uni.showToast({ title: '请填写表情名', icon: 'none' })
					return
				}
				uni.showLoading({ title: '保存中…' })
				addEmoji(this.uploadQueue[this.uploadIndex], name)
					.then(() => {
						uni.hideLoading()
						this.uploadIndex++
						// 还有待命名的图片：继续下一张
						if (this.uploadIndex < this.uploadQueue.length) {
							this.emojiPendingSrc = this.uploadQueue[this.uploadIndex]
							this.emojiNameDraft = ''
							return
						}
						// 全部命名完成
						const total = this.uploadQueue.length
						this.closeEmojiName()
						this.$emit('change')
						uni.showToast({ title: '已添加 ' + total + ' 个表情', icon: 'success' })
					})
					.catch((e) => {
						uni.hideLoading()
						uni.showToast({ title: e && e.message ? e.message : '保存失败', icon: 'none' })
					})
			},
			openEmojiManage() {
				uni.navigateTo({ url: '/pages/emoji/emoji' })
			}
		}
	}
</script>

<style scoped>
	.emoji-panel {
		overflow: hidden;
		max-height: 0;
		opacity: 0;
		transition: max-height 0.25s ease, opacity 0.25s ease;
		background: var(--c-card);
		border-top: 1rpx solid var(--c-line);
	}

	.emoji-panel.panel-open {
		max-height: 520rpx;
		opacity: 1;
	}

	.emoji-list {
		max-height: 380rpx;
	}

	.emoji-grid {
		display: flex;
		flex-wrap: wrap;
		padding: 16rpx;
		box-sizing: border-box;
	}

	.emoji-empty {
		width: 100%;
		padding: 48rpx 0;
		text-align: center;
		font-size: 24rpx;
		color: var(--c-text-aid);
	}

	.emoji-item {
		width: 25%;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 12rpx 0;
		box-sizing: border-box;
	}

	/* 拖拽中的表情：略微放大悬浮，弱化原占位 */
	.emoji-item.dragging {
		opacity: 0.75;
		transform: scale(1.1);
	}

	.emoji-thumb {
		width: 100rpx;
		height: 100rpx;
	}

	.emoji-name {
		margin-top: 8rpx;
		font-size: 20rpx;
		color: var(--c-text-secondary);
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.emoji-tools {
		display: flex;
		border-top: 1rpx solid var(--c-line);
	}

	.emoji-tool {
		flex: 1;
		text-align: center;
		padding: 20rpx 0;
		font-size: 26rpx;
		color: var(--c-primary);
	}

	.emoji-tool + .emoji-tool {
		border-left: 1rpx solid var(--c-line);
	}

	.emoji-name-input {
		width: 100%;
		height: 76rpx;
		background: var(--c-bg);
		color: var(--c-text);
		border-radius: 12rpx;
		padding: 0 24rpx;
		box-sizing: border-box;
		font-size: 28rpx;
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
		background: var(--c-card);
		border-radius: 20rpx;
		padding: 32rpx;
		box-sizing: border-box;
	}

	.edit-title {
		font-size: 32rpx;
		font-weight: 600;
		color: var(--c-text);
		text-align: center;
		margin-bottom: 24rpx;
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
		color: var(--c-text-secondary);
		background: var(--c-bg);
	}

	.edit-btn.ok {
		color: #fff;
		background: var(--c-primary);
	}
</style>
