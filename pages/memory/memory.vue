<template>
	<view class="page" :class="themeClass">
		<view class="hero">
			<view class="hero-title">记忆</view>
			<view class="hero-sub">{{ convTitle }}</view>
		</view>

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
			<view class="toolbar-right">
				<view class="count">共 {{ memories.length }} 条</view>
				<view class="tool-btn accent" @tap="openNew">＋ 新建</view>
				<view class="tool-btn" :class="{ on: multiMode }" @tap="toggleMulti">{{ multiMode ? '取消' : '多选' }}</view>
			</view>
		</view>

		<scroll-view scroll-y class="list">
			<view v-if="!memories.length" class="empty">
				<text class="empty-emoji">🧠</text>
				<text class="empty-text">暂无记忆</text>
				<text class="empty-hint">LLM 会在对话中为你沉淀核心事实</text>
			</view>
			<view v-for="m in memories" :key="m.id" class="card" :class="{ selected: isSelected(m.id) }" @tap="multiMode && toggleSelect(m.id)">
				<view class="card-head">
					<view v-if="multiMode" class="check" :class="{ on: isSelected(m.id) }"></view>
					<text class="badge" :class="'lv-' + m.level">{{ m.level }}</text>
					<text class="cat">{{ m.category }}</text>
					<text class="stars">
						{{ '★'.repeat(m.importance) }}<text class="dim">{{ '☆'.repeat(5 - m.importance) }}</text>
					</text>
					<text class="time">{{ fmtTime(m.created_at) }}</text>
					<text v-if="!multiMode" class="edit" @tap.stop="openEdit(m)">编辑</text>
					<text v-if="!multiMode" class="del" @tap.stop="remove(m.id)">删除</text>
				</view>
				<view class="card-content">{{ m.content }}</view>
				<view v-if="m.keywords" class="card-kw"># {{ m.keywords.split(',').join('  # ') }}</view>
			</view>
		</scroll-view>

		<!-- 多选删除操作栏 -->
		<view v-if="multiMode" class="multi-bar">
			<text class="multi-count">已选 {{ selectedIds.length }} 条</text>
			<view class="multi-all" @tap="selectAll">{{ isAllSelected ? '取消全选' : '全选' }}</view>
			<button class="multi-del" :disabled="!selectedIds.length" @tap="removeSelected">删除所选</button>
		</view>

		<!-- 编辑/新建记忆弹窗 -->
		<view v-if="showEdit" class="mask" @tap="closeEdit">
			<view class="edit-panel" @tap.stop>
				<view class="edit-title">{{ editingId === null ? '新建记忆' : '编辑记忆' }}</view>
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

	<!-- 自绘底部导航栏（替代原生 tabBar，随主题深浅色切换） -->
	<custom-tab-bar :active="1" />
</view>
</template>

