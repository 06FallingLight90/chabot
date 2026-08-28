<template>
	<!-- 会话人格设置弹窗 -->
	<view v-if="show" class="mask" @tap="$emit('close')">
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
					<view class="persona-item-head">
						<view class="persona-item-main">
							<view class="persona-item-name">{{ p.name }}</view>
							<view class="persona-item-desc">{{ p.desc }}</view>
						</view>
						<text class="persona-item-expand" @tap.stop="togglePersonaPrompt(p.id)">
							{{ personaExpandedId === p.id ? '收起提示词' : '查看提示词' }}
						</text>
					</view>
					<view v-if="personaExpandedId === p.id" class="persona-item-prompt">{{ p.prompt }}</view>
				</view>
				<view
					class="persona-item"
					:class="{ active: personaDraftId === 'custom' }"
					@tap="pickPersona('custom')"
				>
					<view class="persona-item-head">
						<view class="persona-item-main">
							<view class="persona-item-name">自定义</view>
							<view class="persona-item-desc">手写专属人格提示词</view>
						</view>
						<text class="persona-item-expand" @tap.stop="togglePersonaPrompt('__sample__')">
							{{ personaExpandedId === '__sample__' ? '收起示例' : '查看完整示例' }}
						</text>
					</view>
					<view v-if="personaExpandedId === '__sample__'" class="persona-item-prompt">
						<text>{{ samplePrompt }}</text>
						<view class="prompt-fill" @tap.stop="fillSample">填入此示例</view>
					</view>
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
				<button class="edit-btn cancel" @tap="$emit('close')">取消</button>
				<button class="edit-btn ok" @tap="savePersona">保存</button>
			</view>
		</view>
	</view>
</template>

<script>
	import { getConversationSettings, saveConversationPersonality } from '../../../utils/chat.js'
	import { PERSONALITIES, CUSTOM_PROMPT_SAMPLE } from '../../../utils/prompts.js'

	export default {
		name: 'ChatPersona',
		props: {
			show: { type: Boolean, default: false }
		},
		emits: ['close', 'saved'],
		data() {
			return {
				personalities: PERSONALITIES,
				personaDraftId: '',      // 弹窗中选择的人格 id
				personaDraftPrompt: '',  // 自定义人格提示词草稿
				personaExpandedId: '',   // 弹窗中当前展开查看提示词/示例的人格 id
				samplePrompt: CUSTOM_PROMPT_SAMPLE // 自定义人格完整设定示例
			}
		},
		watch: {
			show(v) {
				if (v) {
					const s = getConversationSettings()
					this.personaDraftId = s.personalityId
					this.personaDraftPrompt = s.customPrompt || ''
					this.personaExpandedId = ''
				}
			}
		},
		methods: {
			pickPersona(id) {
				this.personaDraftId = id
			},
			// 弹窗中展开/收起预设人格提示词或自定义示例
			togglePersonaPrompt(id) {
				this.personaExpandedId = this.personaExpandedId === id ? '' : id
			},
			// 一键把完整示例填入自定义提示词编辑框
			fillSample() {
				this.personaDraftPrompt = CUSTOM_PROMPT_SAMPLE
				uni.showToast({ title: '已填入示例，可在此基础上修改', icon: 'none' })
			},
			savePersona() {
				if (this.personaDraftId === 'custom' && !this.personaDraftPrompt.trim()) {
					uni.showToast({ title: '请填写自定义人格提示词', icon: 'none' })
					return
				}
				saveConversationPersonality(this.personaDraftId, this.personaDraftPrompt)
				this.$emit('saved')
			}
		}
	}
</script>

<style scoped>
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

	.persona-panel {
		width: 640rpx;
		background: var(--c-card);
		border-radius: 20rpx;
		padding: 32rpx;
		box-sizing: border-box;
	}

	.edit-title {
		font-size: 32rpx;
		font-weight: 600;
		color: var(--c-text);
		text-align: center;
		margin-bottom: 24rpx;
	}

	.persona-hint {
		font-size: 22rpx;
		color: var(--c-text-aid);
		text-align: center;
		margin-bottom: 20rpx;
	}

	.persona-list {
		height: 480rpx;
	}

	.persona-item {
		padding: 18rpx 24rpx;
		border-radius: 12rpx;
		background: var(--c-bg);
		margin-bottom: 16rpx;
		border: 2rpx solid transparent;
	}

	.persona-item.active {
		border-color: var(--c-primary);
		background: var(--c-primary-light);
	}

	.persona-item-name {
		font-size: 28rpx;
		color: var(--c-text);
		font-weight: 500;
	}

	.persona-item-desc {
		font-size: 22rpx;
		color: var(--c-text-aid);
		margin-top: 4rpx;
	}

	.persona-item-head {
		display: flex;
		align-items: flex-start;
	}

	.persona-item-main {
		flex: 1;
		min-width: 0;
	}

	.persona-item-expand {
		flex-shrink: 0;
		margin-left: 16rpx;
		padding-top: 2rpx;
		font-size: 22rpx;
		color: var(--c-primary);
	}

	.persona-item-prompt {
		margin-top: 14rpx;
		padding: 16rpx;
		background: var(--c-card);
		border-radius: 10rpx;
		border: 1rpx solid var(--c-line);
		font-size: 22rpx;
		color: var(--c-text-secondary);
		line-height: 1.7;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.prompt-fill {
		margin-top: 14rpx;
		display: inline-block;
		font-size: 22rpx;
		color: var(--c-primary);
		border: 1rpx solid var(--c-primary);
		border-radius: 22rpx;
		padding: 6rpx 20rpx;
	}

	.persona-custom {
		width: 100%;
		height: 260rpx;
		background: var(--c-bg);
		color: var(--c-text);
		border-radius: 12rpx;
		padding: 20rpx;
		box-sizing: border-box;
		font-size: 26rpx;
		line-height: 1.6;
		margin-top: 8rpx;
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
		color: var(--c-text-secondary);
		background: var(--c-bg);
	}

	.edit-btn.ok {
		color: #fff;
		background: var(--c-primary);
	}
</style>
