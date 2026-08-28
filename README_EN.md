<p align="center">
  <img src="static/logo.png" width="140" alt="AI Buddy Logo" />
</p>

<h1 align="center">🤖 AI Buddy (AI 伙伴)</h1>

<p align="center">
  A lightweight LLM persona chat app built with <b>uni-app (Vue 3)</b> — <b>no backend, fully on-device</b>. It calls any <b>OpenAI-compatible</b> <code>/chat/completions</code> endpoint (including <b>Ollama</b> local models) and runs across <b>App / H5 / WeChat Mini Program</b>.
</p>

<p align="center">
  <img alt="Platforms" src="https://img.shields.io/badge/Platforms-App%20%7C%20H5%20%7C%20WeChat-blue" />
  <img alt="Framework" src="https://img.shields.io/badge/Framework-uni--app%20Vue3-green" />
  <img alt="Backend" src="https://img.shields.io/badge/Backend-None%20(On--device)-orange" />
</p>

> Memory system inspiration: [koishi-ai-pet](https://github.com/Koishi007/koishi-ai-pet)

---

## ✨ Core Highlights

### 🧠 Memory Maintenance

The AI doesn't just chat — it **remembers you**. A built-in "three-tier memory + LLM auto-write" mechanism gives the AI an ever-evolving long-term memory:

- **L1 core facts / L2 situational memory (agreements & TODOs) / L3 temporary info**, graded by importance with half-life time decay
- The LLM outputs `Memory:` lines to **add / modify / delete** memories on the fly — maintaining its understanding of you just like a real person
- **Automatic recall & maintenance**: near-duplicate memories are auto-merged, stale ones are cleaned up, core facts are never forgotten
- A dedicated Memory page lets you filter, create, edit, and batch-delete manually

### 😄 Emoji Support (No Image-Recognition Model Needed)

Custom emoji / stickers that just work — **no vision model required**:

- Upload images and reference them with `$emoji-name$` placeholders; the LLM can sprinkle emojis into its replies on its own
- **Pure text mapping**: the system simply injects the emoji list into the prompt and matches by name — no visual model to analyze image content, keeping it lightweight and cheap
- Batch upload with per-image naming, long-press drag reordering, rename & delete; emojis and text render as separate segments in messages

### 💬 Realistic Proactive Chat

The AI reaches out to you like a real person instead of just waiting for replies:

- Works only in **Real-time** scene mode; the AI **messages you at random moments**
- **Realistic pacing**: ≤1 sentence per message, ≤2 consecutive emojis, multiple messages split into separate bubbles; it wraps up near the end of a topic with a short line or a single emoji
- Configurable active time window and frequency level (low / medium / high), plus a custom countdown (seconds) for debugging
- **Low background cost**: a single foreground timer + on-resume catch-up, zero polling in the background

---

## 🎯 User-Facing Features

- **Persona chat**: 4 built-in personas (Gentle Big Sister / Energetic Junior / Koishi / Tsundere Catgirl) plus fully custom persona prompts; **each conversation has its own independent persona** — switch conversations to switch personas
- **Multi-conversation history**: memories / personas / scenes / summaries stored per conversation; create, switch, delete, and **duplicate a conversation or its memories** into a new one
- **Scene tracking**: the LLM maintains the current scene each reply (`Scene:` line), with **real-time / virtual-time** modes; scene history is viewable and editable
- **Context compression**: older context is summarized by the LLM; later requests send only "summary + uncompressed tail" to cut token usage dramatically. Automatic (by message interval) or manual
- **Emoji management**: batch upload with per-image naming, drag reordering, rename & delete; emojis and text render as separate segments
- **Realistic proactive chat**: see the Core Highlights above — pick your window, frequency and debug countdown, or one-tap "send a proactive message now"
- **Message voice reading (TTS)**: optional; new LLM replies are synthesized and played automatically on render (Qwen-TTS by default; API key / model / voice configurable). Only text is read — emojis are skipped; audio is never saved to disk and is destroyed after one playback; a one-tap interface test is available in Settings
- **Memory management**: filter / create / edit content, priority & level / **multi-select batch delete**
- **Export chat**: one-tap export of the current conversation to `.txt` (download on H5, save to app documents on App, copy to clipboard on Mini Program)
- **Chat UX**: chat background image, jump-to-bottom button, side slider for quick scrolling, regenerate the last AI reply

## 🧑‍💻 Developer-Facing Features

- **On-device, zero backend**: all data stays on your device, no cloud sync; **no third-party npm dependency**, `package.json` is only used for `npm test`
- **Reliable cross-platform persistence**: unified `uni.setStorageSync`, works on App / H5 / Mini Program and survives restarts
- **Modular chat service**: `chat.js` is only a facade, split into 5 domains (state / settings / conversations / compress / proactive) that eliminate circular dependencies while keeping call entry points unchanged
- **Memory algorithm engine**: character bigram Jaccard + LCS dual-similarity dedup, half-life decay, layered retrieval & capacity governance, recall cooldown (`memory.js`)
- **LLM compatibility layer**: OpenAI-compatible client with Ollama support; built-in **thinking-mode fallback** (`reasoning_effort` with cascading fallback + `reasoning`/`thinking` field fallback) — a three-layer fix for Qwen3-style "request succeeds but reply is empty"
- **Debug log instrumentation**: a ring buffer records every request / response / error / key operation, expandable to full content and clearable in one tap
- **Unit-test coverage**: `npm test` runs in Node with a mocked `uni`, 140+ assertions on core logic
- **API profiles**: up to **3 saved API presets** for quick switching; the **Thinking Mode** toggle fixes empty replies with Ollama reasoning models

### Context Compression Mechanism

- Automatic (by `compressInterval` message count) or manual trigger
- Compresses everything since the last progress point, keeping the most recent 10 messages; chunks are processed in batches of 80 with summaries merged incrementally to avoid oversized requests
- The summary is stored in the conversation and injected into the system message ("conversation so far"); original messages remain fully intact for browsing

---

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
├── static/logo.png        # Project logo
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
│   ├── chat-proactive.js  # Realistic proactive chat domain (foreground scheduler + catch-up + send)
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

Runs in Node with a mocked `uni` store, covering memory parsing, dedup & merge, recall cooldown, retrieval injection, conversation management, context compression, debug logs, API presets, thinking mode, per-conversation personas, export text, proactive-chat scheduling and more — 140+ assertions.

## 📄 Docs

- [CLAUDE.md](CLAUDE.md) — architecture, development conventions, platform differences & Ollama setup
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — changelog

## ⚠️ Platform Notes

- WeChat Mini Program requires configuring **request legal domains** in the MP admin console (App works as long as it's online); when voice reading is enabled, also add the TTS API domain (e.g. `dashscope.aliyuncs.com`) to the legal domains
- All data stays on your device; no cloud sync
- On App grant storage permission at first launch; H5 runs directly in the browser with no extra setup