<template>
	<view class="msg-list">
		<scroll-view
			scroll-y
			class="msg-scroll"
			:style="bgStyle"
			:scroll-into-view="scrollInto"
			scroll-with-animation
			@scroll="onMsgScroll"
			@scrolltolower="onMsgScrollToLower"
			@touchstart="onMsgTouchStart"
			@touchmove="onMsgTouchMove"
		>
			<view class="msg-inner">
				<view v-if="!messages.length" class="empty">
					<view class="empty-name">{{ personaName }}</view>
					<view class="empty-tip">打个招呼，开始聊天吧～</view>
				</view>
				<view v-for="(r, i) in displayRows" :key="i" :id="'msg-' + i" class="msg-row" :class="r.role">
					<view v-if="r.type === 'text'" class="bubble">{{ r.text }}</view>
					<image v-else class="bubble-emoji" :src="r.src" mode="aspectFit" />
				</view>
				<view v-if="loading" class="msg-row assistant">
					<view class="bubble typing">正在思考…</view>
				</view>
				<view v-if="!loading && messages.length && lastIsAssistant" class="msg-foot">
					<text class="regenerate" @tap="$emit('regenerate')">重新生成</text>
				</view>
				<view id="anchor"></view>
			</view>
		</scroll-view>

		<!-- 侧边滑块：快速翻阅长聊天记录 -->
		<view class="slider-wrap" v-if="messages.length > 15">
			<view
				class="slider-bar"
				@touchstart="onSliderStart"
				@touchmove.stop.prevent="onSliderMove"
				@touchend="onSliderEnd"
				@touchcancel="onSliderEnd"
			>
				<view class="slider-thumb" :style="{ top: thumbTop }"></view>
			</view>
			<view v-if="dragTip" class="slider-tip">{{ dragTip }}</view>
		</view>

		<!-- 一键回到底部：仅当用户上翻离开底部时出现 -->
		<view v-if="showJumpBottom" class="jump-bottom" @tap="jumpToBottom">
			<text class="jump-arrow">↓</text>
		</view>
	</view>
</template>

<script>
	import { splitEmojiText } from '../../../utils/emojis.js'

	const THUMB_H = 48 // 滑块拇指高度（px），与样式一致

	export default {
		name: 'ChatMsgList',
		props: {
			messages: { type: Array, default: () => [] },
			loading: { type: Boolean, default: false },
			personaName: { type: String, default: '' },
			bg: { type: String, default: '' },
			emojis: { type: Array, default: () => [] }
		},
		emits: ['regenerate'],
		data() {
			return {
				showJumpBottom: false,
				_lastScrollTop: 0, // 上翻检测基线（非模板字段）
				_touchY: null,     // 触摸上翻检测（非模板字段）
				scrollInto: '',
				dragRatio: 1,     // 滑块位置比例（0=顶部 1=底部），松手后保留
				dragTip: '',
				sliderRect: null
			}
		},
		computed: {
			bgStyle() {
				return this.bg
					? {
							backgroundImage: "url('" + this.bg + "')",
							backgroundSize: 'cover',
							backgroundPosition: 'center',
							backgroundRepeat: 'no-repeat'
					  }
					: {}
			},
			lastIsAssistant() {
				const len = this.messages.length
				return len > 0 && this.messages[len - 1].role === 'assistant'
			},
			thumbTop() {
				if (!this.sliderRect) return '0px'
				const h = Math.max(0, this.sliderRect.height - THUMB_H)
				return (this.dragRatio * h).toFixed(1) + 'px'
			},
			// 把每条消息按 $表情名$ 拆分为段行（文本段 → 气泡，表情段 → 图片），分条展示
			displayRows() {
				const map = {}
				for (const e of this.emojis) map[e.name] = e.src
				const rows = []
				for (const m of this.messages) {
					for (const seg of splitEmojiText(m.content, map)) {
						rows.push({ role: m.role, ...seg })
					}
				}
				return rows
			}
		},
		mounted() {
			this.querySlider()
		},
		methods: {
			/** 滚动到底部（页面经 ref 调用；scroll-into-view 仅在值变化时触发：先清空再设置，确保重复调用也能滚动） */
			scrollBottom() {
				this.showJumpBottom = false
				this.scrollInto = ''
				this.$nextTick(() => {
					this.scrollInto = 'anchor'
					this.dragRatio = 1
				})
			},
			/** 页面 onShow 时重置上翻检测状态（经 ref 调用） */
			resetScrollState() {
				this.showJumpBottom = false
				this._lastScrollTop = 0
				this._touchY = null
			},
			// ---- 一键回到底部 ----
			jumpToBottom() {
				this.scrollBottom()
			},
			onMsgScroll(e) {
				// App 端 scroll-view 事件不保证返回 scrollHeight/clientHeight，仅用 scrollTop 差值判断上翻
				const st = e && e.detail && typeof e.detail.scrollTop === 'number' ? e.detail.scrollTop : null
				if (st === null) return
				if (!this.showJumpBottom && st < this._lastScrollTop - 3) {
					this.showJumpBottom = true
				}
				this._lastScrollTop = st
			},
			onMsgScrollToLower() {
				this.showJumpBottom = false
			},
			// 触摸兜底：手指下移（内容上移）＝正在上翻看历史；仅长对话启用避免误触
			onMsgTouchStart(e) {
				this._touchY = e.touches && e.touches.length ? e.touches[0].clientY : null
			},
			onMsgTouchMove(e) {
				if (this.showJumpBottom || this.messages.length <= 15 || !e.touches || !e.touches.length) return
				const y = e.touches[0].clientY
				if (this._touchY !== null && y > this._touchY + 10) this.showJumpBottom = true
				this._touchY = y
			},
			// ---- 侧边滑块 ----
			querySlider() {
				uni.createSelectorQuery()
					.in(this)
					.select('.slider-bar')
					.boundingClientRect((rect) => {
						if (rect) this.sliderRect = { top: rect.top, height: rect.height }
					})
					.exec()
			},
			onSliderStart(e) {
				this.dragRatio = 0
				this.updateDrag(e.touches[0])
			},
			onSliderMove(e) {
				this.updateDrag(e.touches[0])
			},
			onSliderEnd() {
				this.dragTip = ''
				// dragRatio 保留在当前位置，不再重置
			},
			updateDrag(touch) {
				if (!this.sliderRect || !this.displayRows.length) return
				const ratio = Math.min(1, Math.max(0, (touch.clientY - this.sliderRect.top) / this.sliderRect.height))
				this.dragRatio = ratio
				const index = Math.round(ratio * (this.displayRows.length - 1))
				this.scrollInto = 'msg-' + index
				this.dragTip = index + 1 + ' / ' + this.displayRows.length
			}
		}
	}
