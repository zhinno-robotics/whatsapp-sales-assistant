# AGENTS.md — WhatsApp Sales Assistant

## Quick commands

```bash
npm install          # install deps
npm start            # run server (port 3000)
npm run dev          # run with --watch (auto-restart)
node gen-key.js <phone>  # generate license key
```

Start the server before opening the browser or loading the extension.  
No build step — vanilla HTML/JS/CSS served statically.

## Architecture

```
Browser Extension (Edge/Chrome)         Express Server (localhost:3000)
  sidepanel.html ──iframe──→  index.html (?sidebar=1 mode) ←SSE── Express
                                       │
  content.js (floating button only)     ├── WhatsApp Client (puppeteer + whatsapp-web.js)
  service-worker.js (injects content)   ├── AI (DeepSeek API)
                                        └── DB (JSON file: data/store.json)
```

**Two rendering paths coexist in `src/public/index.html`:**
- Normal: full sidebar + main layout (desktop browser)
- Compact (`?sidebar=1`): WhatsApp mobile-style single-column with slide navigation  
  Compact mode **overrides** `selectChat`, `renderMessages`, `updateChatList`, `connectSSE`, and `checkWhatsAppStatus` inside `if (isCompact)` block.

## Environment

Copy `.env.example` → `.env`. Required keys:
- `LLM_API_KEY` — DeepSeek (or any OpenAI-compatible) API key
- `STT_API_KEY` — OpenRouter (or any multimodal LLM) API key for voice transcription
- Optional: `LICENSE_KEY`, `WHATSAPP_PHONE_NUMBER`, `CONTEXT_WINDOW` (default 10)

Server refuses to start if `LLM_API_KEY` is unset or still `your-api-key-here`.

**Voice transcription** uses a separate LLM provider (`STT_BASE_URL` + `STT_API_KEY` + `STT_MODEL`) because DeepSeek doesn't support audio input. Default is OpenRouter GPT-4o.`

## Getting logged in (WhatsApp)

**The QR code flow** — most common support request:
1. `npm start` → server starts, Puppeteer launches headless Chrome
2. QR code is saved to `data/whatsapp-qr.png` AND printed in terminal
3. Open the PNG file and scan with WhatsApp mobile app (Linked Devices)
4. After successful scan, `data/.wwebjs_auth/` stores the session — **do not delete this**
5. If login fails: delete `data/.wwebjs_auth/` and `data/store.json`, restart

Chrome must be installed. Puppeteer downloads Chromium automatically on first run.  
If port 3000 is in use, run `start.bat` which auto-kills the existing process.

## Browser extension

**Install**: `edge://extensions/` or `chrome://extensions/` → Developer mode → Load unpacked → select `extension/` folder.

**How it works**:
- `service-worker.js` **programmatically injects** `content.js` + `content.css` when `web.whatsapp.com` loads (not via manifest `content_scripts`)
- `content.js` adds only a floating green toggle button
- `sidepanel.html` loads `http://localhost:3000/?sidebar=1` in an iframe
- The `?sidebar=1` param triggers compact mode CSS and JS overrides

**Reloading**: After editing extension files, refresh from `edge://extensions/` page, then **close and reopen** the WhatsApp Web tab (content scripts only inject on page load).

**DO NOT attempt DOM-based detection of WhatsApp's active chat** — WhatsApp Web's DOM is heavily obfuscated and changes frequently. Multiple approaches (MutationObserver, font-size scanning, geometric pane detection, diff-based text analysis) were attempted and all failed. The extension now works as a self-contained sidebar where users select chats manually.

## API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Serves `index.html` (web dashboard) |
| GET | `/api/status` | `{ whatsappReady, serverReady }` |
| GET | `/api/chats` | List active conversations |
| GET | `/api/history/:chatId` | Message history (last 50) |
| POST | `/api/send` | Send WhatsApp reply `{ chatId, text }` |
| POST | `/api/custom` | Generate custom AI reply `{ chatId, prompt }` |
| POST | `/api/suggest` | Translate + suggest per message `{ chatId, messageId }` |
| POST | `/api/transcribe` | Transcribe voice message `{ chatId, messageId }` |
| GET | `/api/test-llm` | Test LLM connectivity |
| GET | `/api/events` | SSE stream for real-time updates |

## Key design decisions

- **Translation is on-demand, not automatic**. The auto-translation pipeline was removed from `onWhatsAppMessage`. Users click `🌐 Translate` button per message, which calls `/api/suggest`. The `translateMsg()` function in `index.html` handles the DOM update.
- **Groups are hidden by default** in compact mode. Toggle via `Groups` button. Group IDs contain `@g.us`.
- **Dual theme**: CSS variables (`--bg-list`, `--text-primary`, etc.) defined for dark mode (`:root`) and light mode (`html.light body.compact`). Toggle via `🌙/☀️` button.
- **Avatar colors**: 16-color palette, hashed from contact name for consistency.
- **Store is in-memory + JSON file** (`data/store.json`). Save is called synchronously after each write. No database needed.
- **Server stores chat IDs** in WhatsApp format (`[phone]@c.us` for personal, `[id]@g.us` for groups).

## File map (only non-obvious ones)

| File | Role |
|------|------|
| `src/public/index.html` | ALL frontend — HTML + CSS + JS (base + compact) |
| `src/index.js` | Express server, SSE, REST API, message handler |
| `src/config.js` | Env config loader (`.env` from project root) |
| `src/whatsapp/client.js` | Puppeteer wrapper, QR code, message forwarding |
| `src/db/store.js` | JSON file store (conversations + messages + translations) |
| `src/ai/` | LLM calls — translator, suggester, prompts |
| `extension/` | Browser extension (NOT built, loaded as unpacked) |
| `setup.bat` | One-time env setup wizard |
| `start.bat` | Kill port 3000 + launch server + open browser |

## Don't do these

- Don't change the `data/.wwebjs_auth/` directory — it's the WhatsApp session cache
- Don't add npm dependencies that require native compilation (keep it portable)
- Don't try to detect WhatsApp's active chat from the DOM — it doesn't work reliably
- Don't modify `index.html`'s base rendering without also updating the compact mode overrides in the `if (isCompact)` block
- Don't use `chrome.scripting.executeScript` from the side panel to poll WhatsApp Web — use `chrome.storage.local` or the server API instead
