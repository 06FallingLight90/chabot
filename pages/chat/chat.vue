<template>
	<view class="page" :class="themeClass">
		<chat-header
			:persona-name="personaName"
			:model="model"
			:scene="scene"
			@open-persona="openPersona"
			@open-history="openHistory"
			@new-chat="newChat"
			@clear="confirmClear"
			@open-scene-edit="openSceneEdit"
		/>

		<!-- 点击消息区任意位置收起表情栏（QQ 式交互） -->
		<view class="msg-wrap" @tap="closeEmojiPanel">
			<chat-msg-list
				ref="msgList"
				:messages="messages"
				:loading="loading"
				:persona-name="personaName"
				:bg="bg"
				:emojis="emojis"
				:bubble-opacity="bubbleOpacity"
				@regenerate="doRegenerate"
			/>
		</view>

		<chat-input-bar
			v-model="input"
			:loading="loading"
			:emoji-on="showEmojiPanel"
			@send="send"
			@toggle-emoji="toggleEmojiPanel"
			@focus="onInputFocus"
		/>

		<!-- 自定义底部导航栏 -->
		<custom-tab-bar :active="0" />

		<chat-emoji-panel
			:open="showEmojiPanel"
			:emojis="emojis"
			@insert="onEmojiInsert"
			@change="refreshEmojis"
		/>

		<chat-scene-edit :show="showSceneEdit" :scene="scene" @close="closeSceneEdit" @save="saveScene" />
		<chat-history :show="showHistory" :loading="loading" @close="closeHistory" @changed="onHistoryChanged" />
		<chat-persona :show="showPersona" @close="closePersona" @saved="onPersonaSaved" />
	</view>
</template>

