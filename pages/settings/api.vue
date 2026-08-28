<template>
	<view class="ss-page" :class="themeClass">
		<view class="ss-card">
			<view class="ss-title">必要配置 <text v-if="missingConfig" class="req">*</text></view>
			<view class="provider-btns">
				<view v-for="p in providers" :key="p.id" class="provider" :class="{ on: s.baseUrl === p.url }" @tap="applyProvider(p)">
					<view class="provider-name">{{ p.name }}</view>
					<view class="provider-model">{{ p.model }}</view>
				</view>
			</view>
			<view class="ss-hint">已接入的常用接口，点击可快速填入地址与模型名（Key 需自己填）。</view>

			<view class="ss-field">
				<text class="ss-label">接口地址</text>
				<input class="ss-input" v-model="s.baseUrl" placeholder="https://api.openai.com/v1" />
			</view>
			<view class="ss-field">
				<text class="ss-label">API Key</text>
				<input class="ss-input" v-model="s.apiKey" password placeholder="sk-…" />
			</view>
			<view class="ss-field">
				<text class="ss-label">模型</text>
				<input class="ss-input" v-model="s.model" placeholder="gpt-5.4-mini" />
			</view>
			<view class="ss-field">
				<text class="ss-label">温度 {{ s.temperature }}</text>
				<slider :value="s.temperature" :min="0" :max="1.2" :step="0.1" activeColor="var(--c-primary)" @change="onTemp" />
			</view>
			<view class="ss-hint" v-if="missingConfig">接口配置未完成：请至少填写「接口地址」与「API Key」后保存，即可开始对话。</view>
		</view>

		<view class="ss-card">
			<view class="ss-title">高级</view>
			<view class="ss-row">
				<view class="ss-row-head">
					<text class="ss-label" style="margin-bottom: 0">思考模式</text>
					<view class="ss-btns">
						<view class="ss-btn first" :class="{ on: s.reasoningEffort === 'none' }" @tap="s.reasoningEffort = 'none'">关闭</view>
						<view class="ss-btn" :class="{ on: s.reasoningEffort === 'high' }" @tap="s.reasoningEffort = 'high'">开启</view>
						<view class="ss-btn" :class="{ on: s.reasoningEffort === '' }" @tap="s.reasoningEffort = ''">跟随模型</view>
					</view>
				</view>
				<view class="ss-hint">Ollama 本地思考模型（如 Qwen3）默认思考会占满输出 token 导致回复为空，建议关闭；开启仅对思考型模型生效。</view>
			</view>
			<view class="ss-field">
				<text class="ss-label">最大请求次数（{{ s.maxRequestAttempts }}）</text>
				<input class="ss-input" type="number" v-model.number="s.maxRequestAttempts" placeholder="5" />
				<view class="ss-hint">回复格式不合格时自动重新请求的次数上限（1-20，默认 5）。</view>
			</view>
		</view>

		<view class="ss-card">
			<view class="ss-title">预设配置（最多 3 套）</view>
			<view class="ss-row">
				<view class="ss-row-head">
					<text class="ss-label" style="margin-bottom: 0">快速填充 / 保存当前为预设</text>
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
				<view class="ss-hint">点击预设快速填充下方配置，空槽位可点「保存当前为预设」存入。</view>
			</view>
		</view>

		<view class="ss-card">
			<view class="ss-title">免费额度模型推荐</view>
			<view class="free-tip">预算有限？以下服务注册即送免费体验额度（或可完全免费），点一下自动填好「接口地址 + 模型」，再到官网申请 API Key 补上即可。Ollama 本地模型完全免费、无需 Key。</view>
			<view
				v-for="r in freeRecs"
				:key="r.id"
				class="free-item"
				:class="{ on: s.baseUrl === r.url }"
				@tap="applyFree(r)"
			>
				<view class="free-main">
					<view class="free-name">{{ r.name }}</view>
					<view class="free-desc">{{ r.desc }}</view>
				</view>
				<text class="free-btn">{{ s.baseUrl === r.url ? '已选中' : '选用' }}</text>
			</view>
		</view>

		<view class="ss-card">
			<view class="ss-title">配置教学</view>
			<view class="teach-btn" @tap="showTutorial = true">查看傻瓜式配置教程</view>
			<view class="ss-hint">完全没接触过？点击查看一步步的图片式图文教程，照着做就行。</view>
		</view>

		<view class="ss-save" @tap="save">保存设置</view>

		<!-- 配置教学弹窗 -->
		<view v-if="showTutorial" class="mask" @tap="showTutorial = false">
			<view class="tutorial" @tap.stop>
				<view class="tutorial-title">接口配置教学</view>
				<scroll-view scroll-y class="tutorial-scroll">
					<view class="t-step" v-for="(s, i) in tutorialSteps" :key="i">
						<view class="t-step-title">{{ i + 1 }}. {{ s.title }}</view>
						<text class="t-step-body">{{ s.body }}</text>
					</view>
				</scroll-view>
				<view class="tutorial-close" @tap="showTutorial = false">我知道了</view>
			</view>
		</view>
	</view>
