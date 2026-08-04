<template>
	<view class="page">
		<view class="section">
			<view class="sec-title">接口配置</view>
			<view class="providers">
				<view v-for="p in providers" :key="p.id" class="provider" @tap="applyProvider(p)">
					<view class="provider-name">{{ p.name }}</view>
					<view class="provider-model">{{ p.model }}</view>
				</view>
			</view>
			<view class="field">
				<text class="label">接口地址</text>
				<input class="input" v-model="s.baseUrl" placeholder="https://api.openai.com/v1" />
			</view>
			<view class="field">
				<text class="label">API Key</text>
				<input class="input" v-model="s.apiKey" password placeholder="sk-…" />
			</view>
			<view class="field">
				<text class="label">模型</text>
				<input class="input" v-model="s.model" placeholder="gpt-4o-mini" />
			</view>
			<view class="field">
				<text class="label">温度 {{ s.temperature }}</text>
				<slider :value="s.temperature" :min="0" :max="1.2" :step="0.1" activeColor="#5b7cfa" @change="onTemp" />
			</view>
		</view>

		<view class="section">
			<view class="sec-title">人格设定</view>
			<view class="time-mode">
				<view class="time-mode-head">
					<text class="label">情景时间</text>
					<view class="mode-btns">
						<view class="mode-btn" :class="{ on: s.timeMode === 'real' }" @tap="s.timeMode = 'real'">现实时间</view>
						<view class="mode-btn" :class="{ on: s.timeMode === 'virtual' }" @tap="s.timeMode = 'virtual'">虚拟时间</view>
					</view>
				</view>
				<view class="time-mode-hint">
					{{ s.timeMode === 'real' ? '会发送当前真实时间，LLM 据此维护现实情景' : '不发送真实时间，情景由 LLM 自由想象（适合角色扮演）' }}
				</view>
			</view>
			<view
				v-for="p in personalities"
				:key="p.id"
				class="persona"
				:class="{ active: s.personalityId === p.id }"
				@tap="selectPersona(p.id)"
			>
				<view class="persona-name">{{ p.name }}</view>
				<view class="persona-desc">{{ p.desc }}</view>
			</view>
			<view
				class="persona"
				:class="{ active: s.personalityId === 'custom' }"
				@tap="selectPersona('custom')"
			>
				<view class="persona-name">自定义</view>
				<view class="persona-desc">手写你的专属人格提示词</view>
			</view>
			<textarea
				v-if="s.personalityId === 'custom'"
				class="custom-box"
				v-model="s.customPrompt"
				maxlength="5000"
				placeholder="在这里输入完整的人格设定提示词…"
			/>
			<view v-if="s.personalityId === 'custom'" class="char-count">{{ s.customPrompt.length }} / 5000</view>
		</view>

		<button class="save-btn" @tap="save">保存设置</button>

		<view class="section">
			<view class="sec-title">聊天背景</view>
			<view v-if="bg" class="bg-preview" :style="bgStyle">
				<text class="bg-preview-tip">当前背景</text>
			</view>
			<view class="bg-actions">
				<button class="bg-btn primary" @tap="chooseBg">选择图片</button>
				<button v-if="bg" class="bg-btn" @tap="removeBg">移除背景</button>
			</view>
		</view>

		<view class="section">
			<view class="sec-title">数据管理</view>
			<button class="danger-btn" @tap="clearChats">清空对话</button>
			<button class="danger-btn" @tap="clearData">清空记忆与对话</button>
			<view class="hint">小程序端需在公众平台配置 request 合法域名；App 端保持联网即可。</view>
		</view>
	</view>
</template>

