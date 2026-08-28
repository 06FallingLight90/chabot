<template>
	<view class="ss-page" :class="themeClass">
		<view class="ss-tipbar">拟真聊天：让 AI 更像真人、在随机时间主动给你发消息。更改后点击底部「保存设置」生效。仅「现实时间」模式生效。</view>

		<view class="ss-card">
			<view class="ss-title">拟真聊天</view>
			<view class="ss-row">
				<view class="ss-row-head">
					<text class="ss-label" style="margin-bottom: 0">开关</text>
					<view class="ss-btns">
						<view class="ss-btn first" :class="{ on: s.proactiveEnabled }" @tap="s.proactiveEnabled = true">开启</view>
						<view class="ss-btn" :class="{ on: !s.proactiveEnabled }" @tap="s.proactiveEnabled = false">关闭</view>
					</view>
				</view>
				<view class="ss-hint">开启后 AI 会在随机时间主动发消息（每条 ≤1 句、连续表情 ≤2）；开启本对话的所有回复都按该短消息规则约束。</view>
			</view>
			<view class="ss-row">
				<view class="ss-row-head">
					<text class="ss-label" style="margin-bottom: 0">主动消息时段</text>
					<view class="proactive-window">
						<picker
							mode="time"
							:value="minToTime(s.proactiveStartMin)"
							@change="(e) => s.proactiveStartMin = timeToMin(e.detail.value)"
						>
							<view class="pick-btn">{{ minToTime(s.proactiveStartMin) }}</view>
						</picker>
						<text class="window-sep">—</text>
						<picker
							mode="time"
							:value="minToTime(s.proactiveEndMin)"
							@change="(e) => s.proactiveEndMin = timeToMin(e.detail.value)"
						>
							<view class="pick-btn">{{ minToTime(s.proactiveEndMin) }}</view>
						</picker>
					</view>
				</view>
				<view class="ss-hint">仅在此时间段内 AI 会主动发消息（精确到分钟），其余时间静默。</view>
			</view>
			<view class="ss-row">
				<view class="ss-row-head">
					<text class="ss-label" style="margin-bottom: 0">主动消息频率</text>
					<view class="ss-btns">
						<view class="ss-btn first" :class="{ on: s.proactiveCustomSeconds <= 0 && s.proactiveLevel === 'low' }" @tap="setLevel('low')">低频</view>
						<view class="ss-btn" :class="{ on: s.proactiveCustomSeconds <= 0 && s.proactiveLevel === 'medium' }" @tap="setLevel('medium')">中频</view>
						<view class="ss-btn" :class="{ on: s.proactiveCustomSeconds <= 0 && s.proactiveLevel === 'high' }" @tap="setLevel('high')">高频</view>
						<view class="ss-btn" :class="{ on: s.proactiveCustomSeconds > 0 }" @tap="s.proactiveCustomSeconds = s.proactiveCustomSeconds > 0 ? s.proactiveCustomSeconds : 30">自定义</view>
					</view>
				</view>
				<view class="ss-hint">低频 45~120 分钟｜中频 15~45 分钟｜高频 5~15 分钟。填秒数则固定按该倒计时触发（便于调试）。</view>
				<view class="ss-field">
					<text class="ss-label">自定义倒计时（秒）</text>
					<input class="ss-input" type="number" v-model="s.proactiveCustomSeconds" placeholder="0 = 使用上方档位" />
				</view>
			</view>
			<view class="ss-row">
				<view class="ss-row-head">
					<text class="ss-label" style="margin-bottom: 0">调试</text>
					<view class="ss-btns">
						<view class="ss-btn test" :class="{ disabled: debugging }" @tap="debugProactive">立即发送一条主动消息</view>
					</view>
				</view>
				<view class="ss-hint">忽略时段/间隔，按当前表单配置立即请求模型返回一条主动消息（发送前自动保存设置）。</view>
				<view class="countdown">{{ countdown }}</view>
			</view>
		</view>

		<view class="ss-save" @tap="save">保存设置</view>
	</view>
</template>

