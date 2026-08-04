<template>
	<view class="page">
		<view class="header">
			<view class="header-left">
				<text class="persona">{{ personaName }}</text>
				<text class="model">{{ model }}</text>
			</view>
			<text class="clear" @tap="confirmClear">清空</text>
		</view>

		<view class="scene-bar" v-if="scene" @tap="openSceneEdit">
			<view class="scene-dot"></view>
			<text class="scene-text">{{ scene }}</text>
		</view>

		<view class="msg-wrap">
			<scroll-view
				scroll-y
				class="msg-list"
				:style="bgStyle"
				:scroll-into-view="scrollInto"
				scroll-with-animation
			>
				<view class="msg-inner">
					<view v-if="!messages.length" class="empty">
						<view class="empty-name">{{ personaName }}</view>
						<view class="empty-tip">打个招呼，开始聊天吧～</view>
					</view>
					<view v-for="(m, i) in messages" :key="i" :id="'msg-' + i" class="msg-row" :class="m.role">
						<view class="bubble">{{ m.content }}</view>
					</view>
					<view v-if="loading" class="msg-row assistant">
						<view class="bubble typing">正在思考…</view>
					</view>
					<view v-if="!loading && messages.length && lastIsAssistant" class="msg-foot">
						<text class="regenerate" @tap="doRegenerate">重新生成</text>
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
		</view>

		<view class="input-bar">
			<input
				class="input"
				v-model="input"
				confirm-type="send"
				:disabled="loading"
				placeholder="输入消息…"
				@confirm="send"
			/>
			<button class="send-btn" :disabled="loading || !input.trim()" @tap="send">发送</button>
		</view>

		<!-- 情景编辑弹窗 -->
		<view v-if="showSceneEdit" class="mask" @tap="closeSceneEdit">
			<view class="edit-panel" @tap.stop>
				<view class="edit-title">编辑当前情景</view>
				<textarea
					class="edit-area"
					v-model="sceneDraft"
					maxlength="200"
					placeholder="用户此刻在做什么…（留空保存可清除）"
				/>
				<view class="edit-btns">
					<button class="edit-btn cancel" @tap="closeSceneEdit">取消</button>
					<button class="edit-btn ok" @tap="saveScene">保存</button>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	import { sendMessage, getHistoryForUI, clearConversation, getSettings, popLastAssistant } from '../../utils/chat.js'
	import { getBackgroundImage, getScene, setScene } from '../../utils/storage.js'

	const THUMB_H = 48 // 滑块拇指高度（px），与样式一致

	export default {
		data() {
			return {
				messages: [],
				input: '',
				loading: false,
				personaName: '',
				model: '',
				bg: '',
				scene: '',
				showSceneEdit: false,
				sceneDraft: '',
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
			}
		},
		onShow() {
			this.messages = getHistoryForUI()
			this.refreshHeader()
			this.bg = getBackgroundImage()
			this.scene = getScene()
		},
		onReady() {
			this.querySlider()
		},
		methods: {
			refreshHeader() {
				const s = getSettings()
				this.personaName = s.personaName
				this.model = s.model
			},
			send() {
				const text = this.input.trim()
				if (!text || this.loading) return
				this.input = ''
				this.messages.push({ role: 'user', content: text })
				this.loading = true
				this.scrollBottom()
				sendMessage(text)
					.then(({ reply, saved }) => {
						this.messages.push({ role: 'assistant', content: reply })
						this.scene = getScene() // LLM 可能更新了当前情景
						if (saved > 0) uni.showToast({ title: '已记住 ' + saved + ' 条', icon: 'none' })
					})
					.catch((e) => {
						this.messages.push({
							role: 'assistant',
							content: '⚠️ ' + (e && e.message ? e.message : '出错了')
						})
					})
					.finally(() => {
						this.loading = false
						this.scrollBottom()
					})
			},
			scrollBottom() {
				this.$nextTick(() => {
					this.scrollInto = 'anchor'
					this.dragRatio = 1
				})
			},
			doRegenerate() {
				if (this.loading) return
				const lastUser = popLastAssistant()
				if (!lastUser) return
				// 移除本地展示中的最后一条助手消息，然后静默重发上一条用户消息
				if (this.lastIsAssistant) this.messages.pop()
				this.input = ''
				this.loading = true
				sendMessage(lastUser)
					.then(({ reply, saved }) => {
						this.messages.push({ role: 'assistant', content: reply })
						this.scene = getScene()
						if (saved > 0) uni.showToast({ title: '已记住 ' + saved + ' 条', icon: 'none' })
					})
					.catch((e) => {
						this.messages.push({
							role: 'assistant',
							content: '⚠️ ' + (e && e.message ? e.message : '出错了')
						})
					})
					.finally(() => {
						this.loading = false
						this.scrollBottom()
					})
			},
			confirmClear() {
				uni.showModal({
					title: '清空对话',
					content: '确定清空当前聊天记录吗？（记忆不会清除）',
					success: (res) => {
						if (res.confirm) {
							clearConversation()
							this.messages = []
						}
					}
				})
			},
			// ---- 当前情景编辑 ----
			openSceneEdit() {
				this.sceneDraft = this.scene
				this.showSceneEdit = true
			},
			closeSceneEdit() {
				this.showSceneEdit = false
			},
			saveScene() {
				const v = this.sceneDraft.trim()
				setScene(v)
				this.scene = v
				this.showSceneEdit = false
				uni.showToast({ title: v ? '已更新情景' : '已清除情景', icon: 'none' })
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
				if (!this.sliderRect || !this.messages.length) return
				const ratio = Math.min(1, Math.max(0, (touch.clientY - this.sliderRect.top) / this.sliderRect.height))
				this.dragRatio = ratio
				const index = Math.round(ratio * (this.messages.length - 1))
				this.scrollInto = 'msg-' + index
				this.dragTip = index + 1 + ' / ' + this.messages.length
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

	.clear {
		font-size: 26rpx;
		color: #999;
		padding: 8rpx 12rpx;
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

	.msg-wrap {
		flex: 1;
		position: relative;
		overflow: hidden;
	}

	.msg-list {
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

	.edit-area {
		width: 100%;
		height: 200rpx;
		background: #f7f8fa;
		border-radius: 12rpx;
		padding: 20rpx;
		box-sizing: border-box;
		font-size: 28rpx;
		line-height: 1.5;
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
