# AI Sales Copilot — Browser Extension v2.2

AI-powered sales copilot for WhatsApp Web as a **pure Chrome/Edge extension** — no server needed.

## Features

- **Real-time WhatsApp Web Integration** — connects via content script
- **Auto Translation** — customer messages translated to your native language
- **5 AI Reply Suggestions** — Professional / Friendly / Closing / Detailed / Concise
- **Custom AI Reply** — describe your intent in your language, AI crafts polished reply
- **Side Panel UI** — WhatsApp mobile-style interface in browser side panel
- **Zero Server** — everything runs in the extension, no backend needed
- **Free & Open Source** — no license key, no subscription, MIT licensed

## Installation

1. Open `edge://extensions/` or `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Open [web.whatsapp.com](https://web.whatsapp.com)

## Configuration

Click the extension icon to open settings:

| Setting | Description | Default |
|---------|-------------|---------|
| LLM Base URL | AI API endpoint | `https://api.deepseek.com/v1` |
| LLM API Key | Your API key (DeepSeek/OpenAI/OpenRouter) | (required) |
| LLM Model | Model name | `deepseek-chat` |
| Your Language | Your native language | Chinese |
| Customer Language | Customer's language | English |
| Context Window | Messages for AI context | 10 |

## Usage

1. Open WhatsApp Web, click extension icon → "Open Side Panel"
2. Wait for "WhatsApp Connected" status
3. Select a chat from the sidebar
4. Customer messages show with one-click translation
5. Click `💡 N AI Suggestions` to expand reply options
6. Click `↩ Reply` on any message to open the reply editor
7. Click `✨ AI` to describe your intent and get a custom AI reply
8. Send in your language or auto-translated to English

## Architecture

```
Chrome/Edge Extension (Manifest V3)
├── background.js (Service Worker)
│   ├── AI calls (DeepSeek / OpenAI / OpenRouter)
│   ├── chrome.storage.local (data persistence)
│   └── Message routing (content ↔ sidepanel)
│
├── content.js (ISOLATED world)
│   ├── Injects page-script.js into MAIN world
│   └── Bridges page-script ↔ background
│
├── page-script.js (MAIN world — injected)
│   ├── Accesses WhatsApp Web internals
│   ├── Monitors new messages
│   └── Sends messages via Store API
│
├── sidepanel.html + sidepanel.js
│   └── Full UI: chat list, messages, AI suggestions
│
└── popup.html + popup.js
    └── Settings: API keys, language, behavior
```

## Privacy

All data stored locally (chrome.storage.local). No chat logs uploaded. AI calls use your own API key directly to your chosen provider. [Privacy Policy](https://zhinno-robotics.github.io/whatsapp-sales-assistant/privacy.html)

## License

MIT
