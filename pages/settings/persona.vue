<template>
	<view class="ss-page" :class="themeClass">
		<view class="ss-tipbar">人格配置：选择 AI 扮演的角色，设定情景时间与表情包使用。更改后点击底部「保存设置」生效，仅作用于当前对话。</view>

		<view class="ss-card">
			<view class="ss-title">情景与表情</view>
			<view class="ss-row">
				<view class="ss-row-head">
					<text class="ss-label" style="margin-bottom: 0">情景时间</text>
					<view class="ss-btns">
						<view class="ss-btn first" :class="{ on: s.timeMode === 'real' }" @tap="s.timeMode = 'real'">现实时间</view>
						<view class="ss-btn" :class="{ on: s.timeMode === 'virtual' }" @tap="s.timeMode = 'virtual'">虚拟时间</view>
					</view>
				</view>
				<view class="ss-hint">
					{{ s.timeMode === 'real' ? '会发送当前真实时间，LLM 据此维护现实情景' : '不发送真实时间，情景由 LLM 自由想象（适合角色扮演）' }}
				</view>
			</view>
			<view class="ss-row">
				<view class="ss-row-head">
					<text class="ss-label" style="margin-bottom: 0">聊天表情包</text>
					<view class="ss-btns">
						<view class="ss-btn first" :class="{ on: s.emojiEnabled }" @tap="s.emojiEnabled = true">允许</view>
						<view class="ss-btn" :class="{ on: !s.emojiEnabled }" @tap="s.emojiEnabled = false">禁用</view>
					</view>
				</view>
				<view class="ss-hint">
					允许时请求携带表情清单，LLM 回复可穿插使用你的表情包；禁用后 LLM 不会主动使用（手动插入与渲染不受影响）。
				</view>
			</view>
		</view>

		<view class="ss-card">
			<view class="ss-title">人格选择</view>
			<view
				v-for="p in personalities"
				:key="p.id"
				class="persona"
				:class="{ active: s.personalityId === p.id }"
				@tap="selectPersona(p.id)"
			>
				<view class="persona-head">
					<view class="persona-main">
						<view class="persona-name">{{ p.name }}</view>
						<view class="persona-desc">{{ p.desc }}</view>
					</view>
					<text class="persona-expand" @tap.stop="togglePersonaPrompt(p.id)">
						{{ expandedPromptId === p.id ? '收起提示词' : '查看提示词' }}
					</text>
				</view>
				<view v-if="expandedPromptId === p.id" class="persona-prompt">{{ p.prompt }}</view>
			</view>
			<view
				class="persona"
				:class="{ active: s.personalityId === 'custom' }"
				@tap="selectPersona('custom')"
			>
				<view class="persona-head">
					<view class="persona-main">
						<view class="persona-name">自定义</view>
						<view class="persona-desc">参考下方示例或预设人格的提示词，手写你的专属设定</view>
					</view>
					<text class="persona-expand" @tap.stop="togglePersonaPrompt('__sample__')">
						{{ expandedPromptId === '__sample__' ? '收起示例' : '查看完整示例' }}
					</text>
				</view>
				<view v-if="expandedPromptId === '__sample__'" class="persona-prompt">
					<text>{{ samplePrompt }}</text>
					<view class="prompt-fill" @tap.stop="fillSample">一键填入到下方编辑框</view>
				</view>
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

		<view class="ss-save" @tap="save">保存设置</view>
	</view>
</template>

<script>
	import { getConversationSettings, saveSettings } from '../../utils/chat.js'
	import { PERSONALITIES, CUSTOM_PROMPT_SAMPLE } from '../../utils/prompts.js'
	import { addLog } from '../../utils/log.js'

	export default {
		data() {
			return {
				s: getConversationSettings(),
				personalities: PERSONALITIES,
				expandedPromptId: '',
				samplePrompt: CUSTOM_PROMPT_SAMPLE
			}
		},
		onShow() {
			this.s = getConversationSettings()
		},
		methods: {
			selectPersona(id) {
				this.s.personalityId = id
			},
			togglePersonaPrompt(id) {
				this.expandedPromptId = this.expandedPromptId === id ? '' : id
			},
			fillSample() {
				this.s.customPrompt = CUSTOM_PROMPT_SAMPLE
				uni.showToast({ title: '已填入示例，可在此基础上修改', icon: 'none' })
			},
			save() {
				saveSettings(this.s)
				addLog('info', '保存设置', `人格=${this.s.personalityId} · 时间模式=${this.s.timeMode === 'virtual' ? '虚拟' : '现实'} · 表情包=${this.s.emojiEnabled ? '允许' : '禁用'}`)
				uni.showToast({ title: '已保存', icon: 'success' })
			}
		}
	}
</script>

<style>
	.persona {
		padding: 20rpx 24rpx;
		border-radius: 12rpx;
		background: var(--c-bg);
		margin-bottom: 16rpx;
		border: 2rpx solid transparent;
	}
	.persona.active {
		border-color: var(--c-primary);
		background: var(--c-primary-light);
	}
	.persona-name {
		font-size: 28rpx;
		color: var(--c-text);
		font-weight: 500;
	}
	.persona-desc {
		font-size: 22rpx;
		color: var(--c-text-aid);
		margin-top: 6rpx;
	}
	.persona-head {
		display: flex;
		align-items: flex-start;
	}
	.persona-main {
		flex: 1;
		min-width: 0;
	}
	.persona-expand {
		flex-shrink: 0;
		margin-left: 16rpx;
		padding-top: 4rpx;
		font-size: 22rpx;
		color: var(--c-primary);
	}
	.persona-prompt {
		margin-top: 16rpx;
		padding: 20rpx;
		background: var(--c-bg);
		border-radius: 12rpx;
		border: 1rpx solid var(--c-line);
		font-size: 24rpx;
		color: var(--c-text-secondary);
		line-height: 1.7;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.prompt-fill {
		margin-top: 16rpx;
		display: inline-block;
		font-size: 24rpx;
		color: var(--c-primary);
		border: 1rpx solid var(--c-primary);
		border-radius: 24rpx;
		padding: 8rpx 24rpx;
	}
	.custom-box {
		width: 100%;
		height: 800rpx;
		background: var(--c-bg);
		border-radius: 12rpx;
		padding: 20rpx;
		box-sizing: border-box;
		font-size: 26rpx;
		color: var(--c-text);
		line-height: 1.6;
	}
	.char-count {
		margin-top: 10rpx;
		text-align: right;
		font-size: 22rpx;
		color: var(--c-text-aid);
	}
</style>