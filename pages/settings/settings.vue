<template>
	<view class="page" :class="themeClass">
		<view class="hero">
			<view class="hero-title">设置</view>
			<view class="hero-sub">每项设置进入对应页面调整，更改后记得保存</view>
		</view>

		<view class="group" v-for="g in groups" :key="g.name">
			<view class="group-name">{{ g.name }}</view>
			<view class="group-card">
				<view
					v-for="item in g.items"
					:key="item.page"
					class="entry"
					@tap="go(item.page)"
				>
					<view class="entry-main">
						<view class="entry-name">
							{{ item.name }}
							<text v-if="item.required && needConfig" class="req">*</text>
							<text v-if="item.tag" class="tag">{{ item.tag }}</text>
						</view>
						<view class="entry-desc">{{ item.desc }}</view>
					</view>
					<text class="entry-arrow">›</text>
				</view>
			</view>
		</view>

	<!-- 自绘底部导航栏（替代原生 tabBar，随主题深浅色切换） -->
	<custom-tab-bar :active="2" />
</view>
</template>

<script>
	import { getConversationSettings } from '../../utils/chat.js'

	export default {
		data() {
			return {
				needConfig: false, // 接口配置缺失（baseUrl/apiKey 未填）时置 true
				groups: [
					{
						name: '常规',
						items: [
							{ page: '/pages/settings/appearance', name: '界面外观', desc: '深色模式、聊天气泡不透明度与聊天背景', tag: '保存' },
							{ page: '/pages/settings/api', name: '接口配置', desc: 'LLM 接口地址 / Key / 模型 / 预设与配置教学', required: true, tag: '保存' },
							{ page: '/pages/settings/persona', name: '人格配置', desc: '人格选择、情景时间、自定义设定', tag: '保存' },
							{ page: '/pages/settings/proactive', name: '拟真聊天', desc: '模拟真人主动发消息的时段与频率', tag: '保存' },
							{ page: '/pages/settings/tts', name: '语音阅读', desc: '回复自动朗读的 TTS 接口与音色', tag: '保存' }
						]
					},
					{
						name: '对话与性能',
						items: [
							{ page: '/pages/settings/compress', name: '上下文压缩', desc: '长对话自动压缩为概要，节省 token', tag: '自动保存' }
						]
					},
					{
						name: '数据与调试',
						items: [
							{ page: '/pages/settings/data', name: '数据管理', desc: '清空对话 / 清空记忆与全部数据' },
							{ page: '/pages/settings/logs', name: '调试日志', desc: '查看请求、响应、错误与操作记录' }
						]
					},
					{
						name: '关于',
						items: [
							{ page: '/pages/settings/help', name: '帮助', desc: '各功能介绍与使用方法' },
							{ page: '/pages/settings/about', name: '关于', desc: 'App 版本与技术信息' }
						]
					}
				]
			}
		},
		onShow() {
			// 接口配置为必要项：任一缺失（地址或 Key 为空）即显示红色 * 提示
			const s = getConversationSettings()
			this.needConfig = !(s.baseUrl && s.baseUrl.trim() && s.apiKey && s.apiKey.trim())
		},
		methods: {
			go(page) {
				uni.navigateTo({ url: page })
			}
		}
	}
</script>

<style>
	.page {
		padding: 20rpx 30rpx calc(var(--ctab-h, 100rpx) + env(safe-area-inset-bottom) + 40rpx);
		background: var(--c-bg);
		min-height: 100vh;
		box-sizing: border-box;
	}

	.hero {
		padding: 20rpx 6rpx 28rpx;
	}
	.hero-title {
		font-size: 44rpx;
		font-weight: 700;
		color: var(--c-text);
	}
	.hero-sub {
		margin-top: 8rpx;
		font-size: 24rpx;
		color: var(--c-text-aid);
	}

	.group {
		margin-bottom: 24rpx;
	}
	.group-name {
		font-size: 24rpx;
		color: var(--c-text-aid);
		margin: 0 6rpx 12rpx;
	}
	.group-card {
		background: var(--c-card);
		border-radius: var(--c-radius-lg);
		box-shadow: var(--c-shadow-card);
		overflow: hidden;
		border: 1rpx solid transparent;
	}

	.entry {
		display: flex;
		align-items: center;
		padding: 26rpx 28rpx;
		border-bottom: 1rpx solid var(--c-line);
	}
	.entry:last-child {
		border-bottom: none;
	}
	.entry-name {
		font-size: 28rpx;
		color: var(--c-text);
		font-weight: 500;
		display: flex;
		align-items: center;
	}
	.entry-name .req {
		color: var(--c-danger);
		margin-left: 6rpx;
		font-weight: 700;
	}
	.entry-name .tag {
		margin-left: 12rpx;
		font-size: 20rpx;
		color: var(--c-text-aid);
		font-weight: 400;
		border: 1rpx solid var(--c-line);
		border-radius: 20rpx;
		padding: 2rpx 12rpx;
	}
	.entry-desc {
		margin-top: 6rpx;
		font-size: 22rpx;
		color: var(--c-text-aid);
		line-height: 1.5;
	}
	.entry-arrow {
		margin-left: 16rpx;
		font-size: 40rpx;
		color: var(--c-text-aid);
		line-height: 1;
	}
</style>