# WhatsApp Sales Assistant

AI-powered WhatsApp sales copilot — real-time translation, reply suggestion generation, and professional B2B copywriting.

## Features

- **Real-time WhatsApp Integration** — connects via WhatsApp Web, listens to all incoming customer messages
- **Auto Translation** — English ↔ Chinese, customer messages translated for quick understanding
- **5 AI Reply Suggestions** — Professional / Friendly / Closing / Detailed / Concise, all bilingual (EN+ZH)
- **Custom Reply Generation** — describe your intent in Chinese, AI crafts polished English reply
- **Send EN or ZH** — toggle between English and Chinese output per message
- **Historical Message Reply** — click any past message to regenerate context-aware suggestions
- **Collapsible Suggestions** — suggestions hidden by default, expand on click, auto-collapse after reply
- **Web Dashboard** — clean dark UI at `http://localhost:3000`, multi-conversation sidebar
- **License Key System** — built-in HMAC-based authorization for commercial distribution
- **One-click Deploy** — `build-dist.bat` generates portable zip for client machines

## Architecture

```
Browser (Web UI) ←── SSE (Server-Sent Events) ──→ Express Server
                         │
                    WhatsApp Client (Puppeteer)
                         │
                    DeepSeek API (LLM)
                         │
                    Translation + Suggestion Generation
```

## Quick Start

### Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **Chrome** — installed automatically by Puppeteer
- **DeepSeek API Key** — [Get one](https://platform.deepseek.com/api_keys)
- **WhatsApp account** — scan QR code on first launch

### Installation

```bash
git clone https://github.com/zhinno-robotics/whatsapp-sales-assistant.git
cd whatsapp-sales-assistant

# Windows: double-click setup.bat
# Or manually:
npm install
cp .env.example .env
# Edit .env with your API key
```

### Run

```bash
npm start
# Or double-click start.bat (Windows)
```

Open **http://localhost:3000** in your browser. Scan the QR code (`data/whatsapp-qr.png`) with WhatsApp on first launch.

## Configuration (.env)

```env
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-your-key-here
LLM_MODEL=deepseek-chat
USER_NATIVE_LANG=zh
CUSTOMER_LANG=en
CONTEXT_WINDOW=10
WHATSAPP_PHONE_NUMBER=8613800138000
LICENSE_KEY=
DATA_PATH=./data
```

## Usage

| Feature | How to Use |
|---------|------------|
| View messages | Left sidebar → click conversation |
| AI Suggestions | Auto-generated for new messages, `💡 N AI Suggestions ▸` to expand |
| Reply to old message | Click `↩ Reply to this message` → modal with 5 suggestions → edit → Send EN/ZH |
| Custom AI reply | Click ✨ AI button → describe intent in Chinese → AI generates bilingual reply |
| Quick send | Type in bottom textarea → Enter to send |

## Distribution

### Generate Installer

```bash
# Windows: double-click build-dist.bat
# Creates dist/WhatsApp-Sales-Assistant.zip
```

Deliver `WhatsApp-Sales-Assistant.zip` to clients. They extract, run `setup.bat`, then `start.bat`.

### License Keys

```bash
# Generate license key for a WhatsApp number
node gen-key.js 8613800138000
```

Add `LICENSE_KEY` to client's `.env`. Without valid key, application refuses to start.

## Project Structure

```
src/
  index.js           — Express server + SSE + REST API
  config.js           — Environment config
  public/
    index.html        — Web dashboard (SPA)
  whatsapp/
    client.js         — WhatsApp Web client (Puppeteer)
  ai/
    index.js          — AI orchestrator
    translator.js     — Language detection + translation
    suggester.js      — Reply suggestion generation (5-tone)
    prompts.js        — LLM prompt templates
  db/
    store.js          — JSON file-based conversation store
  license.js          — License key validation (HMAC-SHA256)
setup.bat             — First-time configuration wizard
start.bat             — Launcher (auto-kill port, open browser)
build-dist.bat        — Build portable distribution zip
gen-key.js            — License key generator
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| WhatsApp | [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) + Puppeteer |
| AI / LLM | DeepSeek API (OpenAI-compatible) |
| Server | Express.js 4 + SSE |
| Frontend | Vanilla HTML/CSS/JS (no framework) |
| Storage | JSON file |
| Auth | LocalAuth (WhatsApp) + HMAC-SHA256 (license) |

## Commercial Use

This project includes a license key system for commercial distribution. See [License System](#license-keys) above.

For white-label / OEM inquiries, contact the repository owner.
