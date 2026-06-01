# WhatsApp Sales Assistant — Browser Extension v2.0

AI-powered WhatsApp sales copilot as a **pure Chrome/Edge extension** — no server needed.

## Features

- **Real-time WhatsApp Integration** — connects via WhatsApp Web content script
- **Auto Translation** — customer messages translated to your native language
- **5 AI Reply Suggestions** — Professional / Friendly / Closing / Detailed / Concise
- **Custom AI Reply** — describe your intent, AI crafts polished reply
- **Voice Transcription** — transcribe voice messages (requires STT API key)
- **Side Panel UI** — WhatsApp mobile-style interface in browser side panel
- **Zero Server** — everything runs in the extension, no Express server needed

## Architecture

```
Chrome/Edge Extension (Manifest V3)
├── background.js (Service Worker)
│   ├── AI calls (DeepSeek / OpenRouter)
│   ├── chrome.storage.local (data persistence)
│   └── Message routing (content ↔ sidepanel)
│
├── content.js (ISOLATED world)
│   ├── Injects page-script.js into MAIN world
│   └── Bridges page-script ↔ background
│
├── page-script.js (MAIN world — injected)
│   ├── Accesses window.Store (WhatsApp internals)
│   ├── Monitors new messages via Store.Msg events
│   └── Sends messages via Store.SendMessage
│
├── sidepanel.html + sidepanel.js
│   └── Full UI: chat list, messages, AI suggestions
│
└── popup.html + popup.js
    └️── Settings: API keys, language, behavior
```

## Installation

1. Open `edge://extensions/` or `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `whatsapp-sales-extension/` folder
5. Open [web.whatsapp.com](https://web.whatsapp.com) and scan QR code

## Configuration

Click the extension icon in the toolbar to open **Settings**:

| Setting | Description | Default |
|---------|-------------|---------|
| LLM Base URL | AI API endpoint | `https://api.deepseek.com/v1` |
| LLM API Key | Your DeepSeek/OpenAI API key | (required) |
| LLM Model | Model name | `deepseek-chat` |
| STT Base URL | Voice transcription API | `https://openrouter.ai/api/v1` |
| STT API Key | OpenRouter API key | (optional) |
| STT Model | Transcription model | `openai/gpt-4o` |
| Your Language | Your native language | Chinese |
| Customer Language | Customer's language | English |
| Context Window | Messages for AI context | 10 |

## Usage

1. **Open WhatsApp Web** — the side panel auto-opens
2. **Wait for connection** — status bar shows "WhatsApp Connected"
3. **Select a chat** from the left sidebar
4. **View messages** — customer messages appear with optional translation
5. **AI Suggestions** — click `💡 N AI Suggestions` to expand reply options
6. **Reply to specific message** — click `↩ Reply to this message`
7. **Custom AI reply** — click `✨ AI` button, describe your intent in Chinese
8. **Send** — choose Send ZH (Chinese) or Send EN (English)

## Key Differences from v1 (Server-based)

| Feature | v1 (Server) | v2 (Extension) |
|---------|-------------|----------------|
| Server required | Yes (Express + Puppeteer) | **No** |
| WhatsApp connection | whatsapp-web.js (Node.js) | **Content Script** (window.Store) |
| Data storage | JSON file (data/store.json) | **chrome.storage.local** |
| Deployment | npm start + browser | **Load unpacked extension** |
| Portability | Requires Node.js runtime | **Pure browser extension** |

## File Structure

```
whatsapp-sales-extension/
├── manifest.json          # Manifest V3 configuration
├── background.js          # Service worker (AI, storage, routing)
├── content.js             # Content script (bridge)
├── page-script.js         # Injected script (WhatsApp Store access)
├── sidepanel.html         # Sidepanel UI (HTML + CSS)
├── sidepanel.js           # Sidepanel logic
├── popup.html             # Settings popup
├── popup.js               # Settings logic
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md
```

## Troubleshooting

**Side panel doesn't open:**
- Click the extension icon in the toolbar
- Ensure you're on `web.whatsapp.com`

**No messages appearing:**
- Refresh the WhatsApp Web tab
- Check that the extension is enabled

**AI not working:**
- Open Settings (click extension icon) and verify API key
- Click "Test LLM Connection" to verify

**Messages not sending:**
- Ensure WhatsApp Web is fully loaded
- Try refreshing the WhatsApp Web tab

## License

MIT
