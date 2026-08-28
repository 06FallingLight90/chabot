<template>
	<view class="ss-page" :class="themeClass">
		<view class="ss-tipbar">界面外观：包含深色模式、聊天气泡不透明度与聊天背景。更改后点击底部「保存设置」生效（深色模式与背景即时生效）。</view>

		<view class="ss-card">
			<view class="ss-title">深色模式</view>
			<view class="ss-row">
				<view class="ss-row-head">
					<text class="ss-label" style="margin-bottom: 0">切换深色 / 浅色</text>
					<view class="ss-btns">
						<view class="ss-btn first" :class="{ on: __theme === 'light' }" @tap="pickTheme('light')">浅色</view>
						<view class="ss-btn" :class="{ on: __theme === 'dark' }" @tap="pickTheme('dark')">深色</view>
					</view>
				</view>
				<view class="ss-hint">
					{{ __theme === 'dark' ? '当前为深色模式' : '当前为浅色模式' }}，即时生效
				</view>
			</view>
		</view>

		<view class="ss-card">
			<view class="ss-title">聊天气泡</view>
			<view class="ss-row">
				<text class="ss-label">背景不透明度 {{ Math.round((s.bubbleOpacity || 1) * 100) }}%</text>
				<slider :value="s.bubbleOpacity" :min="0.2" :max="1" :step="0.05" activeColor="var(--c-primary)" @change="onBubbleOpacity" />
				<view class="ss-hint">数值越低气泡背景越透明、越能看到下方背景图；文字始终清晰清晰。此设置随对话保存。</view>
			</view>
		</view>

		<view class="ss-card">
			<view class="ss-title">聊天背景</view>
			<view v-if="bg" class="bg-preview" :style="bgStyle">
				<text class="bg-preview-tip">当前背景</text>
			</view>
			<view class="bg-actions">
				<button class="bg-btn primary" @tap="chooseBg">选择图片</button>
				<button v-if="bg" class="bg-btn" @tap="removeBg">移除背景</button>
			</view>
			<view class="ss-hint">选择后即时应用到聊天页并覆盖背景，立即生效、无需保存。</view>
		</view>

		<view class="ss-save" @tap="save">保存设置</view>
	</view>
</template>

<script>
	import { getConversationSettings, saveSettings } from '../../utils/chat.js'
	import { getBackgroundImage, saveBackgroundImage, removeBackgroundImage } from '../../utils/storage.js'
	import { setTheme } from '../../utils/theme.js'
	import { addLog } from '../../utils/log.js'

	export default {
		data() {
			return {
				s: getConversationSettings(),
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
			this.s = getConversationSettings()
			this.bg = getBackgroundImage()
		},
		methods: {
			pickTheme(t) {
				setTheme(t) // 全局即时生效
			},
			onBubbleOpacity(e) {
				this.s.bubbleOpacity = e.detail.value
			},
			save() {
				saveSettings(this.s) // 保存气泡不透明度（随会话快照）
				addLog('info', '保存设置', '界面外观（气泡不透明度）')
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
			}
		}
	}
</script>

<style>
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
		color: var(--c-text-secondary);
		background: var(--c-bg);
		border-radius: 12rpx;
		margin-right: 16rpx;
	}

	.bg-btn:last-child {
		margin-right: 0;
	}

	.bg-btn.primary {
		color: #fff;
		background: var(--c-primary);
	}
</style>