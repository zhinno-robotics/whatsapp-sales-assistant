/**
 * WhatsApp Web Client Wrapper
 * Auth: QR code — displayed in terminal (compact) + saved as PNG file
 */
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const config = require('../config');

async function createClient(handlers) {
  const { onReady, onMessage, onError } = handlers;
  const authPath = path.join(config.dataPath, '.wwebjs_auth');

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: authPath }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    },
  });

  // ============ QR Code Handler ============

  client.on('qr', async (qrString) => {
    console.log('\n═══════════════════════════════════════════');
    console.log('  🔐 WhatsApp QR Code');
    console.log('═══════════════════════════════════════════\n');

    // 1. Save as PNG (most reliable)
    try {
      const pngPath = path.join(config.dataPath, 'whatsapp-qr.png');
      fs.mkdirSync(config.dataPath, { recursive: true });
      await QRCode.toFile(pngPath, qrString, {
        type: 'png',
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
      console.log('  📁 QR saved to file:');
      console.log(`     ${pngPath}`);
      console.log('     → Open this file and scan with WhatsApp\n');
    } catch (err) {
      console.log('  ⚠️  Could not save QR PNG:', err.message, '\n');
    }

    // 2. Compact terminal QR (smaller version)
    try {
      const terminalQR = await QRCode.toString(qrString, {
        type: 'terminal',
        small: true,       // half-size modules (2x smaller)
      });
      console.log('  📱 Terminal QR (scan if visible):\n');
      console.log(terminalQR);
    } catch {
      console.log('  (Terminal QR unavailable)\n');
    }

    // 3. URL backup
    console.log('  🔗 Or open in browser:');
    console.log(`     https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrString)}\n`);

    console.log('  ⏳ Waiting for scan... (refresh every 30s)');
    console.log('═══════════════════════════════════════════\n');
  });

  // ============ Events ============

  client.on('ready', () => {
    console.log('✅ WhatsApp client is ready!');
    if (onReady) onReady();
  });

  client.on('authenticated', () => {
    console.log('🔐 Authenticated with WhatsApp');
  });

  client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failure:', msg);
    if (onError) onError(new Error(`Auth failure: ${msg}`));
  });

  client.on('disconnected', async (reason) => {
    console.warn('⚠️ WhatsApp disconnected:', reason);
    if (reason !== 'logout') {
      console.log('🔄 Attempting to reconnect...');
      try {
        await client.initialize();
      } catch (err) {
        console.error('❌ Reconnection failed:', err.message);
        if (onError) onError(err);
      }
    }
  });

  client.on('change_state', (state) => {
    console.log('📶 Connection state:', state);
  });

  // ============ Message Handler ============

  client.on('message_create', async (msg) => {
    try {
      if (msg.fromMe) return;
      if (!msg.body || msg.body.trim().length === 0) return;
      if (msg.type !== 'chat' && msg.type !== 'text') return;

      let contactName = 'Unknown';
      let contactNumber = '';
      try {
        const contact = await msg.getContact();
        contactName = contact.name || contact.pushname || contact.number || 'Unknown';
        contactNumber = contact.number || '';
      } catch (e) { /* non-fatal */ }

      const messageObj = {
        chatId: msg.from,
        messageId: msg.id ? msg.id._serialized : `msg_${Date.now()}`,
        body: msg.body.trim(),
        timestamp: msg.timestamp || Math.floor(Date.now() / 1000),
        contactName,
        contactNumber,
      };

      if (onMessage) await onMessage(messageObj);
    } catch (err) {
      console.error('❌ Error processing incoming message:', err.message);
    }
  });

  // ============ Shutdown ============

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n🛑 Shutting down...');
    try { await client.destroy(); } catch (e) { /* ignore */ }
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // ============ Initialize ============

  console.log('🚀 Initializing WhatsApp client...');
  console.log('   (first run downloads Chromium ~150MB, please wait)');
  await client.initialize();

  return {
    async sendMessage(chatId, text) {
      if (!text || text.trim().length === 0) return null;
      return client.sendMessage(chatId, text.trim());
    },
    async sendReply(chatId, text) {
      return client.sendMessage(chatId, text.trim());
    },
    getClient() { return client; },
    async getInfo() { return client.info; },
    shutdown,
  };
}

module.exports = { createClient };
