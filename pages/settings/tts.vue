<template>
	<view class="ss-page" :class="themeClass">
		<view class="ss-tipbar">语音阅读：LLM 新返回的消息在渲染时自动合成语音朗读，表情不朗读、语音不落盘。更改后点击底部「保存设置」生效。</view>

		<view class="ss-card">
			<view class="ss-title">语音阅读</view>
			<view class="ss-row">
				<view class="ss-row-head">
					<text class="ss-label" style="margin-bottom: 0">开关</text>
					<view class="ss-btns">
						<view class="ss-btn first" :class="{ on: s.ttsEnabled }" @tap="s.ttsEnabled = true">开启</view>
						<view class="ss-btn" :class="{ on: !s.ttsEnabled }" @tap="s.ttsEnabled = false">关闭</view>
					</view>
				</view>
				<view class="ss-hint">默认以 Qwen-TTS 为例。开启后需填下面的 API Key 才会朗读。</view>
			</view>
			<view class="ss-field">
				<text class="ss-label">TTS API Key</text>
				<input class="ss-input" v-model="s.ttsApiKey" password placeholder="sk-…" />
			</view>
			<view class="ss-field">
				<text class="ss-label">TTS 模型</text>
				<input class="ss-input" v-model="s.ttsModel" placeholder="qwen3-tts-flash" />
			</view>
			<view class="ss-field">
				<text class="ss-label">音色</text>
				<view class="voice-row">
					<input class="ss-input voice-input" v-model="s.ttsVoice" placeholder="Cherry" />
					<picker mode="selector" :range="ttsVoiceNames" @change="onTtsVoiceChange">
						<view class="voice-pick-btn">从列表选择</view>
					</picker>
				</view>
				<view v-if="ttsVoiceHint" class="ss-hint">{{ ttsVoiceHint }}</view>
				<view class="ss-hint">可手动输入官方列表外的自定义音色；完整音色列表参考官方文档。</view>
			</view>
			<view class="ss-field">
				<view class="tts-test-btn" @tap="doTestTts">测试语音接口</view>
				<view class="ss-hint">按上方当前配置（Key/模型/音色）发送一小段测试文本并尝试播放。</view>
			</view>
		</view>

		<view class="ss-save" @tap="save">保存设置</view>
	</view>
</template>

<script>
	import { getConversationSettings, saveSettings } from '../../utils/chat.js'
	import { TTS_VOICE_NAMES, ttsVoiceDesc, testTts as runTtsTest } from '../../utils/tts.js'
	import { addLog } from '../../utils/log.js'

	export default {
		data() {
			return {
				s: getConversationSettings(),
				ttsVoiceNames: TTS_VOICE_NAMES
			}
		},
		computed: {
			ttsVoiceHint() {
				const desc = ttsVoiceDesc(this.s.ttsVoice)
				return desc ? '「' + this.s.ttsVoice + '」' + desc : ''
			}
		},
		onShow() {
			this.s = getConversationSettings()
		},
		methods: {
			onTtsVoiceChange(e) {
				this.s.ttsVoice = this.ttsVoiceNames[e.detail.value]
			},
			async doTestTts() {
				if (!this.s.ttsApiKey.trim()) {
					uni.showToast({ title: '请先填写 TTS API Key', icon: 'none' })
					return
				}
				uni.showLoading({ title: '测试中' })
				let res = { ok: false, message: '测试失败' }
				try {
					res = await runTtsTest({ apiKey: this.s.ttsApiKey, model: this.s.ttsModel, voice: this.s.ttsVoice })
				} catch (e) {
					res = { ok: false, message: (e && e.message) || '测试失败' }
				} finally {
					uni.hideLoading()
				}
				uni.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
			},
			save() {
				saveSettings(this.s)
				addLog('info', '保存设置', `语音阅读=${this.s.ttsEnabled ? '开(' + (this.s.ttsModel || '') + '/' + (this.s.ttsVoice || '') + ')' : '关'}`)
				uni.showToast({ title: '已保存', icon: 'success' })
			}
		}
	}
</script>

<style>
	.voice-row {
		display: flex;
		align-items: center;
	}
	.voice-input {
		flex: 1;
		min-width: 0;
		margin-right: 16rpx;
	}
	.voice-pick-btn {
		flex-shrink: 0;
		height: 80rpx;
		line-height: 80rpx;
		padding: 0 28rpx;
		font-size: 26rpx;
		color: var(--c-primary);
		background: var(--c-primary-light);
		border-radius: 12rpx;
	}
	.tts-test-btn {
		height: 80rpx;
		line-height: 80rpx;
		text-align: center;
		font-size: 28rpx;
		color: #fff;
		background: var(--c-brand-gradient);
		border-radius: var(--c-radius-md);
		box-shadow: 0 4rpx 12rpx rgba(91, 124, 250, 0.3);
	}
</style>