<script>
	import { memoryStore, maybeMaintenance } from '../../utils/chat.js'
	import { getConversations, getActiveConversationId } from '../../utils/storage.js'

	export default {
		data() {
			return {
				level: '',
				memories: [],
				convTitle: '', // 当前会话标题（记忆按会话独立存储）
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
				editingId: null, // null=新建，非 null=编辑对应记忆
				editLevel: 'L2',
				editContent: '',
				editImportance: 3,
				multiMode: false,     // 多选删除模式
				selectedIds: []       // 多选模式下勾选的记忆 id
			}
		},
		computed: {
			// 当前筛选结果是否全部选中
			isAllSelected() {
				return this.memories.length > 0 && this.selectedIds.length === this.memories.length
			}
		},
		onShow() {
			// 进入记忆页前先执行节流维护，保证列表反映最新清理结果
			maybeMaintenance()
			this.load()
			const active = getConversations().find((c) => c.id === getActiveConversationId())
			this.convTitle = active ? active.title : ''
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
				return memoryStore.formatTime(iso)
			},
			openEdit(m) {
				this.editingId = m.id
				this.editLevel = m.level
				this.editContent = m.content
				this.editImportance = m.importance
				this.showEdit = true
			},
			openNew() {
				this.editingId = null
				this.editLevel = 'L2'
				this.editContent = ''
				this.editImportance = 3
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
				if (this.editingId === null) {
					memoryStore.addMemory(content, importance, level)
					uni.showToast({ title: '已新建', icon: 'success' })
				} else {
					memoryStore.updateMemory(this.editingId, { content, importance, level })
					uni.showToast({ title: '已保存', icon: 'success' })
				}
				this.showEdit = false
				this.load()
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
			},
			// ---- 多选删除 ----
			toggleMulti() {
				this.multiMode = !this.multiMode
				this.selectedIds = []
			},
			isSelected(id) {
				return this.selectedIds.includes(id)
			},
			toggleSelect(id) {
				const i = this.selectedIds.indexOf(id)
				if (i >= 0) this.selectedIds.splice(i, 1)
				else this.selectedIds.push(id)
			},
			selectAll() {
				this.selectedIds = this.isAllSelected ? [] : this.memories.map((m) => m.id)
			},
			removeSelected() {
				if (!this.selectedIds.length) return
				uni.showModal({
					title: '删除记忆',
					content: `确定删除选中的 ${this.selectedIds.length} 条记忆吗？`,
					success: (res) => {
						if (!res.confirm) return
						memoryStore.deleteMemories(this.selectedIds)
						this.selectedIds = []
						this.multiMode = false
						this.load()
						uni.showToast({ title: '已删除', icon: 'success' })
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
		background: var(--c-bg);
		box-sizing: border-box;
		/* 底部为自绘 tabBar，预留其高度（含安全区），避免列表/多选栏被遮挡 */
		padding-bottom: calc(var(--ctab-h, 100rpx) + env(safe-area-inset-bottom));
	}

	.hero {
		padding: 40rpx 40rpx 8rpx;
	}
	.hero-title {
		font-size: 44rpx;
		font-weight: 700;
		color: var(--c-text);
		line-height: 1.3;
	}
	.hero-sub {
		margin-top: 8rpx;
		font-size: 24rpx;
		color: var(--c-text-aid);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.toolbar {
		padding: 24rpx 40rpx 8rpx;
	}

	/* 筛选按钮独占整行、四等分：无论如何缩放都横排，white-space:nowrap 保证不内部断字 */
	.chips {
		display: flex;
		align-items: stretch;
		width: 100%;
		box-sizing: border-box;
	}

	.chip {
		flex: 1;
		min-width: 0;
		text-align: center;
		white-space: nowrap; /* 关键：单个"名词"永不拆行 */
		padding: 14rpx 8rpx;
		margin-right: 12rpx;
		font-size: 26rpx;
		border-radius: var(--c-radius-full);
		background: var(--c-card);
		color: var(--c-text-secondary);
		border: 1rpx solid var(--c-line);
		transition: background 0.2s, color 0.2s;
	}

	.chip:last-child {
		margin-right: 0;
	}

	.chip.active {
		background: var(--c-primary);
		color: #fff;
		border-color: var(--c-primary);
		box-shadow: 0 4rpx 12rpx rgba(91, 124, 250, 0.3);
	}

	.count {
		font-size: 24rpx;
		color: var(--c-text-aid);
	}

	.toolbar-right {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		width: 100%;
		margin-top: 20rpx;
	}

	.tool-btn {
		margin-left: 16rpx;
		padding: 8rpx 24rpx;
		border-radius: var(--c-radius-full);
		font-size: 24rpx;
		color: var(--c-primary);
		background: var(--c-primary-light);
	}

	.tool-btn.accent {
		color: #fff;
		background: var(--c-brand-gradient);
		font-weight: 600;
		box-shadow: 0 4rpx 12rpx rgba(91, 124, 250, 0.3);
	}

	.tool-btn.on {
		color: #fff;
		background: var(--c-danger);
	}

	.list {
		flex: 1;
		padding: 16rpx 40rpx 40rpx;
		box-sizing: border-box;
	}

	.empty {
		margin-top: 160rpx;
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.empty-emoji { font-size: 88rpx; }
	.empty-text { margin-top: 24rpx; font-size: 28rpx; color: var(--c-text-secondary); }
	.empty-hint { margin-top: 8rpx; font-size: 24rpx; color: var(--c-text-aid); }

	.card {
		background: var(--c-card);
		border-radius: var(--c-radius-lg);
		padding: 28rpx;
		margin-bottom: 24rpx;
		box-shadow: var(--c-shadow-card);
		border: 1rpx solid transparent;
	}

	.card.selected {
		border-color: var(--c-primary);
		background: linear-gradient(135deg, var(--c-primary-light) 0%, var(--c-card) 100%);
	}

	.check {
		width: 36rpx;
		height: 36rpx;
		border-radius: 50%;
		border: 2rpx solid var(--c-line);
		margin-right: 16rpx;
		flex-shrink: 0;
		box-sizing: border-box;
	}

	.check.on {
		border-color: var(--c-primary);
		background: var(--c-primary);
		position: relative;
	}

	.check.on::after {
		content: '';
		position: absolute;
		left: 10rpx;
		top: 5rpx;
		width: 10rpx;
		height: 18rpx;
		border: solid #fff;
		border-width: 0 3rpx 3rpx 0;
		transform: rotate(45deg);
	}

	.card-head {
		display: flex;
		align-items: center;
	}

	.badge {
		font-size: 20rpx;
		padding: 4rpx 14rpx;
		border-radius: var(--c-radius-sm);
		color: #fff;
		font-weight: 600;
	}

	.lv-L1 { background: var(--c-l1); }
	.lv-L2 { background: var(--c-l2); }
	.lv-L3 { background: var(--c-l3); }

	.cat {
		margin-left: 14rpx;
		font-size: 22rpx;
		color: var(--c-primary);
		background: var(--c-primary-light);
		padding: 4rpx 12rpx;
		border-radius: var(--c-radius-sm);
	}

	.stars {
		margin-left: 14rpx;
		font-size: 24rpx;
		color: var(--c-warning);
	}

	.stars .dim {
		color: var(--c-line);
	}

	.time {
		flex: 1;
		text-align: right;
		font-size: 22rpx;
		color: var(--c-text-aid);
	}

	.del {
		margin-left: 12rpx;
		font-size: 22rpx;
		color: var(--c-danger);
		padding: 4rpx 8rpx;
	}

	.edit {
		margin-left: 12rpx;
		font-size: 22rpx;
		color: var(--c-primary);
		padding: 4rpx 8rpx;
	}

	.card-content {
		margin-top: 16rpx;
		font-size: 28rpx;
		color: var(--c-text);
		line-height: 1.6;
	}

	.card-kw {
		margin-top: 12rpx;
		font-size: 22rpx;
		color: var(--c-text-aid);
	}

	.mask {
		position: fixed;
		left: 0;
		top: 0;
		right: 0;
		bottom: 0;
		background: rgba(15, 18, 29, 0.45);
		z-index: 999;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.edit-panel {
		width: 640rpx;
		background: var(--c-card);
		border-radius: var(--c-radius-lg);
		padding: 36rpx;
		box-sizing: border-box;
		box-shadow: var(--c-shadow-card);
	}

	.edit-title {
		font-size: 32rpx;
		font-weight: 600;
		color: var(--c-text);
		text-align: center;
		margin-bottom: 28rpx;
	}

	.edit-area {
		width: 100%;
		height: 200rpx;
		background: var(--c-bg);
		border-radius: var(--c-radius-md);
		padding: 20rpx;
		box-sizing: border-box;
		font-size: 28rpx;
		line-height: 1.5;
		color: var(--c-text);
	}

	.edit-priority {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 28rpx;
	}

	.edit-label {
		font-size: 26rpx;
		color: var(--c-text-secondary);
	}

	.prio-stars {
		display: flex;
	}

	.prio-star {
		font-size: 48rpx;
		color: var(--c-line);
		padding: 0 6rpx;
		transition: color 0.15s, transform 0.15s;
	}

	.prio-star.on {
		color: var(--c-warning);
		transform: scale(1.05);
	}

	.edit-level {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 28rpx;
	}

	.level-btns {
		display: flex;
	}

	.level-btn {
		padding: 8rpx 22rpx;
		margin-left: 12rpx;
		border-radius: var(--c-radius-full);
		border: 1rpx solid var(--c-line);
		font-size: 24rpx;
		color: var(--c-text-secondary);
		background: var(--c-bg);
	}

	.level-btn.on {
		background: var(--c-primary);
		border-color: var(--c-primary);
		color: #fff;
		box-shadow: 0 4rpx 12rpx rgba(91, 124, 250, 0.3);
	}

	.edit-btns {
		display: flex;
		margin-top: 36rpx;
	}

	.edit-btn {
		flex: 1;
		height: 80rpx;
		line-height: 80rpx;
		font-size: 28rpx;
		border-radius: var(--c-radius-full);
		margin: 0 10rpx;
	}

	.edit-btn.cancel {
		color: var(--c-text-secondary);
		background: var(--c-bg);
	}

	.edit-btn.ok {
		color: #fff;
		background: var(--c-brand-gradient);
		box-shadow: 0 4rpx 12rpx rgba(91, 124, 250, 0.3);
	}

	.multi-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16rpx 40rpx calc(16rpx + env(safe-area-inset-bottom));
		background: var(--c-card);
		border-top: 1rpx solid var(--c-line);
	}

	.multi-count {
		font-size: 26rpx;
		color: var(--c-text);
	}

	.multi-all {
		font-size: 26rpx;
		color: var(--c-primary);
		padding: 8rpx 16rpx;
	}

	.multi-del {
		width: 240rpx;
		height: 76rpx;
		line-height: 76rpx;
		font-size: 28rpx;
		color: #fff;
		background: var(--c-brand-gradient);
		border-radius: var(--c-radius-full);
		box-shadow: 0 4rpx 12rpx rgba(240, 66, 75, 0.3);
	}

	.multi-del[disabled] {
		background: var(--c-danger-light);
		color: #fff;
	}
</style>