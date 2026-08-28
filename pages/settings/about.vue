<template>
	<view class="ss-page" :class="themeClass">
		<view class="ss-card about-card">
			<view class="about-logo">AI 伙伴</view>
			<view class="about-version">版本 {{ version }}（{{ versionCode }}）</view>
			<view class="about-desc">
				一个轻量、纯端侧（无后端、数据保存在本机）的 LLM 人格聊天应用。可通过任意 OpenAI 兼容接口接入你选择的模型，内置多种人格，支持记忆、表情包、情景、拟真聊天与语音阅读。
			</view>
		</view>

		<view class="ss-card">
			<view class="ss-title">基本信息</view>
			<view class="info-row"><text class="info-k">应用名称</text><text class="info-v">AI 伙伴</text></view>
			<view class="info-row"><text class="info-k">版本</text><text class="info-v">{{ version }}</text></view>
			<view class="info-row"><text class="info-k">技术栈</text><text class="info-v">uni-app · Vue 3</text></view>
			<view class="info-row"><text class="info-k">数据存储</text><text class="info-v">端侧本地存储</text></view>
			<view class="info-row"><text class="info-k">接口协议</text><text class="info-v">OpenAI 兼容 /chat/completions</text></view>
		</view>

		<view class="ss-card">
			<view class="ss-title">相关链接</view>
			<view class="info-row" @tap="copyLink(repoUrl)">
				<text class="info-k">GitHub 仓库</text>
				<text class="info-v link">06FallingLight90/chabot ›</text>
			</view>
			<view class="ss-hint" style="padding: 0 6rpx">查看完整代码、Changelog 与开发说明。点击即复制链接。</view>
		</view>

		<view class="ss-card">
			<view class="ss-title">鸣谢</view>
			<view class="thanks">
				<text class="thanks-text">本 App 的「记忆机制」设计灵感与核心算法参考自开源项目</text>
				<view class="info-row" @tap="copyLink(koishiUrl)">
					<text class="info-k">koishi-ai-pet</text>
					<text class="info-v link">Koishi007/koishi-ai-pet ›</text>
				</view>
				<text class="thanks-text">感谢作者 Koishi007 的分享，请支持该作者。</text>
			</view>
		</view>
	</view>
</template>

<script>
	export default {
		data() {
			return {
				version: '1.3.0',
				versionCode: '130',
				repoUrl: 'https://github.com/06FallingLight90/chabot',
				koishiUrl: 'https://github.com/Koishi007/koishi-ai-pet'
			}
		},
		methods: {
			copyLink(url) {
				uni.setClipboardData({
					data: url,
					success: () => {}
				})
			}
		}
	}
</script>

<style>
	.about-card {
		text-align: center;
		padding: 56rpx 40rpx;
	}
	.about-logo {
		font-size: 44rpx;
		font-weight: 700;
		color: var(--c-primary);
	}
	.about-version {
		margin-top: 12rpx;
		font-size: 24rpx;
		color: var(--c-text-aid);
	}
	.about-desc {
		margin-top: 28rpx;
		font-size: 24rpx;
		color: var(--c-text-secondary);
		line-height: 1.7;
		text-align: left;
	}

	.info-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20rpx 6rpx;
		border-bottom: 1rpx solid var(--c-line);
	}
	.info-row:last-child {
		border-bottom: none;
	}
	.info-k {
		font-size: 26rpx;
		color: var(--c-text-secondary);
	}
	.info-v {
		font-size: 26rpx;
		color: var(--c-text);
		text-align: right;
	}
	.info-v.link {
		color: var(--c-primary);
	}
	.thanks {
		padding: 0 6rpx;
	}
	.thanks-text {
		display: block;
		font-size: 24rpx;
		color: var(--c-text-secondary);
		line-height: 1.7;
	}
	.thanks .info-row {
		padding: 16rpx 6rpx;
		margin: 12rpx 0;
		background: var(--c-bg);
		border-radius: 12rpx;
		border-bottom: none;
		padding-left: 20rpx;
		padding-right: 20rpx;
	}
</style>