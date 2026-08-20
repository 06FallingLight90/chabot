<template>
	<view class="page">
		<view class="section">
			<view class="sec-title">接口配置</view>
			<view class="providers">
				<view v-for="p in providers" :key="p.id" class="provider" @tap="applyProvider(p)">
					<view class="provider-name">{{ p.name }}</view>
					<view class="provider-model">{{ p.model }}</view>
				</view>
			</view>
			<view class="field">
				<text class="label">接口地址</text>
				<input class="input" v-model="s.baseUrl" placeholder="https://api.openai.com/v1" />
			</view>
			<view class="field">
				<text class="label">API Key</text>
				<input class="input" v-model="s.apiKey" password placeholder="sk-…" />
			</view>
			<view class="field">
				<text class="label">模型</text>
				<input class="input" v-model="s.model" placeholder="gpt-5.4-mini" />
			</view>
			<view class="field">
				<text class="label">温度 {{ s.temperature }}</text>
				<slider :value="s.temperature" :min="0" :max="1.2" :step="0.1" activeColor="#5b7cfa" @change="onTemp" />
			</view>
			<view class="time-mode">
				<view class="time-mode-head">
					<text class="label">思考模式</text>
					<view class="mode-btns">
						<view class="mode-btn" :class="{ on: s.reasoningEffort === 'none' }" @tap="s.reasoningEffort = 'none'">关闭</view>
						<view class="mode-btn" :class="{ on: s.reasoningEffort === 'high' }" @tap="s.reasoningEffort = 'high'">开启</view>
						<view class="mode-btn" :class="{ on: s.reasoningEffort === '' }" @tap="s.reasoningEffort = ''">跟随模型</view>
					</view>
				</view>
				<view class="time-mode-hint">
					Ollama 本地思考模型（如 Qwen3）默认思考会占满输出 token 导致回复为空，建议关闭；开启仅对思考型模型生效，其他模型自动忽略。
				</view>
			</view>
			<view class="field">
				<text class="label">最大请求次数（{{ s.maxRequestAttempts }}）</text>
				<input class="input" type="number" v-model.number="s.maxRequestAttempts" placeholder="5" />
				<view class="time-mode-hint">回复格式不合格时自动重新请求的次数上限（1-20，默认 5）；达到上限仍不合格则提示错误，不写入对话与记忆。</view>
			</view>
			<view class="api-presets">
				<view class="presets-head">
					<text class="label">预设配置（最多 3 套）</text>
					<view class="preset-save" @tap="saveAsPreset">保存当前为预设</view>
				</view>
				<view class="preset-slots">
					<view
						v-for="(p, i) in presetSlots"
						:key="i"
						class="preset-slot"
						:class="{ filled: !!p, active: activePreset === i }"
						@tap="applyPreset(i)"
					>
						<text class="preset-name">{{ p ? p.name : '预设' + (i + 1) + '（空）' }}</text>
						<text v-if="p" class="preset-del" @tap.stop="deletePreset(i)">×</text>
					</view>
				</view>
				<view class="presets-hint">点击预设快速填充下方配置，空槽位可点击「保存当前为预设」存入</view>
			</view>
		</view>

		<view class="section">
			<view class="sec-title">人格设定</view>
			<view class="time-mode">
				<view class="time-mode-head">
					<text class="label">情景时间</text>
					<view class="mode-btns">
						<view class="mode-btn" :class="{ on: s.timeMode === 'real' }" @tap="s.timeMode = 'real'">现实时间</view>
						<view class="mode-btn" :class="{ on: s.timeMode === 'virtual' }" @tap="s.timeMode = 'virtual'">虚拟时间</view>
					</view>
				</view>
				<view class="time-mode-hint">
					{{ s.timeMode === 'real' ? '会发送当前真实时间，LLM 据此维护现实情景' : '不发送真实时间，情景由 LLM 自由想象（适合角色扮演）' }}
				</view>
			</view>
			<view class="time-mode">
				<view class="time-mode-head">
					<text class="label">聊天表情包</text>
					<view class="mode-btns">
						<view class="mode-btn" :class="{ on: s.emojiEnabled }" @tap="s.emojiEnabled = true">允许</view>
						<view class="mode-btn" :class="{ on: !s.emojiEnabled }" @tap="s.emojiEnabled = false">禁用</view>
					</view>
				</view>
				<view class="time-mode-hint">
					允许时请求携带表情清单，LLM 回复可在文本中穿插使用你的表情包；禁用后请求不携带清单，LLM 不会主动使用表情包（你仍可手动插入表情）。
				</view>
			</view>
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

		<view class="section">
			<view class="sec-title">上下文压缩</view>
			<view class="time-mode">
				<view class="time-mode-head">
					<text class="label">自动压缩间隔</text>
					<view class="mode-btns">
						<view
							v-for="o in compressOptions"
							:key="o.value"
							class="mode-btn"
							:class="{ on: s.compressInterval === o.value }"
							@tap="s.compressInterval = o.value"
						>{{ o.label }}</view>
					</view>
				</view>
				<view class="time-mode-hint">
					累计新增消息达到设定条数后，自动把上文交给 LLM 压缩成概要，减少后续请求的 token 消耗；历史消息仍完整保留可翻阅，也可在聊天页手动压缩。
				</view>
			</view>
		</view>

		<button class="save-btn" @tap="save">保存设置</button>

		<view class="section">
			<view class="sec-title">聊天背景</view>
			<view v-if="bg" class="bg-preview" :style="bgStyle">
				<text class="bg-preview-tip">当前背景</text>
			</view>
			<view class="bg-actions">
				<button class="bg-btn primary" @tap="chooseBg">选择图片</button>
				<button v-if="bg" class="bg-btn" @tap="removeBg">移除背景</button>
			</view>
		</view>

		<view class="section">
			<view class="sec-title">数据管理</view>
			<button class="danger-btn" @tap="clearChats">清空对话</button>
			<button class="danger-btn" @tap="clearData">清空记忆与对话</button>
			<view class="hint">小程序端需在公众平台配置 request 合法域名；App 端保持联网即可。</view>
		</view>

		<view class="section">
			<view class="sec-title">调试日志</view>
			<view class="log-actions">
				<button class="bg-btn primary" @tap="refreshLogs">刷新</button>
				<button class="bg-btn" @tap="doClearLogs">清空日志</button>
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
	import { getConversationSettings, saveSettings, clearConversation } from '../../utils/chat.js'
	import { PERSONALITIES, PROVIDERS, CUSTOM_PROMPT_SAMPLE } from '../../utils/prompts.js'
	import { clearAllData, getBackgroundImage, saveBackgroundImage, removeBackgroundImage, getApiProfiles, saveApiProfile, deleteApiProfile } from '../../utils/storage.js'
	import { getLogs, clearLogs as clearDebugLogs, addLog } from '../../utils/log.js'

	const TYPE_NAMES = { req: '请求', res: '响应', err: '错误', info: '信息' }

	export default {
		data() {
			return {
				s: getConversationSettings(),
				personalities: PERSONALITIES,
				providers: PROVIDERS,
				bg: getBackgroundImage(),
				logs: getLogs(),
				expandedId: '',
				expandedPromptId: '',  // 当前展开查看提示词/示例的人格 id（空=全部收起）
				samplePrompt: CUSTOM_PROMPT_SAMPLE, // 自定义人格完整设定示例
				presets: getApiProfiles(),
				activePreset: -1,
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
		computed: {
			bgStyle() {
				return this.bg
					? {
							backgroundImage: "url('" + this.bg + "')",
							backgroundSize: 'cover',
							backgroundPosition: 'center',
							backgroundRepeat: 'no-repeat'
					  }
					: {}
			},
			// 固定 3 个槽位，未保存的槽位为 null
			presetSlots() {
				const slots = []
				for (let i = 0; i < 3; i++) slots.push(this.presets[i] || null)
				return slots
			}
		},
		onShow() {
			// 全部设置随当前对话（会话设置快照）显示与保存，切换会话即切换设置
			this.s = getConversationSettings()
			this.bg = getBackgroundImage()
			this.logs = getLogs()
			this.presets = getApiProfiles()
		},
		methods: {
			// ---- 调试日志 ----
			refreshLogs() {
				this.logs = getLogs()
				this.expandedId = ''
			},
			toggleLog(id) {
				this.expandedId = this.expandedId === id ? '' : id
			},
			// 收起状态仅展示预览片段，展开时由模板直接渲染完整 detail
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
			},
			applyProvider(p) {
				this.s.baseUrl = p.url
				this.s.model = p.model
			},
			// ---- API 配置预设 ----
			applyPreset(i) {
				const p = this.presets[i]
				if (!p) return
				this.s.baseUrl = p.baseUrl
				this.s.apiKey = p.apiKey
				this.s.model = p.model
				if (typeof p.temperature === 'number') this.s.temperature = p.temperature
				this.activePreset = i
				uni.showToast({ title: '已应用预设「' + p.name + '」', icon: 'none' })
			},
			// 接口地址匹配到供应商预设时用供应商名做默认名，否则用"预设N"
			defaultPresetName(i) {
				const p = this.providers.find((x) => x.url === this.s.baseUrl)
				return p ? p.name : '预设' + (i + 1)
			},
			saveAsPreset() {
				if (!this.s.apiKey.trim()) {
					uni.showToast({ title: '请先填写 API Key', icon: 'none' })
					return
				}
				const itemList = []
				for (let i = 0; i < 3; i++) {
					const p = this.presets[i]
					itemList.push((p ? '覆盖「' + p.name + '」' : '保存为预设' + (i + 1)) + '（' + (p ? p.model : '空槽') + '）')
				}
				uni.showActionSheet({
					itemList,
					success: (res) => {
						const i = res.tapIndex
						const name = this.presets[i] ? this.presets[i].name : this.defaultPresetName(i)
						saveApiProfile(i, name, {
							baseUrl: this.s.baseUrl,
							apiKey: this.s.apiKey,
							model: this.s.model,
							temperature: this.s.temperature
						})
						this.presets = getApiProfiles()
						this.activePreset = i
						addLog('info', '保存API预设', `预设${i + 1}=${name} · model=${this.s.model}`)
						uni.showToast({ title: '已保存预设' + (i + 1), icon: 'success' })
					}
				})
			},
			deletePreset(i) {
				const p = this.presets[i]
				if (!p) return
				uni.showModal({
					title: '删除预设',
					content: '确定删除「' + p.name + '」吗？',
					success: (res) => {
						if (!res.confirm) return
						deleteApiProfile(i)
						this.presets = getApiProfiles()
						if (this.activePreset === i) this.activePreset = -1
						addLog('info', '删除API预设', p.name)
						uni.showToast({ title: '已删除', icon: 'success' })
					}
				})
			},
			selectPersona(id) {
				this.s.personalityId = id
			},
			// 展开/收起预设人格提示词或自定义示例（id='__sample__' 为示例）
			togglePersonaPrompt(id) {
				this.expandedPromptId = this.expandedPromptId === id ? '' : id
			},
			// 一键把完整示例填入自定义编辑框
			fillSample() {
				this.s.customPrompt = CUSTOM_PROMPT_SAMPLE
				uni.showToast({ title: '已填入示例，可在此基础上修改', icon: 'none' })
			},
			onTemp(e) {
				this.s.temperature = e.detail.value
			},
			save() {
				if (!this.s.apiKey.trim()) {
					uni.showToast({ title: '请填写 API Key', icon: 'none' })
					return
				}
				saveSettings(this.s)
				// saveSettings 写入当前会话的设置快照（含人格/情景时间），仅作用于当前对话
				addLog(
					'info',
					'保存设置',
					`model=${this.s.model} · 人格=${this.s.personalityId} · 温度=${this.s.temperature} · 时间模式=${this.s.timeMode} · 压缩间隔=${this.s.compressInterval} · 最大请求次数=${this.s.maxRequestAttempts}`
				)
				uni.showToast({ title: '已保存', icon: 'success' })
			},
			chooseBg() {
				uni.chooseImage({
					count: 1,
					sizeType: ['compressed'],
					success: async (res) => {
						const tempPath = res.tempFilePaths[0]
						if (!tempPath) return
						uni.showLoading({ title: '处理中' })
						try {
							// App/小程序端压缩降低存储占用（H5 无 compressImage，用原图）
							let path = tempPath
							if (typeof uni.compressImage === 'function') {
								const compressed = await new Promise((r) => {
									uni.compressImage({
										src: tempPath,
										quality: 80,
										success: (x) => r(x.tempFilePath),
										fail: () => r(null)
									})
								})
								if (compressed) path = compressed
							}
							this.bg = await saveBackgroundImage(path)
							uni.showToast({ title: '已设置背景', icon: 'success' })
						} finally {
							uni.hideLoading()
						}
					}
				})
			},
			removeBg() {
				removeBackgroundImage()
				this.bg = ''
				uni.showToast({ title: '已移除背景', icon: 'success' })
			},
			clearChats() {
				uni.showModal({
					title: '清空对话',
					content: '确定清空对话历史吗？',
					success: (res) => {
						if (res.confirm) {
							clearConversation()
							uni.showToast({ title: '已清空', icon: 'success' })
						}
					}
				})
			},
			clearData() {
				uni.showModal({
					title: '清空全部数据',
					content: '将删除所有记忆与对话记录，且不可恢复。确定继续？',
					success: (res) => {
						if (res.confirm) {
							clearAllData()
							uni.showToast({ title: '已清空', icon: 'success' })
						}
					}
				})
			}
		}
	}
</script>

<style>
	.page {
		padding: 20rpx 30rpx calc(40rpx + env(safe-area-inset-bottom));
		background: #f7f8fa;
		min-height: 100vh;
		box-sizing: border-box;
	}

	.section {
		background: #ffffff;
		border-radius: 16rpx;
		padding: 24rpx;
		margin-bottom: 24rpx;
	}

	.sec-title {
		font-size: 28rpx;
		font-weight: 600;
		color: #333;
		margin-bottom: 20rpx;
	}

	.time-mode {
		margin-bottom: 20rpx;
		padding: 20rpx 24rpx;
		border-radius: 12rpx;
		background: #f7f8fa;
	}

	.time-mode-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.mode-btns {
		display: flex;
	}

	.mode-btn {
		padding: 8rpx 22rpx;
		margin-left: 12rpx;
		border-radius: 24rpx;
		border: 1rpx solid #e5e6eb;
		font-size: 24rpx;
		color: #666;
		background: #fff;
	}

	.mode-btn.on {
		background: #5b7cfa;
		border-color: #5b7cfa;
		color: #fff;
	}

	.time-mode-hint {
		margin-top: 12rpx;
		font-size: 22rpx;
		color: #999;
		line-height: 1.5;
	}

	.providers {
		display: flex;
		flex-wrap: wrap;
		margin-bottom: 16rpx;
	}

	.provider {
		padding: 12rpx 24rpx;
		margin: 0 16rpx 16rpx 0;
		border-radius: 30rpx;
		background: #f2f3f5;
	}

	.provider-name {
		font-size: 24rpx;
		color: #333;
	}

	.provider-model {
		font-size: 20rpx;
		color: #999;
		margin-top: 2rpx;
	}

	.api-presets {
		margin-top: 24rpx;
		padding: 20rpx 24rpx;
		border-radius: 12rpx;
		background: #f7f8fa;
	}

	.presets-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.preset-save {
		font-size: 22rpx;
		color: #5b7cfa;
		padding: 6rpx 18rpx;
		border: 1rpx solid #5b7cfa;
		border-radius: 24rpx;
	}

	.preset-slots {
		display: flex;
		flex-wrap: wrap;
		margin-top: 16rpx;
	}

	.preset-slot {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 170rpx;
		padding: 12rpx 16rpx;
		margin: 0 16rpx 12rpx 0;
		border-radius: 12rpx;
		border: 1rpx dashed #d5d7de;
		background: #fff;
	}

	.preset-slot.filled {
		border-style: solid;
		border-color: #e5e6eb;
	}

	.preset-slot.active {
		border-color: #5b7cfa;
		background: #eef1fe;
	}

	.preset-name {
		font-size: 24rpx;
		color: #666;
		max-width: 200rpx;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.preset-slot.filled .preset-name {
		color: #333;
	}

	.preset-del {
		margin-left: 10rpx;
		font-size: 28rpx;
		color: #f53f3f;
		line-height: 1;
		padding: 0 6rpx;
	}

	.presets-hint {
		margin-top: 4rpx;
		font-size: 22rpx;
		color: #999;
		line-height: 1.5;
	}

	.field {
		margin-top: 20rpx;
	}

	.label {
		display: block;
		font-size: 24rpx;
		color: #666;
		margin-bottom: 10rpx;
	}

	.input {
		height: 80rpx;
		background: #f2f3f5;
		border-radius: 12rpx;
		padding: 0 24rpx;
		font-size: 28rpx;
	}

	.persona {
		padding: 20rpx 24rpx;
		border-radius: 12rpx;
		background: #f7f8fa;
		margin-bottom: 16rpx;
		border: 2rpx solid transparent;
	}

	.persona.active {
		border-color: #5b7cfa;
		background: #eef1fe;
	}

	.persona-name {
		font-size: 28rpx;
		color: #333;
		font-weight: 500;
	}

	.persona-desc {
		font-size: 22rpx;
		color: #999;
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
		color: #5b7cfa;
	}

	.persona-prompt {
		margin-top: 16rpx;
		padding: 20rpx;
		background: #fff;
		border-radius: 12rpx;
		border: 1rpx solid #e5e6eb;
		font-size: 24rpx;
		color: #666;
		line-height: 1.7;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.prompt-fill {
		margin-top: 16rpx;
		display: inline-block;
		font-size: 24rpx;
		color: #5b7cfa;
		border: 1rpx solid #5b7cfa;
		border-radius: 24rpx;
		padding: 8rpx 24rpx;
	}

	.custom-box {
		width: 100%;
		height: 800rpx;
		background: #f2f3f5;
		border-radius: 12rpx;
		padding: 20rpx;
		box-sizing: border-box;
		font-size: 26rpx;
		line-height: 1.6;
	}

	.char-count {
		margin-top: 10rpx;
		text-align: right;
		font-size: 22rpx;
		color: #bbb;
	}

	.bg-preview {
		height: 260rpx;
		border-radius: 12rpx;
		margin-bottom: 20rpx;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		overflow: hidden;
	}

	.bg-preview-tip {
		font-size: 22rpx;
		color: #fff;
		background: rgba(0, 0, 0, 0.35);
		padding: 6rpx 20rpx;
		border-radius: 20rpx;
		margin-bottom: 16rpx;
	}

	.bg-actions {
		display: flex;
	}

	.bg-btn {
		flex: 1;
		height: 76rpx;
		line-height: 76rpx;
		font-size: 26rpx;
		color: #666;
		background: #f2f3f5;
		border-radius: 12rpx;
		margin-right: 16rpx;
	}

	.bg-btn:last-child {
		margin-right: 0;
	}

	.bg-btn.primary {
		color: #fff;
		background: #5b7cfa;
	}

	.save-btn {
		margin: 10rpx 0 30rpx;
		height: 88rpx;
		line-height: 88rpx;
		font-size: 30rpx;
		color: #fff;
		background: #5b7cfa;
		border-radius: 44rpx;
	}

	.danger-btn {
		margin-bottom: 20rpx;
		height: 80rpx;
		line-height: 80rpx;
		font-size: 28rpx;
		color: #f53f3f;
		background: #fff;
		border: 1rpx solid #ffd4d4;
		border-radius: 12rpx;
	}

	.hint {
		font-size: 22rpx;
		color: #bbb;
		line-height: 1.6;
		margin-top: 10rpx;
	}

	.log-actions {
		display: flex;
		align-items: center;
		margin-bottom: 20rpx;
	}

	.log-actions .bg-btn {
		flex: none;
		width: 200rpx;
		margin-right: 16rpx;
	}

	.log-count {
		font-size: 22rpx;
		color: #999;
	}

	.log-list {
		height: 620rpx;
		background: #f7f8fa;
		border-radius: 12rpx;
		padding: 8rpx 20rpx;
		box-sizing: border-box;
	}

	.log-empty {
		padding: 80rpx 0;
		text-align: center;
		font-size: 24rpx;
		color: #bbb;
	}

	.log-item {
		padding: 16rpx 0;
		border-bottom: 1rpx solid #f0f0f0;
	}

	.log-item:last-child {
		border-bottom: none;
	}

	.log-item.expanded {
		background: #fff;
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

	.log-badge.t-req {
		background: #5b7cfa;
	}

	.log-badge.t-res {
		background: #00b578;
	}

	.log-badge.t-err {
		background: #f53f3f;
	}

	.log-badge.t-info {
		background: #86909c;
	}

	.log-msg {
		flex: 1;
		min-width: 0;
		font-size: 26rpx;
		color: #333;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.log-time {
		flex-shrink: 0;
		margin-left: 12rpx;
		font-size: 20rpx;
		color: #bbb;
	}

	.log-detail {
		margin-top: 8rpx;
		padding: 12rpx 16rpx;
		background: #fff;
		border-radius: 8rpx;
	}

	.log-detail-text {
		font-size: 22rpx;
		color: #666;
		line-height: 1.5;
		word-break: break-all;
		white-space: pre-wrap;
		-webkit-user-select: text;
		user-select: text;
	}

	.log-toggle {
		display: inline-block;
		margin-top: 8rpx;
		font-size: 22rpx;
		color: #5b7cfa;
	}
</style>
