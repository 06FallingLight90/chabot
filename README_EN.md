# AI Buddy (AI 伙伴)

A lightweight LLM persona chat app built with **uni-app (Vue 3)**. **No backend, fully on-device** — it calls any **OpenAI-compatible** `/chat/completions` endpoint (including **Ollama** local models) and runs across **App / H5 / WeChat Mini Program**.

Memory system inspiration: <https://github.com/Koishi007/koishi-ai-pet>

## ✨ Features

- **Persona chat**: 4 built-in personas (Gentle Big Sister / Energetic Junior / Koishi / Tsundere Catgirl) plus fully custom persona prompts; **each conversation has its own independent persona** — switch conversations to switch personas
- **Memory system**: three tiers — L1 core facts / L2 situational memory (agreements & TODO list) / L3 temporary info; the LLM writes `Memory:` lines automatically, with **add / modify / delete** support, importance grading, half-life decay, and automatic recall & maintenance
- **Scene tracking**: the LLM maintains the current scene each reply (`Scene:` line), with **real-time / virtual-time** modes; scene history is viewable and editable
- **Context compression**: compress older context into a concise summary via the LLM; subsequent requests send only "summary + uncompressed tail" to cut token usage dramatically. Automatic (by message interval) or manual
- **Multi-conversation history**: memories / personas / scenes / summaries stored per conversation; create, switch, delete, and **duplicate a conversation or its memories** into a new one
- **Debug logs**: full request JSON, responses, errors and key operations, expandable to full content, clearable in one tap
- **API profiles**: up to **3 saved API presets** for quick switching; a **Thinking Mode** toggle fixes "empty reply" issues with Ollama reasoning models such as Qwen3 (`reasoning_effort`)
- **Memory management**: filter / create / edit content, priority & level / **multi-select batch delete**
- **Export chat**: one-tap export of the current conversation to `.txt` (download on H5, save to app documents on App, copy to clipboard on Mini Program)
- **Message voice reading (TTS)**: optional; new LLM replies are synthesized and played automatically on render (Qwen-TTS by default; API key / model / voice configurable). Only text is read — emoji placeholders are skipped; audio is never saved to disk and is destroyed after one playback; a one-tap interface test is available in Settings
- **Chat UX**: chat background image, jump-to-bottom button, side slider for quick scrolling, regenerate last AI reply

## 🛠 Tech Stack

- uni-app + Vue 3 (Options API), rpx responsive units
- No third-party npm dependencies; `package.json` is only used for `npm test` (Node environment mocks `uni` to validate core logic)
- All data persisted via `uni.setStorageSync` — reliable across platforms, survives restarts

## 🚀 Getting Started

1. Install [HBuilderX](https://www.dcloud.io/hbuilderx.html)
2. Import this project: File → Import → From Local Directory
3. Run to your target platform (Browser / Android / iOS simulator or device / WeChat DevTools)
4. Open **Settings** and fill in the API configuration:
   - **Base URL**: e.g. `https://api.openai.com/v1` (any OpenAI-compatible service works: DeepSeek, Zhipu GLM, Qwen, Kimi, etc.)
   - **API Key**, **Model**, **Temperature**
   - Tap a provider chip to fill in quickly, or save the current config as an **API preset** (up to 3) for one-tap switching

### Connecting to a Local Ollama Model

1. Start Ollama on your PC with `OLLAMA_HOST=0.0.0.0` (listen on LAN) and allow port `11434` in the firewall
2. Pick the "Ollama (Local)" preset and change the base URL to `http://<PC LAN IP>:11434/v1`
3. Set the model to the exact name from `ollama list`; the API Key can be anything
4. If the model has a thinking mode (e.g. Qwen3), set **Thinking Mode** to **Off** so reasoning tokens don't fill the output and leave the reply empty

See [CLAUDE.md](CLAUDE.md) for details.

## 📁 Directory Structure

```
├── App.vue                # Storage init + memory maintenance on launch
├── pages.json             # Page registration + tabBar (Chat / Memory / Settings)
├── pages/
│   ├── chat/
│   │   ├── chat.vue          # Chat page skeleton (holds session state, coordinates children)
│   │   └── components/       # header / msg-list / input-bar / emoji-panel / scene-edit / history / persona
│   ├── memory/memory.vue  # Memory page (filter / create / edit / multi-select delete)
│   └── settings/settings.vue  # Settings (API / presets / thinking mode / persona / background / logs)
├── utils/
│   ├── storage.js         # Cross-platform persistence (conversations / scenes / API presets / bg image)
│   ├── memory.js          # Memory core (L1/L2/L3, dedup, layered retrieval, maintenance)
│   ├── prompts.js         # System prompt builder + persona / provider presets
│   ├── chat.js            # Chat orchestration facade + send pipeline (single public entry)
│   ├── chat-state.js      # Shared chat state (memoryStore singleton / last request cache)
│   ├── chat-settings.js   # Settings domain (global defaults + per-conversation snapshot)
│   ├── chat-conversations.js # Conversation domain (create/switch/delete/copy + history)
│   ├── chat-compress.js   # Context compression domain
│   ├── llm.js             # OpenAI-compatible LLM client (streaming & thinking control, logging)
│   ├── tts.js             # TTS voice reading (Qwen-TTS synthesis + playback + interface test)
│   ├── log.js             # Debug log ring buffer
│   └── export.js          # Chat export
└── scripts/test-memory.mjs  # Core logic assertions (npm test)
```

## 🧪 Testing

```bash
npm test
```

Runs in Node with a mocked `uni` store, covering memory parsing, dedup & merge, recall cooldown, retrieval injection, conversation management, context compression, debug logs, API presets, thinking mode, per-conversation personas, export text and more — 110+ assertions.

## 📄 Docs

- [CLAUDE.md](CLAUDE.md) — architecture, development conventions, platform differences & Ollama setup
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — changelog

## ⚠️ Platform Notes

- WeChat Mini Program requires configuring **request legal domains** in the MP admin console (App works as long as it's online); when voice reading is enabled, also add the TTS API domain (e.g. `dashscope.aliyuncs.com`) to the legal domains
- All data stays on your device; no cloud sync

