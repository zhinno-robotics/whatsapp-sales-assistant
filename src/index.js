/**
 * WhatsApp Sales Assistant — Web Server + SSE
 * Serves web UI at http://localhost:3000
 */
const express = require('express');
const path = require('path');
const http = require('http');
const chalk = require('chalk');
const config = require('./config');
const { createClient } = require('./whatsapp/client');
const { processIncoming, processCustomReply, processHistoricalMessage } = require('./ai/index');
const store = require('./db/store');
const { validateLicense } = require('./license');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ============================================================
// Middleware
// ============================================================

app.use(express.json());

// CORS — allow browser extension side panel to access API
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Serve static files + explicit index route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// SSE (Server-Sent Events) — real-time push to browser
// ============================================================

const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  res.write('event: connected\ndata: {}\n\n');

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcast(event, data) {
  let payload;
  try {
    payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  } catch (e) {
    console.error(chalk.red('  [SSE] JSON stringify error:'), e.message);
    return;
  }
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      // Client disconnected — will be cleaned up on 'close'
    }
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * Check if a chat ID is a channel or newsletter (NOT a real contact/group).
 * Only filters @newsletter (WhatsApp Channels) and @broadcast (status broadcasts).
 * @lid and @c.us are real contacts; @g.us are real groups.
 */
function isChannelChat(chatId) {
  if (!chatId) return false;
  return /@newsletter|@broadcast|status@/.test(chatId);
}

// ============================================================
// Sync historical messages from WhatsApp on startup
// ============================================================

async function syncHistoricalMessages() {
  console.log('  Syncing recent messages from WhatsApp...');
  try {
    const rawClient = waClient.getClient();
    const chats = await rawClient.getChats();
    let synced = 0;

    for (const chat of chats.slice(0, 20)) {
      try {
        // Get contact info
        const contact = await chat.getContact();
        const name = contact.name || contact.pushname || contact.number || 'Unknown';
        const number = contact.number || '';
        const chatId = chat.id._serialized;

        // Skip channels, broadcasts, newsletters
        if (isChannelChat(chatId)) continue;

        // Init conversation in store
        store.updateContact(chatId, name, number);

        // Fetch recent messages
        const messages = await chat.fetchMessages({ limit: 5 });
        for (const msg of messages.reverse()) {
          if (msg.fromMe) {
            store.saveMessage(chatId, `sent_${msg.timestamp}`, 'me', msg.body, msg.timestamp);
          } else if (msg.body) {
            store.saveMessage(chatId, msg.id._serialized, 'customer', msg.body, msg.timestamp);
          }
        }

        // Broadcast initial chat data to SSE clients
        broadcast('chat_synced', {
          chatId,
          contactName: name,
          contactNumber: number,
        });

        synced++;
      } catch (e) {
        // Skip chats that cause errors
      }
    }
    console.log(`  Synced ${synced} conversations`);
  } catch (e) {
    console.error('  Sync error:', e.message);
  }
}

// Connection status
app.get('/api/status', (req, res) => {
  res.json({ whatsappReady, serverReady: true });
});

// ============================================================
// REST API
// ============================================================

// List active conversations
app.get('/api/chats', (req, res) => {
  const chats = store.getActiveChats(50);
  res.json(chats);
});

// Get message history for a chat
app.get('/api/history/:chatId', (req, res) => {
  const history = store.getHistory(req.params.chatId, 50);
  res.json(history);
});

