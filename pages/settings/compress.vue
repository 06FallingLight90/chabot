<template>
	<view class="ss-page" :class="themeClass">
		<view class="ss-tipbar">上下文压缩：长对话自动交给 LLM 压缩为概要，减少后续请求 token 消耗。本页设置更改后自动保存。</view>

		<view class="ss-auto">✔ 更改自动保存</view>

		<view class="ss-card">
			<view class="ss-title">自动压缩间隔</view>
			<view class="ss-row">
				<view class="ss-btns">
					<view
						v-for="o in compressOptions"
						:key="o.value"
						class="ss-btn first"
						:class="{ on: s.compressInterval === o.value }"
						@tap="setInterval(o.value)"
					>{{ o.label }}</view>
				</view>
				<view class="ss-hint">
					累计新增消息达到设定条数后，自动把上文交给 LLM 压缩成概要；历史消息仍完整保留可翻阅，也可在聊天页手动压缩。
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	import { getConversationSettings, saveSettings } from '../../utils/chat.js'

	export default {
		data() {
			return {
				s: getConversationSettings(),
				compressOptions: [
					{ label: '关闭', value: 0 },
					{ label: '20条', value: 20 },
					{ label: '30条', value: 30 },
					{ label: '40条', value: 40 },
					{ label: '60条', value: 60 },
					{ label: '80条', value: 80 }
				]
			}
		},
		onShow() {
			this.s = getConversationSettings()
		},
		methods: {
			setInterval(v) {
				if (this.s.compressInterval === v) return
				this.s.compressInterval = v
				saveSettings(this.s) // 更改后自动保存
				uni.showToast({ title: '已保存（' + (v || '关闭') + '）', icon: 'none' })
			}
		}
	}
</script>