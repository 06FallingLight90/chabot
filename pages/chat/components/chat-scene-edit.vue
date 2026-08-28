<template>
	<!-- 情景编辑弹窗 -->
	<view v-if="show" class="mask" @tap="$emit('close')">
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
				<button class="edit-btn cancel" @tap="$emit('close')">取消</button>
				<button class="edit-btn ok" @tap="save">保存</button>
			</view>
		</view>
	</view>
</template>

<script>
	import { getSceneHistory } from '../../../utils/storage.js'

	export default {
		name: 'ChatSceneEdit',
		props: {
			show: { type: Boolean, default: false },
			scene: { type: String, default: '' }
		},
		emits: ['close', 'save'],
		data() {
			return {
				sceneDraft: '',
				sceneHistory: []
			}
		},
		watch: {
			show(v) {
				if (v) {
					this.sceneDraft = this.scene
					this.sceneHistory = getSceneHistory().slice().reverse() // 最新在前
				}
			}
		},
		methods: {
			useSceneHistory(h) {
				this.sceneDraft = h
			},
			save() {
				this.$emit('save', this.sceneDraft.trim())
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

	.edit-panel {
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

	.edit-area {
		width: 100%;
		height: 200rpx;
		background: var(--c-bg);
		color: var(--c-text);
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
		color: var(--c-text-aid);
		margin-bottom: 10rpx;
	}

	.scene-history-list {
		max-height: 300rpx;
	}

	.scene-history-item {
		display: flex;
		align-items: center;
		padding: 14rpx 20rpx;
		background: var(--c-bg);
		border-radius: 10rpx;
		margin-bottom: 12rpx;
	}

	.scene-history-idx {
		flex-shrink: 0;
		width: 40rpx;
		font-size: 22rpx;
		color: var(--c-primary);
	}

	.scene-history-text {
		flex: 1;
		min-width: 0;
		font-size: 24rpx;
		color: var(--c-text-secondary);
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
		color: var(--c-text-secondary);
		background: var(--c-bg);
	}

	.edit-btn.ok {
		color: #fff;
		background: var(--c-primary);
	}
</style>