<script>
	import {
		sendMessage,
		getHistoryForUI,
		clearConversation,
		getConversationSettings,
		popLastAssistant,
		startNewConversation
	} from '../../utils/chat.js'
	import { getBackgroundImage, getScene, setScene } from '../../utils/storage.js'
	import { getEmojis } from '../../utils/emojis.js'
	import { speakText, stopSpeaking } from '../../utils/tts.js'
	import { setProactiveSuppressed, catchUpProactive, rearmProactive } from '../../utils/chat-proactive.js'
	import ChatHeader from './components/chat-header.vue'
	import ChatMsgList from './components/chat-msg-list.vue'
	import ChatInputBar from './components/chat-input-bar.vue'
	import ChatEmojiPanel from './components/chat-emoji-panel.vue'
	import ChatSceneEdit from './components/chat-scene-edit.vue'
	import ChatHistory from './components/chat-history.vue'
	import ChatPersona from './components/chat-persona.vue'

	export default {
		components: { ChatHeader, ChatMsgList, ChatInputBar, ChatEmojiPanel, ChatSceneEdit, ChatHistory, ChatPersona },
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
				showHistory: false,
				showPersona: false,    // 会话人格弹窗
				showEmojiPanel: false, // 表情栏展开状态
				emojis: [],            // 全局表情列表（表情栏与消息渲染共用）
				bubbleOpacity: 1,          // 气泡背景不透明度（会话设置，0.2~1）
				pendingClosePanel: false, // 表情栏打开时点了输入框，等键盘弹出后再关闭（非模板字段）
				kbH: 0,                // 键盘高度（px，App/小程序经 onKeyboardHeightChange 监听）
				_unloaded: false,      // 页面卸载标记（非模板字段）
				_kbSupported: false    // 键盘高度监听可用性（非模板字段）
			}
		},
		onShow() {
			// 等待 LLM 响应期间不重载消息列表：刚发送的用户消息尚未落库，
			// 若切到外部页面再切回时重新拉取历史，这条消息会从记录中消失
			if (!this.loading) this.messages = getHistoryForUI()
			this.refreshHeader()
			this.bg = getBackgroundImage()
			this.scene = getScene()
			this.refreshEmojis()
			if (this.$refs.msgList) this.$refs.msgList.resetScrollState()
			// 拟真聊天：回到聊天页立即按当前会话设置重排调度（切会话/切 tab 后响应最新状态）
			catchUpProactive()
		},
		onLoad() {
			// 拟真聊天：接收调度器主动消息送达事件，刷新消息列表（页面在前台时的增量更新）
			if (uni.$on) uni.$on('proactive-burst', this.onProactiveBurst)
			// 监听键盘高度（App / 微信小程序）：表情栏打开时唤起键盘，等键盘弹出
			// （视口已压缩）后再关闭表情栏，输入栏直接从"表情栏上方"落到"键盘上方"，不掉底
			// #ifdef APP-PLUS || MP-WEIXIN
			if (uni.onKeyboardHeightChange) {
				this._kbSupported = true
				uni.onKeyboardHeightChange(this.onKbChange)
			}
			// #endif
			// H5：键盘弹出/收起会触发 window resize，借此让消息列表重新对齐底部，
			// 避免底部消息被键盘/表情栏遮挡
			// #ifdef H5
			this._onWinResize = () => this.scrollBottom()
			window.addEventListener('resize', this._onWinResize)
			// #endif
		},
		onUnload() {
			this._unloaded = true
			stopSpeaking()
			setProactiveSuppressed(false)
			if (uni.$off) uni.$off('proactive-burst', this.onProactiveBurst)
			// #ifdef MP-WEIXIN
			if (uni.offKeyboardHeightChange) uni.offKeyboardHeightChange(this.onKbChange)
			// #endif
			// #ifdef H5
			if (this._onWinResize) window.removeEventListener('resize', this._onWinResize)
			// #endif
		},
		methods: {
			refreshHeader() {
				// 头部展示当前会话的人格（会话快照，非全局设置）
				const s = getConversationSettings()
				this.personaName = s.personaName
				this.model = s.model
				this.bubbleOpacity = s.bubbleOpacity
			},
			// ---- 表情包 ----
			refreshEmojis() {
				this.emojis = getEmojis()
			},
			// ---- 表情栏 / 键盘联动 ----
			toggleEmojiPanel() {
				if (this.showEmojiPanel) {
					this.closeEmojiPanel()
					return
				}
				this.refreshEmojis()
				this.showEmojiPanel = true
				this.hideKeyboard()
				// 表情栏展开动画结束后滚动到底部，让最新消息不被表情栏遮挡
				setTimeout(() => this.scrollBottom(), 300)
			},
			// 收起表情栏：点击消息区 / 点击表情按钮关闭
			closeEmojiPanel() {
				this.showEmojiPanel = false
				this.pendingClosePanel = false
			},
			// 点击输入框唤起键盘：
			// - 表情栏没开：直接输入，无需处理
			// - 表情栏开着：不立即关闭（输入栏会先掉到屏幕底部，键盘弹出前出现被遮挡的瞬间），
			//   等键盘弹出（onKeyboardHeightChange 上报高度、视口已压缩）后再关闭，
			//   输入栏直接从"表情栏上方"落到"键盘上方"
			onInputFocus() {
				if (!this.showEmojiPanel) return
				if (this._kbSupported) {
					this.pendingClosePanel = true
				} else {
					// 兜底：键盘高度监听不可用（如 H5），延迟关闭等键盘弹出
					setTimeout(() => this.closeEmojiPanel(), 300)
				}
			},
			// 键盘高度变化：App/小程序上报后，若等待关闭表情栏则在此关闭；
			// 键盘弹出压缩视口后让消息列表对齐底部，避免底部消息被键盘遮挡
			onKbChange(res) {
				if (this._unloaded) return
				const h = res && res.height ? res.height : 0
				this.kbH = h
				if (h > 0) {
					if (this.pendingClosePanel) {
						this.pendingClosePanel = false
						this.closeEmojiPanel()
					}
					setTimeout(() => this.scrollBottom(), 300)
				}
			},
			hideKeyboard() {
				// #ifdef H5
				if (document && document.activeElement && document.activeElement.blur) document.activeElement.blur()
				// #endif
				// #ifdef APP-PLUS || MP-WEIXIN
				uni.hideKeyboard()
				// #endif
			},
			// 表情面板点击插入：拼入 $表情名$ 占位
			onEmojiInsert(name) {
				this.input += '$' + name + '$'
			},
			scrollBottom() {
				if (this.$refs.msgList) this.$refs.msgList.scrollBottom()
			},
			// ---- 消息发送 ----
			send(text) {
				if (!text || this.loading) return
				this.input = ''
				this.showEmojiPanel = false
				stopSpeaking() // 用户发送新消息时打断上一段语音
				this.messages.push({ role: 'user', content: text })
				this.loading = true
				this.setLoadingState(true)
				this.scrollBottom()
				sendMessage(text)
					.then(({ reply, saved, burst }) => {
						// 拟真模式：回复按换行拆分为多条气泡，逐条展示（与落库行一致）
						if (burst && burst.length) {
							for (const line of burst) this.messages.push({ role: 'assistant', content: line })
						} else {
							this.messages.push({ role: 'assistant', content: reply })
						}
						this.scene = getScene() // LLM 可能更新了当前情景
						if (saved > 0) uni.showToast({ title: '已记住 ' + saved + ' 条', icon: 'none' })
						this.speakReply(reply)
					})
					.catch((e) => {
						this.messages.push({
							role: 'assistant',
							content: '⚠️ ' + (e && e.message ? e.message : '出错了')
						})
					})
					.finally(() => {
						this.loading = false
						this.setLoadingState(false)
						this.scrollBottom()
					})
			},
			// 语音阅读：LLM 新回复渲染时同步合成语音播放（错误提示不朗读；仅当开启且已配置 TTS Key 时生效）
			speakReply(reply) {
				if (!reply || /^\s*⚠️/.test(reply)) return
				const s = getConversationSettings()
				if (!s.ttsEnabled || !s.ttsApiKey) return
				speakText(reply, { apiKey: s.ttsApiKey, model: s.ttsModel, voice: s.ttsVoice })
			},
			doRegenerate() {
				if (this.loading) return
				stopSpeaking() // 重新生成前打断上一段语音
				const lastUser = popLastAssistant()
				if (!lastUser) return
				// popLastAssistant 已从存储移除该请求的整段回复（拟真 burst 为连续多条 assistant 行），
				// 直接按存储重载展示，避免只删最后一条气泡导致 burst 前半段残留
				this.messages = getHistoryForUI()
				this.scene = getScene() // popLastAssistant 已撤回该响应记录的情景，同步展示
				this.input = ''
				this.loading = true
				this.setLoadingState(true)
				// 重发最近一次请求：用户消息已落库，persistUser:false 避免重复记录同一句话
				sendMessage(lastUser, { persistUser: false })
					.then(({ reply, saved, burst }) => {
						if (burst && burst.length) {
							for (const line of burst) this.messages.push({ role: 'assistant', content: line })
						} else {
							this.messages.push({ role: 'assistant', content: reply })
						}
						this.scene = getScene()
						if (saved > 0) uni.showToast({ title: '已记住 ' + saved + ' 条', icon: 'none' })
						this.speakReply(reply)
					})
					.catch((e) => {
						this.messages.push({
							role: 'assistant',
							content: '⚠️ ' + (e && e.message ? e.message : '出错了')
						})
					})
					.finally(() => {
						this.loading = false
						this.setLoadingState(false)
						this.scrollBottom()
					})
			},
			// ---- 拟真聊天 ----
			// 同步页面 loading 状态给调度器：等待 LLM 回复期间不主动打扰
			setLoadingState(v) {
				setProactiveSuppressed(!!v)
			},
			// 调度器主动消息送达 → 重载历史刷新气泡（页面在前台时的增量更新）
			onProactiveBurst() {
				if (this._unloaded || this.loading) return
				this.messages = getHistoryForUI()
				this.scene = getScene()
				this.scrollBottom()
			},
			confirmClear() {
				uni.showModal({
					title: '清空对话',
					content: '确定清空当前聊天记录吗？（记忆不会清除）',
					success: (res) => {
						if (res.confirm) {
							stopSpeaking()
							clearConversation()
							this.messages = []
						}
					}
				})
			},
			// ---- 会话历史 / 新对话（历史弹窗内操作由 chat-history 组件处理，完成后 emit changed） ----
			newChat() {
				if (this.loading) return
				stopSpeaking()
				startNewConversation()
				this.messages = getHistoryForUI()
				this.scene = getScene()
				this.refreshHeader()
				rearmProactive() // 新会话设置可能不同，立即按新会话重排
				uni.showToast({ title: '已开始新对话', icon: 'none' })
			},
			openHistory() {
				this.showHistory = true
			},
			closeHistory() {
				this.showHistory = false
			},
			// 历史弹窗里切换/删除/复制会话后：重载当前会话展示
			onHistoryChanged() {
				stopSpeaking()
				this.messages = getHistoryForUI()
				this.scene = getScene()
				this.refreshHeader()
				rearmProactive() // 切换会话后立即按新会话设置重排
			},
			// ---- 当前情景编辑 ----
			openSceneEdit() {
				this.showSceneEdit = true
			},
			closeSceneEdit() {
				this.showSceneEdit = false
			},
			saveScene(v) {
				setScene(v)
				this.scene = v
				this.showSceneEdit = false
				uni.showToast({ title: v ? '已更新情景' : '已清除情景', icon: 'none' })
			},
			// ---- 会话人格设置（仅作用于当前对话） ----
			openPersona() {
				this.showPersona = true
			},
			closePersona() {
				this.showPersona = false
			},
			onPersonaSaved() {
				this.showPersona = false
				this.refreshHeader()
				uni.showToast({ title: '已切换人格', icon: 'success' })
			}
		}
	}
</script>

<style scoped>
	.page {
		height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--c-bg);
		box-sizing: border-box;
		/* 底部为自绘 tabBar，预留其高度，避免输入栏被遮挡 */
		padding-bottom: calc(var(--ctab-h, 112rpx) + env(safe-area-inset-bottom));
	}

	.msg-wrap {
		flex: 1;
		position: relative;
		overflow: hidden;
	}
</style>
