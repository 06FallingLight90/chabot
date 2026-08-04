<template>
	<view class="page">
		<view class="toolbar">
			<view class="chips">
				<view
					v-for="f in filters"
					:key="f.value"
					class="chip"
					:class="{ active: level === f.value }"
					@tap="setLevel(f.value)"
				>
					{{ f.label }}
				</view>
			</view>
			<view class="count">共 {{ memories.length }} 条</view>
		</view>

		<scroll-view scroll-y class="list">
			<view v-if="!memories.length" class="empty">暂无记忆</view>
			<view v-for="m in memories" :key="m.id" class="card">
				<view class="card-head">
					<text class="badge" :class="'lv-' + m.level">{{ m.level }}</text>
					<text class="cat">{{ m.category }}</text>
					<text class="stars">
						{{ '★'.repeat(m.importance) }}<text class="dim">{{ '☆'.repeat(5 - m.importance) }}</text>
					</text>
					<text class="time">{{ fmtTime(m.created_at) }}</text>
					<text class="edit" @tap="openEdit(m)">编辑</text>
					<text class="del" @tap="remove(m.id)">删除</text>
				</view>
				<view class="card-content">{{ m.content }}</view>
				<view v-if="m.keywords" class="card-kw"># {{ m.keywords.split(',').join('  # ') }}</view>
			</view>
		</scroll-view>

		<!-- 编辑记忆弹窗 -->
		<view v-if="showEdit" class="mask" @tap="closeEdit">
			<view class="edit-panel" @tap.stop>
				<view class="edit-title">编辑记忆</view>
				<textarea class="edit-area" v-model="editContent" placeholder="记忆内容…" />
				<view class="edit-priority">
					<text class="edit-label">优先级</text>
					<view class="prio-stars">
						<text
							v-for="n in 5"
							:key="n"
							class="prio-star"
							:class="{ on: n <= editImportance }"
							@tap="editImportance = n"
						>★</text>
					</view>
				</view>
				<view class="edit-level">
					<text class="edit-label">级别</text>
					<view class="level-btns">
						<view
							v-for="l in levelOptions"
							:key="l.value"
							class="level-btn"
							:class="{ on: editLevel === l.value }"
							@tap="editLevel = l.value"
						>{{ l.label }}</view>
					</view>
				</view>
				<view class="edit-btns">
					<button class="edit-btn cancel" @tap="closeEdit">取消</button>
					<button class="edit-btn ok" @tap="saveEdit">保存</button>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	import { memoryStore, maybeMaintenance } from '../../utils/chat.js'
	import { formatMemoryTime } from '../../utils/memory.js'

	export default {
		data() {
			return {
				level: '',
				memories: [],
				filters: [
					{ label: '全部', value: '' },
					{ label: 'L1 核心', value: 'L1' },
					{ label: 'L2 情景', value: 'L2' },
					{ label: 'L3 临时', value: 'L3' }
				],
				levelOptions: [
					{ label: 'L1 核心', value: 'L1' },
					{ label: 'L2 情景', value: 'L2' },
					{ label: 'L3 临时', value: 'L3' }
				],
				showEdit: false,
				editingId: null,
				editLevel: 'L2',
				editContent: '',
				editImportance: 3
			}
		},
		onShow() {
			// 进入记忆页前先执行节流维护，保证列表反映最新清理结果
			maybeMaintenance()
			this.load()
		},
		methods: {
			load() {
				this.memories = memoryStore.listMemories({ level: this.level })
			},
			setLevel(v) {
				this.level = v
				this.load()
			},
			fmtTime(iso) {
				return formatMemoryTime(iso)
			},
			openEdit(m) {
				this.editingId = m.id
				this.editLevel = m.level
				this.editContent = m.content
				this.editImportance = m.importance
				this.showEdit = true
			},
			closeEdit() {
				this.showEdit = false
			},
			saveEdit() {
				const content = this.editContent.trim()
				if (!content) {
					uni.showToast({ title: '内容不能为空', icon: 'none' })
					return
				}
				// 级别-优先级一致性兜底：L1 至少 3，L3 不超过 4
				let importance = this.editImportance
				let level = this.editLevel
				if (level === 'L1' && importance < 3) importance = 3
				if (level === 'L3' && importance > 4) importance = 4
				memoryStore.updateMemory(this.editingId, { content, importance, level })
				this.showEdit = false
				this.load()
				uni.showToast({ title: '已保存', icon: 'success' })
			},
			remove(id) {
				uni.showModal({
					title: '删除记忆',
					content: '确定删除这条记忆吗？',
					success: (res) => {
						if (res.confirm) {
							memoryStore.deleteMemories([id])
							this.load()
						}
					}
				})
			}
		}
	}