</template>

<script>
	import { getConversationSettings, saveSettings } from '../../utils/chat.js'
	import { PROVIDERS } from '../../utils/prompts.js'
	import { getApiProfiles, saveApiProfile, deleteApiProfile } from '../../utils/storage.js'
	import { addLog } from '../../utils/log.js'

	export default {
		data() {
			return {
				s: getConversationSettings(),
				providers: PROVIDERS,
				presets: getApiProfiles(),
				activePreset: -1,
				showTutorial: false,
				freeRecs: [
					{
						id: 'qwen',
						name: '通义千问（Qwen）',
						desc: '阿里云：新用户注册送 100 万 tokens 体验额度，够聊很久',
						url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
						model: 'qwen-flash'
					},
					{
						id: 'deepseek',
						name: 'DeepSeek',
						desc: '新用户充值前有赠送额度、价格便宜，Flash 模型不易被触发限流',
						url: 'https://api.deepseek.com/v1',
						model: 'deepseek-v4-flash'
					},
					{
						id: 'kimi',
						name: 'Kimi（月之暗面）',
						desc: '注册免费体验，长上下文能力强',
						url: 'https://api.moonshot.cn/v1',
						model: 'kimi-k3'
					},
					{
						id: 'zhipu',
						name: '智谱 GLM',
						desc: '注册送体验 token，Flash 系列便宜且速度快',
						url: 'https://open.bigmodel.cn/api/paas/v4',
						model: 'glm-4.7-flash'
					},
					{
						id: 'ollama',
						name: 'Ollama（本地，最省）',
						desc: '完全免费、完全离线、无需 Key；但需要一台能跑得动的电脑',
						url: 'http://localhost:11434/v1',
						model: 'llama3.3'
					}
				],
				tutorialSteps: [
					{
						title: '先弄明白三样东西',
						body: '想要让 AI 回话，只需要三样：接口地址、API Key、模型名。它们就像「快递收货地址、取件码、要寄的包裹类型」。上面「免费额度模型推荐」已经帮你把地址和模型名填好，你只需要申请一个 Key 就行。'
					},
					{
						title: '没有 Key？先去申请一个',
						body: '在「免费额度模型推荐」里点你喜欢的服务（比如通义千问 Qwen），它会自动填好接口地址和模型名。然后打开该服务的官网（阿里云百炼 / DeepSeek / Moonshot 等）注册账号，在「API Key」页面创建一个密钥（一般是一串 sk- 开头的字符），复制下来。'
					},
					{
						title: '把 Key 粘贴进来',
						body: '回到本页，在「API Key」这一栏长按粘贴刚才复制的密钥。注意别带多余空格，结尾回车也不要。Ollama 本地模型不用填 Key。'
					},
					{
						title: '发现特别省钱的方式',
						body: '如果电脑配置够好，用「Ollama（本地）」最合适：完全免费、离线可用、不用注册。需要先在电脑安装 Ollama 并下载一个模型，然后把接口地址里的 localhost 换成你电脑的局域网 IP（见下条）。'
					},
					{
						title: '手机连电脑上的 Ollama',
						body: '① 在你电脑上设置环境变量 OLLAMA_HOST=0.0.0.0 后重启 Ollama；② 打开 Windows 防火墙，放行 11434 端口；③ 手机和电脑连同一个 Wi-Fi，把接口地址改成 http://<电脑IP>:11434/v1（电脑 IP 在系统设置里查，形如 192.168.x.x）。'
					},
					{
						title: '保存并开始聊天',
						body: '点页面最下面的「保存设置」，回到聊天页随便发一句话，AI 就会回你。还不行？去「设置 → 调试日志」看红字错误，复制那几行给朋友或复制到搜索引擎就行，大多数问题都是「Key 填错」或「模型名填错」。'
					}
				]
			}
		},
		computed: {
			missingConfig() {
				return !(this.s.baseUrl && this.s.baseUrl.trim() && this.s.apiKey && this.s.apiKey.trim())
			},
			presetSlots() {
				const slots = []
				for (let i = 0; i < 3; i++) slots.push(this.presets[i] || null)
				return slots
			}
		},
		onShow() {
			this.s = getConversationSettings()
			this.presets = getApiProfiles()
		},
		methods: {
			onTemp(e) {
				this.s.temperature = e.detail.value
			},
			applyFree(r) {
				this.s.baseUrl = r.url
				this.s.model = r.model
				uni.showToast({ title: '已填入「' + r.name + '」，请补充 API Key', icon: 'none' })
			},
			applyProvider(p) {
				this.s.baseUrl = p.url
				this.s.model = p.model
			},
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
			save() {
				if (!this.s.apiKey.trim()) {
					uni.showToast({ title: '请填写 API Key', icon: 'none' })
					return
				}
				saveSettings(this.s)
				addLog(
					'info',
					'保存设置',
					`model=${this.s.model} · 温度=${this.s.temperature} · 思考模式=${this.s.reasoningEffort === 'none' ? '关' : (this.s.reasoningEffort === 'high' ? '开' : '跟随模型')} · 最大请求次数=${this.s.maxRequestAttempts}`
				)
				uni.showToast({ title: '已保存', icon: 'success' })
			}
		}
	}