<script>
	import { getSettings, saveSettings, clearConversation } from '../../utils/chat.js'
	import { PERSONALITIES, PROVIDERS } from '../../utils/prompts.js'
	import { clearAllData, getBackgroundImage, saveBackgroundImage, removeBackgroundImage } from '../../utils/storage.js'

	export default {
		data() {
			return {
				s: getSettings(),
				personalities: PERSONALITIES,
				providers: PROVIDERS,
				bg: getBackgroundImage()
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
			}
		},
		onShow() {
			this.s = getSettings()
			this.bg = getBackgroundImage()
		},
		methods: {
			applyProvider(p) {
				this.s.baseUrl = p.url
				this.s.model = p.model
			},
			selectPersona(id) {
				this.s.personalityId = id
			},
			onTemp(e) {
				this.s.temperature = e.detail.value
			},
			save() {
				if (!this.s.apiKey.trim()) {
					uni.showToast({ title: '请填写 API Key', icon: 'none' })
					return
				}
				saveSettings(this.s)
				uni.showToast({ title: '已保存', icon: 'success' })
			},
			chooseBg() {
				uni.chooseImage({
					count: 1,
					sizeType: ['compressed'],
					success: async (res) => {
						const tempPath = res.tempFilePaths[0]
						if (!tempPath) return
						uni.showLoading({ title: '处理中' })
						try {
							// App/小程序端压缩降低存储占用（H5 无 compressImage，用原图）
							let path = tempPath
							if (typeof uni.compressImage === 'function') {
								const compressed = await new Promise((r) => {
									uni.compressImage({
										src: tempPath,
										quality: 80,
										success: (x) => r(x.tempFilePath),
										fail: () => r(null)
									})
								})
								if (compressed) path = compressed
							}
							this.bg = await saveBackgroundImage(path)
							uni.showToast({ title: '已设置背景', icon: 'success' })
						} finally {
							uni.hideLoading()
						}
					}
				})
			},
			removeBg() {
				removeBackgroundImage()
				this.bg = ''
				uni.showToast({ title: '已移除背景', icon: 'success' })
			},
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
	.page {
		padding: 20rpx 30rpx calc(40rpx + env(safe-area-inset-bottom));
		background: #f7f8fa;
		min-height: 100vh;
		box-sizing: border-box;
	}

	.section {
		background: #ffffff;
		border-radius: 16rpx;
		padding: 24rpx;
		margin-bottom: 24rpx;
	}

	.sec-title {
		font-size: 28rpx;
		font-weight: 600;
		color: #333;
		margin-bottom: 20rpx;
	}

	.time-mode {
		margin-bottom: 20rpx;
		padding: 20rpx 24rpx;
		border-radius: 12rpx;
		background: #f7f8fa;
	}

	.time-mode-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.mode-btns {
		display: flex;
	}

	.mode-btn {
		padding: 8rpx 22rpx;
		margin-left: 12rpx;
		border-radius: 24rpx;
		border: 1rpx solid #e5e6eb;
		font-size: 24rpx;
		color: #666;
		background: #fff;
	}

	.mode-btn.on {
		background: #5b7cfa;
		border-color: #5b7cfa;
		color: #fff;
	}

	.time-mode-hint {
		margin-top: 12rpx;
		font-size: 22rpx;
		color: #999;
		line-height: 1.5;
	}

	.providers {
		display: flex;
		flex-wrap: wrap;
		margin-bottom: 16rpx;
	}

	.provider {
		padding: 12rpx 24rpx;
		margin: 0 16rpx 16rpx 0;
		border-radius: 30rpx;
		background: #f2f3f5;
	}

	.provider-name {
		font-size: 24rpx;
		color: #333;
	}

	.provider-model {
		font-size: 20rpx;
		color: #999;
		margin-top: 2rpx;
	}

	.field {
		margin-top: 20rpx;
	}

	.label {
		display: block;
		font-size: 24rpx;
		color: #666;
		margin-bottom: 10rpx;
	}

	.input {
		height: 80rpx;
		background: #f2f3f5;
		border-radius: 12rpx;
		padding: 0 24rpx;
		font-size: 28rpx;
	}

	.persona {
		padding: 20rpx 24rpx;
		border-radius: 12rpx;
		background: #f7f8fa;
		margin-bottom: 16rpx;
		border: 2rpx solid transparent;
	}

	.persona.active {
		border-color: #5b7cfa;
		background: #eef1fe;
	}

	.persona-name {
		font-size: 28rpx;
		color: #333;
		font-weight: 500;
	}

	.persona-desc {
		font-size: 22rpx;
		color: #999;
		margin-top: 6rpx;
	}

	.custom-box {
		width: 100%;
		height: 800rpx;
		background: #f2f3f5;
		border-radius: 12rpx;
		padding: 20rpx;
		box-sizing: border-box;
		font-size: 26rpx;
		line-height: 1.6;
	}

	.char-count {
		margin-top: 10rpx;
		text-align: right;
		font-size: 22rpx;
		color: #bbb;
	}

	.bg-preview {
		height: 260rpx;
		border-radius: 12rpx;
		margin-bottom: 20rpx;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		overflow: hidden;
	}

	.bg-preview-tip {
		font-size: 22rpx;
		color: #fff;
		background: rgba(0, 0, 0, 0.35);
		padding: 6rpx 20rpx;
		border-radius: 20rpx;
		margin-bottom: 16rpx;
	}

	.bg-actions {
		display: flex;
	}

	.bg-btn {
		flex: 1;
		height: 76rpx;
		line-height: 76rpx;
		font-size: 26rpx;
		color: #666;
		background: #f2f3f5;
		border-radius: 12rpx;
		margin-right: 16rpx;
	}

	.bg-btn:last-child {
		margin-right: 0;
	}

	.bg-btn.primary {
		color: #fff;
		background: #5b7cfa;
	}

	.save-btn {
		margin: 10rpx 0 30rpx;
		height: 88rpx;
		line-height: 88rpx;
		font-size: 30rpx;
		color: #fff;
		background: #5b7cfa;
		border-radius: 44rpx;
	}

	.danger-btn {
		margin-bottom: 20rpx;
		height: 80rpx;
		line-height: 80rpx;
		font-size: 28rpx;
		color: #f53f3f;
		background: #fff;
		border: 1rpx solid #ffd4d4;
		border-radius: 12rpx;
	}

	.hint {
		font-size: 22rpx;
		color: #bbb;
		line-height: 1.6;
		margin-top: 10rpx;
	}
</style>
