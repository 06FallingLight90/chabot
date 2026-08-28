<template>
	<view class="ss-page" :class="themeClass">
		<view class="ss-tipbar">帮助：了解本 App 的各个功能与使用方法。点击条目展开详情。</view>

		<view class="ss-card">
			<view
				v-for="(item, i) in helps"
				:key="item.title"
				class="help-item"
			>
				<view class="help-head" @tap="toggle(i)">
					<text class="help-title">{{ item.title }}</text>
					<text class="help-arrow">{{ open === i ? '−' : '+' }}</text>
				</view>
				<view v-if="open === i" class="help-body">
					<text class="help-text">{{ item.body }}</text>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	export default {
		data() {
			return {
				open: 0,
				helps: [
					{
						title: '开始一次对话',
						body: '在聊天页底部输入框打字并发送即开始。首次使用请先到「设置 → 接口配置」填好接口地址与 API Key，再回聊天页发消息。'
					},
					{
						title: '记忆如何运作',
						body: 'AI 会在回复中自动沉淀你的核心事实、约定与近期状态，按重要性分级（L1 核心 / L2 约定 / L3 临时）持续衰减维护。可到「记忆」标签页查看、编辑、删除或手动新建记忆，也可多选批量删除。'
					},
					{
						title: '使用表情包',
						body: '到「表情管理」标签页上传图片并逐张命名，聊天时输入框旁的「表情」按钮可插入 $表情名$。开启「人格配置 → 聊天表情包」后，AI 也会在你的表情包清单中挑选使用。'
					},
					{
						title: '情景（Scene）',
						body: '聊天页顶部的情景条会结合当前时间推断「你在做什么」。AI 每次回复都会更新情景；点击情景条可查看、修改或清除，并从下拉历史中快速复用。'
					},
					{
						title: '拟真聊天',
						body: '在「设置 → 拟真聊天」开启后，AI 会在随机时间主动给你发消息（仅现实时间模式、且在当前对话生效），每条 ≤1 句。可设置主动时段与频率，或自定义倒计时调试。'
					},
					{
						title: '语音阅读（TTS）',
						body: '在「设置 → 语音阅读」填入 TTS API Key（默认 Qwen-TTS）并开启后，AI 新回复会自动朗读，表情不朗读、语音不落盘。可用「测试语音接口」验证配置。'
					},
					{
						title: '上下文压缩',
						body: '长对话会自动（或手动）把较早上文交给 LLM 压缩成概要，节省后续请求的 token 消耗；原始消息仍完整保留可翻阅。间隔可在「设置 → 上下文压缩」调整。'
					},
					{
						title: '重新生成与回撤',
						body: 'AI 回复下方有「重新生成」可让 AI 重答；重新生成会撤销上一轮回复及其产生的情景/记忆变化，保留你的提问。'
					},
					{
						title: '多会话管理',
						body: '聊天页头部「历史」可查看、切换、删除会话，或把当前对话复制为副本；「新对话」开始新会话并复制当前设置。每个会话拥有独立的记忆、情景与设置。'
					},
					{
						title: '导出聊天记录',
						body: '在聊天页「历史 → 导出对话为 .txt」可将当前会话导出为文本：H5 下载、App 保存到文档目录、小程序复制全文。'
					},
					{
						title: '排查问题',
						body: '遇到报错或无回复时，到「设置 → 调试日志」查看请求、响应与错误详情，可据此确认接口地址/模型名是否正确，判断返回的是否为流式数据。'
					}
				]
			}
		},
		methods: {
			toggle(i) {
				this.open = this.open === i ? -1 : i
			}
		}
	}
</script>

<style>
	.help-item {
		border-bottom: 1rpx solid var(--c-line);
	}
	.help-item:last-child {
		border-bottom: none;
	}
	.help-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 26rpx 6rpx;
	}
	.help-title {
		font-size: 28rpx;
		color: var(--c-text);
		font-weight: 500;
	}
	.help-arrow {
		font-size: 32rpx;
		color: var(--c-text-aid);
		line-height: 1;
	}
	.help-body {
		padding: 0 6rpx 24rpx;
	}
	.help-text {
		font-size: 24rpx;
		color: var(--c-text-secondary);
		line-height: 1.7;
	}
</style>