</script>

<style>
	.page {
		height: 100vh;
		display: flex;
		flex-direction: column;
		background: #f7f8fa;
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20rpx 30rpx;
	}

	.chips {
		display: flex;
	}

	.chip {
		padding: 10rpx 24rpx;
		margin-right: 16rpx;
		border-radius: 30rpx;
		background: #ffffff;
		font-size: 24rpx;
		color: #666;
		border: 1rpx solid #e5e6eb;
	}

	.chip.active {
		background: #5b7cfa;
		color: #fff;
		border-color: #5b7cfa;
	}

	.count {
		font-size: 24rpx;
		color: #999;
	}

	.list {
		flex: 1;
		padding: 0 30rpx;
		box-sizing: border-box;
	}

	.empty {
		margin-top: 200rpx;
		text-align: center;
		color: #bbb;
		font-size: 26rpx;
	}

	.card {
		background: #ffffff;
		border-radius: 16rpx;
		padding: 24rpx;
		margin-bottom: 20rpx;
		box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);
	}

	.card-head {
		display: flex;
		align-items: center;
	}

	.badge {
		font-size: 20rpx;
		padding: 4rpx 12rpx;
		border-radius: 8rpx;
		color: #fff;
	}

	.lv-L1 {
		background: #f53f3f;
	}

	.lv-L2 {
		background: #ff9f0a;
	}

	.lv-L3 {
		background: #bfbfbf;
	}

	.cat {
		margin-left: 14rpx;
		font-size: 22rpx;
		color: #5b7cfa;
		background: #eef1fe;
		padding: 4rpx 12rpx;
		border-radius: 8rpx;
	}

	.stars {
		margin-left: 14rpx;
		font-size: 24rpx;
		color: #ff9500;
	}

	.stars .dim {
		color: #e5e6eb;
	}

	.time {
		flex: 1;
		text-align: right;
		font-size: 22rpx;
		color: #bbb;
	}

	.del {
		margin-left: 12rpx;
		font-size: 22rpx;
		color: #f53f3f;
		padding: 4rpx 8rpx;
	}

	.edit {
		margin-left: 12rpx;
		font-size: 22rpx;
		color: #5b7cfa;
		padding: 4rpx 8rpx;
	}

	.card-content {
		margin-top: 16rpx;
		font-size: 28rpx;
		color: #333;
		line-height: 1.6;
	}

	.card-kw {
		margin-top: 12rpx;
		font-size: 22rpx;
		color: #999;
	}

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
		background: #fff;
		border-radius: 20rpx;
		padding: 32rpx;
		box-sizing: border-box;
	}

	.edit-title {
		font-size: 32rpx;
		font-weight: 600;
		color: #333;
		text-align: center;
		margin-bottom: 24rpx;
	}

	.edit-area {
		width: 100%;
		height: 200rpx;
		background: #f7f8fa;
		border-radius: 12rpx;
		padding: 20rpx;
		box-sizing: border-box;
		font-size: 28rpx;
		line-height: 1.5;
	}

	.edit-priority {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 24rpx;
	}

	.edit-label {
		font-size: 26rpx;
		color: #666;
	}

	.prio-stars {
		display: flex;
	}

	.prio-star {
		font-size: 48rpx;
		color: #e5e6eb;
		padding: 0 6rpx;
	}

	.prio-star.on {
		color: #ff9500;
	}

	.edit-level {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 24rpx;
	}

	.level-btns {
		display: flex;
	}

	.level-btn {
		padding: 8rpx 22rpx;
		margin-left: 12rpx;
		border-radius: 24rpx;
		border: 1rpx solid #e5e6eb;
		font-size: 24rpx;
		color: #666;
		background: #f7f8fa;
	}

	.level-btn.on {
		background: #5b7cfa;
		border-color: #5b7cfa;
		color: #fff;
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
		color: #666;
		background: #f2f3f5;
	}

	.edit-btn.ok {
		color: #fff;
		background: #5b7cfa;
	}
</style>
