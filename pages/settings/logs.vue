<template>
	<view class="ss-page" :class="themeClass">
		<view class="ss-card">
			<view class="ss-title">调试日志</view>
			<view class="log-actions">
				<button class="log-btn primary" @tap="refreshLogs">刷新</button>
				<button class="log-btn" @tap="doClearLogs">清空日志</button>
				<text class="log-count">共 {{ logs.length }} 条</text>
			</view>
			<scroll-view scroll-y class="log-list">
				<view v-if="!logs.length" class="log-empty">暂无日志，进行对话或操作后会自动记录</view>
				<view
					v-for="l in logs"
					:key="l.id"
					class="log-item"
					:class="{ expanded: expandedId === l.id }"
					@tap="toggleLog(l.id)"
				>
					<view class="log-head">
						<text class="log-badge" :class="'t-' + l.type">{{ typeName(l.type) }}</text>
						<text class="log-msg">{{ l.msg }}</text>
						<text class="log-time">{{ fmtTime(l.time) }}</text>
					</view>
					<view v-if="l.detail" class="log-detail">
						<text class="log-detail-text">{{ expandedId === l.id ? l.detail : clipDetail(l.detail) }}</text>
						<text class="log-toggle">{{ expandedId === l.id ? '收起' : '展开详情' }}</text>
					</view>
				</view>
			</scroll-view>
		</view>
	</view>
</template>

<script>
	import { getLogs, clearLogs as clearDebugLogs } from '../../utils/log.js'

	const TYPE_NAMES = { req: '请求', res: '响应', err: '错误', info: '信息' }

	export default {
		data() {
			return {
				logs: getLogs(),
				expandedId: ''
			}
		},
		onShow() {
			this.logs = getLogs()
		},
		methods: {
			refreshLogs() {
				this.logs = getLogs()
				this.expandedId = ''
			},
			toggleLog(id) {
				this.expandedId = this.expandedId === id ? '' : id
			},
			clipDetail(d) {
				const t = String(d || '')
				return t.length > 200 ? t.slice(0, 200) + '…' : t
			},
			doClearLogs() {
				uni.showModal({
					title: '清空日志',
					content: '确定清空全部调试日志吗？',
					success: (res) => {
						if (!res.confirm) return
						clearDebugLogs()
						this.logs = []
						this.expandedId = ''
						uni.showToast({ title: '已清空日志', icon: 'success' })
					}
				})
			},
			typeName(t) {
				return TYPE_NAMES[t] || t
			},
			fmtTime(iso) {
				if (!iso) return ''
				const d = new Date(iso)
				if (Number.isNaN(d.getTime())) return ''
				const pad = (n) => String(n).padStart(2, '0')
				return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
			}
		}
	}
</script>

<style>
	.log-actions {
		display: flex;
		align-items: center;
		margin-bottom: 20rpx;
	}
	.log-btn {
		flex: none;
		width: 200rpx;
		height: 76rpx;
		line-height: 76rpx;
		font-size: 26rpx;
		color: var(--c-text-secondary);
		background: var(--c-bg);
		border-radius: 12rpx;
		margin-right: 16rpx;
	}
	.log-btn.primary {
		color: #fff;
		background: var(--c-primary);
	}
	.log-count {
		font-size: 22rpx;
		color: var(--c-text-aid);
	}
	.log-list {
		height: 1000rpx;
		background: var(--c-bg);
		border-radius: 12rpx;
		padding: 8rpx 20rpx;
		box-sizing: border-box;
	}
	.log-empty {
		padding: 80rpx 0;
		text-align: center;
		font-size: 24rpx;
		color: var(--c-text-aid);
	}
	.log-item {
		padding: 16rpx 0;
		border-bottom: 1rpx solid var(--c-line);
	}
	.log-item:last-child {
		border-bottom: none;
	}
	.log-item.expanded {
		background: var(--c-card);
		border-radius: 8rpx;
		padding-left: 12rpx;
		padding-right: 12rpx;
	}
	.log-head {
		display: flex;
		align-items: center;
	}
	.log-badge {
		flex-shrink: 0;
		font-size: 20rpx;
		padding: 2rpx 12rpx;
		border-radius: 16rpx;
		margin-right: 12rpx;
		color: #fff;
	}
	.log-badge.t-req { background: var(--c-primary); }
	.log-badge.t-res { background: #00b578; }
	.log-badge.t-err { background: var(--c-danger); }
	.log-badge.t-info { background: #86909c; }
	.log-msg {
		flex: 1;
		min-width: 0;
		font-size: 26rpx;
		color: var(--c-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.log-time {
		flex-shrink: 0;
		margin-left: 12rpx;
		font-size: 20rpx;
		color: var(--c-text-aid);
	}
	.log-detail {
		margin-top: 8rpx;
		padding: 12rpx 16rpx;
		background: var(--c-bg);
		border-radius: 8rpx;
	}
	.log-detail-text {
		font-size: 22rpx;
		color: var(--c-text-secondary);
		line-height: 1.5;
		word-break: break-all;
		white-space: pre-wrap;
	}
	.log-toggle {
		display: inline-block;
		margin-top: 8rpx;
		font-size: 22rpx;
		color: var(--c-primary);
	}
</style>