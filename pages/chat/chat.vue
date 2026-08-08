<template>
	<view class="page">
		<view class="header">
			<view class="header-left">
				<text class="persona" @tap="openPersona">{{ personaName }}</text>
				<text class="model">{{ model }}</text>
			</view>
			<view class="header-right">
				<text class="h-btn" @tap="openHistory">历史</text>
				<text class="h-btn primary" @tap="newChat">新对话</text>
				<text class="h-btn" @tap="confirmClear">清空</text>
			</view>
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

			<!-- 一键回到底部：仅当用户上翻离开底部时出现 -->
			<view v-if="showJumpBottom" class="jump-bottom" @tap="jumpToBottom">
				<text class="jump-arrow">↓</text>
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
				<view v-if="sceneHistory.length" class="scene-history">
					<view class="scene-history-head">历史情景（最近 {{ sceneHistory.length }} 条，点击填入编辑框）</view>
					<scroll-view scroll-y class="scene-history-list">
						<view
							v-for="(h, i) in sceneHistory"
							:key="i"
							class="scene-history-item"
							@tap="useSceneHistory(h)"
						>
							<text class="scene-history-idx">{{ i + 1 }}</text>
							<text class="scene-history-text">{{ h }}</text>
						</view>
					</scroll-view>
				</view>
				<view class="edit-btns">
					<button class="edit-btn cancel" @tap="closeSceneEdit">取消</button>
					<button class="edit-btn ok" @tap="saveScene">保存</button>
				</view>
			</view>
		</view>

		<!-- 历史对话弹窗 -->
		<view v-if="showHistory" class="mask" @tap="closeHistory">
			<view class="history-panel" @tap.stop>
				<view class="edit-title">对话历史</view>
				<scroll-view scroll-y class="history-list">
					<view v-if="!convList.length" class="history-empty">暂无历史对话</view>
					<view
						v-for="c in convList"
						:key="c.id"
						class="history-item"
						:class="{ active: c.id === activeConvId }"
						@tap="openConversation(c.id)"
					>
						<view class="history-main">
							<view class="history-title">{{ c.title }}</view>
							<view class="history-preview">{{ c.preview }}</view>
						</view>
						<view class="history-meta">
							<text class="history-time">{{ c.timeText }}</text>
							<text class="history-del" @tap.stop="confirmDeleteConv(c)">删除</text>
						</view>
					</view>
				</scroll-view>
				<view class="copy-btns">
					<button class="edit-btn copy-btn" :disabled="loading" @tap="copyConversation">复制对话</button>
					<button class="edit-btn copy-btn" :disabled="loading" @tap="copyMemories">复制记忆</button>
				</view>
				<button class="edit-btn ok compress-btn" :disabled="loading" @tap="doCompress">压缩上文为概要</button>
				<button class="edit-btn cancel" @tap="closeHistory">关闭</button>
			</view>
		</view>

		<!-- 会话人格设置弹窗 -->
		<view v-if="showPersona" class="mask" @tap="closePersona">
			<view class="persona-panel" @tap.stop>
				<view class="edit-title">当前对话人格</view>
				<view class="persona-hint">仅作用于当前对话，不影响其他对话与全局设置</view>
				<scroll-view scroll-y class="persona-list">
					<view
						v-for="p in personalities"
						:key="p.id"
						class="persona-item"
						:class="{ active: personaDraftId === p.id }"
						@tap="pickPersona(p.id)"
					>
						<view class="persona-item-name">{{ p.name }}</view>
						<view class="persona-item-desc">{{ p.desc }}</view>
					</view>
					<view
						class="persona-item"
						:class="{ active: personaDraftId === 'custom' }"
						@tap="pickPersona('custom')"
					>
						<view class="persona-item-name">自定义</view>
						<view class="persona-item-desc">手写专属人格提示词</view>
					</view>
				</scroll-view>
				<textarea
					v-if="personaDraftId === 'custom'"
					class="persona-custom"
					v-model="personaDraftPrompt"
					maxlength="5000"
					placeholder="在这里输入完整的人格设定提示词…"
				/>
				<view class="edit-btns">
					<button class="edit-btn cancel" @tap="closePersona">取消</button>
					<button class="edit-btn ok" @tap="savePersona">保存</button>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	import {
		sendMessage,
		getHistoryForUI,
		clearConversation,
		getConversationSettings,
		popLastAssistant,
		startNewConversation,
		listConversations,
		activeConversationId,
		openConversation,
		removeConversation,
		copyConversationToNew,
		copyMemoriesToNew,
		compressContext,
		saveConversationPersonality
	} from '../../utils/chat.js'
	import { getBackgroundImage, getScene, setScene, getSceneHistory } from '../../utils/storage.js'
	import { formatMemoryTime } from '../../utils/memory.js'
	import { PERSONALITIES } from '../../utils/prompts.js'

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
				sceneHistory: [],
				showHistory: false,
				convList: [],
				activeConvId: '',
				showJumpBottom: false,
				_lastScrollTop: 0, // 上翻检测基线（非模板字段）
				_touchY: null,     // 触摸上翻检测（非模板字段）
				scrollInto: '',
				dragRatio: 1,     // 滑块位置比例（0=顶部 1=底部），松手后保留
				dragTip: '',
				sliderRect: null,
				personalities: PERSONALITIES,
				showPersona: false,      // 会话人格弹窗
				personaDraftId: '',      // 弹窗中选择的人格 id
				personaDraftPrompt: ''   // 自定义人格提示词草稿
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
			this.showJumpBottom = false
			this._lastScrollTop = 0
			this._touchY = null
		},
		onReady() {
			this.querySlider()
		},
		methods: {
			refreshHeader() {
				// 头部展示当前会话的人格（会话快照，非全局设置）
				const s = getConversationSettings()
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
				this.showJumpBottom = false
				// scroll-into-view 仅在值变化时触发：先清空再设置，确保重复点击也能滚动
				this.scrollInto = ''
				this.$nextTick(() => {
					this.scrollInto = 'anchor'
					this.dragRatio = 1
				})
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
			// ---- 会话人格设置（仅作用于当前对话） ----
			openPersona() {
				const s = getConversationSettings()
				this.personaDraftId = s.personalityId
				this.personaDraftPrompt = s.customPrompt || ''
				this.showPersona = true
			},
			closePersona() {
				this.showPersona = false
			},
			pickPersona(id) {
				this.personaDraftId = id
			},
			savePersona() {
				if (this.personaDraftId === 'custom' && !this.personaDraftPrompt.trim()) {
					uni.showToast({ title: '请填写自定义人格提示词', icon: 'none' })
					return
				}
				saveConversationPersonality(this.personaDraftId, this.personaDraftPrompt)
				this.showPersona = false
				this.refreshHeader()
				uni.showToast({ title: '已切换人格', icon: 'success' })
			},
			// ---- 当前情景编辑 ----
			openSceneEdit() {
				this.sceneDraft = this.scene
				this.sceneHistory = getSceneHistory().slice().reverse() // 最新在前
				this.showSceneEdit = true
			},
			closeSceneEdit() {
				this.showSceneEdit = false
			},
			useSceneHistory(h) {
				this.sceneDraft = h
			},
			saveScene() {
				const v = this.sceneDraft.trim()
				setScene(v)
				this.scene = v
				this.showSceneEdit = false
				uni.showToast({ title: v ? '已更新情景' : '已清除情景', icon: 'none' })
			},
			// ---- 会话历史 / 上下文压缩 ----
			newChat() {
				if (this.loading) return
				startNewConversation()
				this.messages = getHistoryForUI()
				this.scene = getScene()
				this.refreshHeader()
				uni.showToast({ title: '已开始新对话', icon: 'none' })
			},
			openHistory() {
				this.refreshConversations()
				this.showHistory = true
			},
			closeHistory() {
				this.showHistory = false
			},
			refreshConversations() {
				this.convList = listConversations().map((c) => ({
					...c,
					timeText: formatMemoryTime(c.updated_at) || '刚刚'
				}))
				this.activeConvId = activeConversationId()
			},
			openConversation(id) {
				if (id === this.activeConvId) {
					this.closeHistory()
					return
				}
				if (openConversation(id)) {
					this.activeConvId = id
					this.messages = getHistoryForUI()
					this.scene = getScene()
					this.showHistory = false
					this.scrollBottom()
				}
			},
			confirmDeleteConv(c) {
				const wasActive = c.id === this.activeConvId
				uni.showModal({
					title: '删除对话',
					content: '确定删除「' + c.title + '」吗？该对话记录将无法恢复。',
					success: (res) => {
						if (!res.confirm) return
						removeConversation(c.id)
						this.refreshConversations()
						if (wasActive) {
							this.messages = getHistoryForUI()
							this.scene = getScene()
						}
					}
				})
			},
			copyConversation() {
				if (this.loading) return
				copyConversationToNew()
				this.messages = getHistoryForUI()
				this.scene = getScene()
				this.refreshHeader()
				this.showHistory = false
				uni.showToast({ title: '已复制对话到新会话', icon: 'none' })
			},
			copyMemories() {
				if (this.loading) return
				copyMemoriesToNew()
				this.messages = getHistoryForUI()
				this.scene = getScene()
				this.refreshHeader()
				this.showHistory = false
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

	.scene-history {
		margin-top: 20rpx;
	}

	.scene-history-head {
		font-size: 22rpx;
		color: #999;
		margin-bottom: 10rpx;
	}

	.scene-history-list {
		max-height: 300rpx;
	}

	.scene-history-item {
		display: flex;
		align-items: center;
		padding: 14rpx 20rpx;
		background: #f7f8fa;
		border-radius: 10rpx;
		margin-bottom: 12rpx;
	}

	.scene-history-idx {
		flex-shrink: 0;
		width: 40rpx;
		font-size: 22rpx;
		color: #5b7cfa;
	}

	.scene-history-text {
		flex: 1;
		min-width: 0;
		font-size: 24rpx;
		color: #666;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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

	.history-panel {
		width: 660rpx;
		background: #fff;
		border-radius: 20rpx;
		padding: 32rpx;
		box-sizing: border-box;
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

	.persona-panel {
		width: 640rpx;
		background: #fff;
		border-radius: 20rpx;
		padding: 32rpx;
		box-sizing: border-box;
	}

	.persona-hint {
		font-size: 22rpx;
		color: #999;
		text-align: center;
		margin-bottom: 20rpx;
	}

	.persona-list {
		height: 480rpx;
	}

	.persona-item {
		padding: 18rpx 24rpx;
		border-radius: 12rpx;
		background: #f7f8fa;
		margin-bottom: 16rpx;
		border: 2rpx solid transparent;
	}

	.persona-item.active {
		border-color: #5b7cfa;
		background: #eef1fe;
	}

	.persona-item-name {
		font-size: 28rpx;
		color: #333;
		font-weight: 500;
	}

	.persona-item-desc {
		font-size: 22rpx;
		color: #999;
		margin-top: 4rpx;
	}

	.persona-custom {
		width: 100%;
		height: 260rpx;
		background: #f7f8fa;
		border-radius: 12rpx;
		padding: 20rpx;
		box-sizing: border-box;
		font-size: 26rpx;
		line-height: 1.6;
		margin-top: 8rpx;
	}
</style>