<script>
	import { getConversationSettings, saveSettings } from '../../utils/chat.js'
	import { debugProactiveMessage, rearmProactive, getProactiveCountdown } from '../../utils/chat-proactive.js'
	import { addLog } from '../../utils/log.js'

	export default {
		data() {
			return {
				s: getConversationSettings(),
				debugging: false,
				countdown: '',
				_countdownTimer: null
			}
		},
		onShow() {
			this.s = getConversationSettings()
			this.updateCountdown()
			if (this._countdownTimer) clearInterval(this._countdownTimer)
			this._countdownTimer = setInterval(() => this.updateCountdown(), 1000)
		},
		onHide() {
			if (this._countdownTimer) {
				clearInterval(this._countdownTimer)
				this._countdownTimer = null
			}
		},
		methods: {
			setLevel(lv) {
				this.s.proactiveCustomSeconds = 0
				this.s.proactiveLevel = lv
			},
			// 分钟 → "HH:MM"（钳制 0-1439，非法归 0）
			minToTime(min) {
				const m = Math.max(0, Math.min(1439, parseInt(min, 10) || 0))
				const h = Math.floor(m / 60)
				const mm = m % 60
				return (h < 10 ? '0' + h : '' + h) + ':' + (mm < 10 ? '0' + mm : '' + mm)
			},
			// "HH:MM" → 当天第几分钟（0-1439）
			timeToMin(str) {
				const p = String(str || '').split(':')
				const h = parseInt(p[0], 10) || 0
				const mm = parseInt(p[1], 10) || 0
				return Math.max(0, Math.min(1439, h * 60 + mm))
			},
			updateCountdown() {
				const ms = getProactiveCountdown()
				if (ms === null) {
					const s = this.s || getConversationSettings()
					if (!s.proactiveEnabled) this.countdown = '未开启拟真聊天'
					else if (s.timeMode !== 'real') this.countdown = '仅现实时间模式生效'
					else this.countdown = '等待调度'
				} else if (ms === 0) {
					this.countdown = '即将发送主动消息…'
				} else {
					const total = Math.ceil(ms / 1000)
					const h = Math.floor(total / 3600)
					const m = Math.floor((total % 3600) / 60)
					const sec = total % 60
					this.countdown = h > 0
						? `下次主动消息：${h} 小时 ${m} 分`
						: `下次主动消息：${m} 分 ${String(sec).padStart(2, '0')} 秒`
				}
			},
			async debugProactive() {
				if (this.debugging) return
				if (!this.s.apiKey.trim()) {
					uni.showToast({ title: '请填写 API Key', icon: 'none' })
					return
				}
				saveSettings(this.s)
				rearmProactive()
				this.debugging = true
				try {
					const r = await debugProactiveMessage()
					if (r && r.lines && r.lines.length) {
						uni.showToast({ title: '已发送 ' + r.lines.length + ' 条', icon: 'success' })
					} else {
						uni.showToast({ title: '发送被跳过（请求进行中或未配置 API）', icon: 'none' })
					}
				} catch (e) {
					uni.showToast({ title: (e && e.message) || '发送失败', icon: 'none' })
				} finally {
					this.debugging = false
				}
			},
			save() {
				if (!this.s.apiKey.trim()) {
					uni.showToast({ title: '请填写 API Key', icon: 'none' })
					return
				}
				saveSettings(this.s)
				rearmProactive()
				addLog(
					'info',
					'保存设置',
					`拟真=${this.s.proactiveEnabled ? '开(时段' + this.minToTime(this.s.proactiveStartMin) + '-' + this.minToTime(this.s.proactiveEndMin) + ',' + (this.s.proactiveCustomSeconds > 0 ? '自定义' + this.s.proactiveCustomSeconds + '秒' : this.s.proactiveLevel + '档') + ')' : '关'}`
				)
				uni.showToast({ title: '已保存', icon: 'success' })
			}
		}
	}
</script>

<style>
	.proactive-window {
		display: flex;
		align-items: center;
	}
	.pick-btn {
		padding: 8rpx 24rpx;
		border-radius: 12rpx;
		background: var(--c-card);
		border: 1rpx solid var(--c-line);
		font-size: 26rpx;
		color: var(--c-text);
	}
	.window-sep {
		margin: 0 16rpx;
		color: var(--c-text-aid);
		font-size: 26rpx;
	}
	.countdown {
		margin-top: 12rpx;
		color: var(--c-primary);
		font-weight: 600;
		font-size: 24rpx;
	}
</style>