// Send a WhatsApp reply
app.post('/api/send', async (req, res) => {
  const { chatId, text } = req.body;
  if (!chatId || !text) return res.status(400).json({ error: 'chatId and text required' });

  try {
    // Save to DB
    store.saveMessage(chatId, `out_${Date.now()}`, 'me', text, Math.floor(Date.now() / 1000));

    // Send via WhatsApp
    await waClient.sendMessage(chatId, text);

    broadcast('message_sent', { chatId, text, timestamp: Math.floor(Date.now() / 1000) });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate custom AI reply
app.post('/api/custom', async (req, res) => {
  const { chatId, prompt } = req.body;
  if (!chatId || !prompt) return res.status(400).json({ error: 'chatId and prompt required' });

  try {
    const history = store.getHistory(chatId, config.contextWindow);
    const convo = store.getConversation(chatId);
    const customerName = convo ? convo.contact_name : '';
    const { en, zh } = await processCustomReply(prompt, history, customerName);
    res.json({ reply: en, zh });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test LLM connection
app.get('/api/test-llm', async (req, res) => {
  try {
    const { chatCompletion } = require('./ai/translator');
    const result = await chatCompletion([
      { role: 'user', content: 'Reply with just the word "OK".' }
    ], 0, 20);
    res.json({ ok: true, reply: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Generate suggestions for a specific historical message
app.post('/api/suggest', async (req, res) => {
  const { chatId, messageId } = req.body;
  if (!chatId || !messageId) return res.status(400).json({ error: 'chatId and messageId required' });

  try {
    const msg = store.getMessage(messageId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const history = store.getHistoryBefore(chatId, messageId, config.contextWindow);
    const convo = store.getConversation(chatId);
    const contactName = convo ? convo.contact_name : '';

    const result = await processHistoricalMessage({
      chatId,
      body: msg.body,
      contactName,
    }, history);

    // Save translation to store
    store.saveTranslation(messageId, result.translation);

    res.json({ translation: result.translation, suggestions: result.suggestions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Transcribe a voice message (uses separate STT provider — OpenRouter GPT-4o)
app.post('/api/transcribe', async (req, res) => {
  const { chatId, messageId } = req.body;
  if (!chatId || !messageId) return res.status(400).json({ error: 'chatId and messageId required' });

  try {
    const rawClient = waClient.getClient();
    const chat = await rawClient.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 50 });
    const msg = messages.find(m => m.id._serialized === messageId);

    if (!msg || !msg.hasMedia) {
      return res.status(404).json({ error: 'Voice message not found or no media' });
    }

    const media = await msg.downloadMedia();
    if (!media || !media.data) {
      return res.status(500).json({ error: 'Failed to download voice media' });
    }

    const base64Audio = media.data;
    const mimeType = media.mimetype || 'audio/ogg; codecs=opus';

    // Use STT provider (OpenRouter GPT-4o) for transcription
    const sttUrl = `${config.stt.baseURL}/chat/completions`;

    // Determine audio format for the model
    const format = mimeType.includes('ogg') || mimeType.includes('opus') ? 'ogg' : 'mp3';

    const sttResponse = await fetch(sttUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.stt.apiKey}`,
      },
      body: JSON.stringify({
        model: config.stt.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transcribe this voice message to text. Output ONLY the transcription, nothing else.' },
              { type: 'input_audio', input_audio: { data: base64Audio, format } },
            ],
          },
        ],
        max_tokens: 500,
      }),
    });

    if (!sttResponse.ok) {
      const errBody = await sttResponse.text();
      throw new Error(`STT API error ${sttResponse.status}: ${errBody}`);
    }

    const sttData = await sttResponse.json();
    const transcription = sttData.choices[0].message.content.trim();

    // Save transcription to store
    store.saveTranslation(messageId, transcription);

    // Broadcast update
    broadcast('message_updated', {
      chatId,
      messageId,
      translation: null,
      suggestions: [],
      transcription: transcription,
    });

    res.json({ transcription });
  } catch (err) {
    console.error('Transcribe error:', err.message);
    res.status(500).json({ error: 'Voice transcription failed: ' + err.message });
  }
});

// ============================================================
// WhatsApp Message Handler
// ============================================================

async function onWhatsAppMessage(msg) {
  // Skip channels, broadcasts, newsletters
  if (isChannelChat(msg.chatId)) return;

  // Save to DB
  const bodyText = msg.isVoice ? '' : (msg.body || '');
  store.saveMessage(msg.chatId, msg.messageId, 'customer', bodyText, msg.timestamp);
  store.updateContact(msg.chatId, msg.contactName, msg.contactNumber);

  console.log(chalk.dim(`  📨 ${msg.isVoice ? '[VOICE]' : ''} "${bodyText.substring(0, 40)}" from ${msg.contactName}`));

  // Push to browser immediately (no auto-translation — user clicks "Translate" button)
  broadcast('new_message', {
    chatId: msg.chatId,
    messageId: msg.messageId,
    body: bodyText,
    timestamp: msg.timestamp,
    contactName: msg.contactName,
    contactNumber: msg.contactNumber,
    translation: null,
    suggestions: [],
    isVoice: msg.isVoice || false,
  });
}

// ============================================================
// Bootstrap
// ============================================================

let waClient;
let whatsappReady = false;

// ============================================================
// Bootstrap
// ============================================================

async function main() {
  if (!config.llm.apiKey || config.llm.apiKey === 'your-api-key-here') {
    console.error(chalk.red('\n  ERROR: LLM API key not configured!'));
    console.error(chalk.yellow('  Edit .env and set LLM_API_KEY\n'));
    process.exit(1);
  }

  console.log(chalk.bold.cyan('\n  WhatsApp Sales Assistant - Web Edition\n'));

  // License check (skip if no license key configured — dev mode)
  const licenseKey = process.env.LICENSE_KEY;
  const phone = config.whatsappPhone;
  if (licenseKey && licenseKey.length > 0 && phone) {
    if (!validateLicense(phone, licenseKey)) {
      console.error(chalk.red('\n  INVALID LICENSE KEY'));
      console.error(chalk.yellow('  This software is licensed. Contact the vendor for a valid key.\n'));
      process.exit(1);
    }
    console.log(chalk.dim('  License: valid ✓\n'));
  }

  // Start HTTP server first (so browser UI is available immediately)
  server.listen(PORT, () => {
    console.log(chalk.dim(`  Server: http://localhost:${PORT}`));
    console.log(chalk.dim('  Open this URL in your browser while WhatsApp connects...\n'));
  });

  // Initialize WhatsApp client (blocking — requires QR scan)
  console.log(chalk.dim('  Initializing WhatsApp client...\n'));

  try {
    waClient = await createClient({
      onReady: () => {
        whatsappReady = true;
        console.log(chalk.green(`\n  ✅ WhatsApp connected! All systems ready.\n`));
        syncHistoricalMessages();
      },
      onMessage: onWhatsAppMessage,
      onError: (err) => {
        console.error(chalk.red(`\n  WhatsApp Error: ${err.message}`));
      },
    });
  } catch (err) {
    console.error(chalk.red(`\n  Failed to initialize WhatsApp: ${err.message}`));
    console.error(chalk.yellow('  Make sure Chrome is installed.\n'));
    process.exit(1);
  }
}

// Run
process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('\n  UNHANDLED REJECTION:'), reason);
});

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