</script>

<style>
	.provider-btns {
		display: flex;
		flex-wrap: wrap;
		margin-bottom: 16rpx;
	}

	.provider {
		padding: 12rpx 24rpx;
		margin: 0 16rpx 16rpx 0;
		border-radius: 30rpx;
		background: var(--c-bg);
		border: 2rpx solid transparent;
	}
	.provider.on {
		border-color: var(--c-primary);
		background: var(--c-primary-light);
	}
	.provider-name {
		font-size: 24rpx;
		color: var(--c-text);
	}
	.provider-model {
		font-size: 20rpx;
		color: var(--c-text-aid);
		margin-top: 2rpx;
	}

	.preset-save {
		flex-shrink: 0;
		font-size: 22rpx;
		color: var(--c-primary);
		padding: 6rpx 18rpx;
		border: 1rpx solid var(--c-primary);
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
		border: 1rpx dashed var(--c-line);
		background: var(--c-card);
	}
	.preset-slot.filled {
		border-style: solid;
		border-color: var(--c-line);
	}
	.preset-slot.active {
		border-color: var(--c-primary);
		background: var(--c-primary-light);
	}
	.preset-name {
		font-size: 24rpx;
		color: var(--c-text-secondary);
		max-width: 200rpx;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.preset-slot.filled .preset-name {
		color: var(--c-text);
	}
	.preset-del {
		margin-left: 10rpx;
		font-size: 28rpx;
		color: var(--c-danger);
		line-height: 1;
		padding: 0 6rpx;
	}

	.teach-btn {
		height: 80rpx;
		line-height: 80rpx;
		text-align: center;
		font-size: 28rpx;
		color: var(--c-primary);
		background: var(--c-primary-light);
		border-radius: 12rpx;
	}

	.free-tip {
		font-size: 22rpx;
		color: var(--c-text-aid);
		line-height: 1.6;
		margin-bottom: 16rpx;
	}
	.free-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20rpx 24rpx;
		border-radius: 12rpx;
		background: var(--c-bg);
		margin-bottom: 16rpx;
		border: 2rpx solid transparent;
	}
	.free-item:last-child {
		margin-bottom: 0;
	}
	.free-item.on {
		border-color: var(--c-primary);
		background: var(--c-primary-light);
	}
	.free-main {
		flex: 1;
		min-width: 0;
		margin-right: 16rpx;
	}
	.free-name {
		font-size: 28rpx;
		color: var(--c-text);
		font-weight: 500;
	}
	.free-desc {
		font-size: 22rpx;
		color: var(--c-text-aid);
		margin-top: 6rpx;
		line-height: 1.5;
	}
	.free-btn {
		flex-shrink: 0;
		font-size: 24rpx;
		color: var(--c-primary);
		border: 1rpx solid var(--c-primary);
		border-radius: 26rpx;
		padding: 8rpx 26rpx;
	}
	.free-item.on .free-btn {
		color: #fff;
		background: var(--c-primary);
	}

	/* 配置教学弹窗 */
	.mask {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		z-index: 999;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.tutorial {
		width: 640rpx;
		max-height: 80vh;
		background: var(--c-card);
		border-radius: 24rpx;
		padding: 32rpx;
		display: flex;
		flex-direction: column;
	}
	.tutorial-title {
		font-size: 32rpx;
		font-weight: 600;
		color: var(--c-text);
		margin-bottom: 20rpx;
	}
	.tutorial-scroll {
		flex: 1;
		min-height: 0;
		max-height: 60vh;
	}
	.t-step {
		margin-bottom: 24rpx;
	}
	.t-step-title {
		font-size: 26rpx;
		color: var(--c-primary);
		font-weight: 600;
		margin-bottom: 6rpx;
	}
	.t-step-body {
		font-size: 24rpx;
		color: var(--c-text-secondary);
		line-height: 1.7;
	}
	.tutorial-close {
		margin-top: 20rpx;
		height: 80rpx;
		line-height: 80rpx;
		text-align: center;
		font-size: 28rpx;
		color: #fff;
		background: var(--c-brand-gradient);
		border-radius: 999rpx;
	}
</style>