</script>

<style scoped>
	.msg-list {
		height: 100%;
		position: relative;
	}

	.msg-scroll {
		height: 100%;
	}

	.msg-inner {
		padding: 20rpx 30rpx;
		box-sizing: border-box;
	}

	.empty {
		margin-top: 200rpx;
		text-align: center;
	}

	.empty-name {
		font-size: 40rpx;
		color: #5b7cfa;
		font-weight: 600;
	}

	.empty-tip {
		margin-top: 16rpx;
		font-size: 26rpx;
		color: #bbb;
	}

	.msg-row {
		display: flex;
		margin-bottom: 20rpx;
	}

	.msg-row.user {
		justify-content: flex-end;
	}

	.msg-foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		margin-top: 6rpx;
	}

	.regenerate {
		font-size: 22rpx;
		color: #999;
		padding: 4rpx 16rpx;
	}

	.bubble {
		max-width: 80%;
		padding: 18rpx 24rpx;
		border-radius: 20rpx;
		font-size: 28rpx;
		line-height: 1.6;
		word-break: break-word;
		white-space: pre-wrap;
	}

	.msg-row.assistant .bubble {
		background: #ffffff;
		color: #333;
		border-top-left-radius: 6rpx;
		box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);
	}

	.msg-row.user .bubble {
		background: #5b7cfa;
		color: #fff;
		border-top-right-radius: 6rpx;
	}

	.bubble.typing {
		color: #aaa;
	}

	/* 表情消息：图片独立成行展示 */
	.bubble-emoji {
		width: 200rpx;
		height: 200rpx;
		border-radius: 12rpx;
	}

	.slider-wrap {
		position: absolute;
		right: 6rpx;
		top: 16rpx;
		bottom: 16rpx;
		width: 48rpx;
		display: flex;
		justify-content: center;
		z-index: 10;
	}

	.slider-bar {
		position: relative;
		width: 8rpx;
		height: 100%;
		background: rgba(0, 0, 0, 0.15);
		border-radius: 8rpx;
	}

	.slider-thumb {
		position: absolute;
		left: 0;
		width: 8rpx;
		height: 48px;
		background: rgba(0, 0, 0, 0.4);
		border-radius: 8rpx;
	}

	.slider-tip {
		position: absolute;
		right: 56rpx;
		top: 50%;
		transform: translateY(-50%);
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		font-size: 24rpx;
		padding: 8rpx 20rpx;
		border-radius: 24rpx;
		white-space: nowrap;
	}

	.jump-bottom {
		position: absolute;
		right: 96rpx;
		bottom: 24rpx;
		width: 88rpx;
		height: 88rpx;
		border-radius: 50%;
		background: #5b7cfa;
		box-shadow: 0 4rpx 16rpx rgba(91, 124, 250, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 20;
	}

	.jump-arrow {
		color: #fff;
		font-size: 44rpx;
		line-height: 1;
	}
</style>
