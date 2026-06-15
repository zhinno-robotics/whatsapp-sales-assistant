/**
 * background.js — Service Worker
 * AI calls, chrome.storage management, message routing,
 * daily quota (Free: 25 msgs/day) + Pro license validation.
 */

// ============================================================
// Default Configuration
// ============================================================

const DEFAULT_CONFIG = {
  llm: {
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
  },
  userNativeLang: 'zh',
  customerLang: 'en',
  contextWindow: 10,
  autoOpenSidePanel: true,
  // Pro license
  licenseKey: '',
  licenseEmail: '',
};

const LANGUAGE_NAMES = {
  zh: 'Chinese (Simplified)',
  en: 'English',
  es: 'Spanish',
  ar: 'Arabic',
  pt: 'Portuguese',
  fr: 'French',
  de: 'German',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  id: 'Indonesian',
  vi: 'Vietnamese',
  th: 'Thai',
  hi: 'Hindi',
  tr: 'Turkish',
  it: 'Italian',
};

function getLanguageName(code) {
  return LANGUAGE_NAMES[code] || code || 'English';
}

// ============================================================
// Pro License Validation (SHA-256, offline)
// ============================================================

const LICENSE_SECRET = 'aisc-pro-secret-2026';

/**
 * Parse a license key string: "AISC-XXXX-XXXX-XXXX-XXXX"
 * Returns { email, expiry, signature, emailHex, expiryHex } or null.
 */
function parseLicenseKey(key) {
  if (!key || typeof key !== 'string') return null;
  const cleaned = key.replace(/\s+/g, '').replace(/-/g, '');
  if (!cleaned.startsWith('AISC')) return null;
  const payload = cleaned.substring(4);
  if (payload.length < 20) return null;
  const signature = payload.substring(0, 12);
  const expiryHex = payload.substring(12, 20);
  const emailHex = payload.substring(20);
  if (!emailHex || emailHex.length === 0) return null;
  try {
    const email = emailHex.match(/.{1,2}/g).map(function(b) { return String.fromCharCode(parseInt(b, 16)); }).join('');
    const expiry = parseInt(expiryHex, 16);
    return { email: email, expiry: expiry, signature: signature, emailHex: emailHex, expiryHex: expiryHex };
  } catch (e) {
    return null;
  }
}

/**
 * Compute SHA-256 hex for signature verification.
 * Uses crypto.subtle.digest (works in Service Worker without key import).
 */
async function sha256hex(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

/**
 * Validate a Pro license key.
 * Signature = first 12 chars of SHA-256(secret + ':' + email + ':' + expiryHex)
 */
async function validateLicenseKey(licenseKey, email) {
  console.log('[wasap-bg] validateLicenseKey start');
  if (!licenseKey || !email) return { valid: false, reason: 'License key and email are required.' };
  var parsed = parseLicenseKey(licenseKey);
  console.log('[wasap-bg] parsed:', parsed ? ('email=' + parsed.email + ' expiry=' + parsed.expiry + ' sig=' + parsed.signature + ' expiryHex=' + parsed.expiryHex) : 'null');
  if (!parsed) {
    return { valid: false, reason: 'Invalid license key format. Expected: AISC-XXXX-XXXX-XXXX-XXXX' };
  }
  if (parsed.email.toLowerCase() !== email.trim().toLowerCase()) {
    console.log('[wasap-bg] email mismatch: key has', parsed.email.toLowerCase(), 'input has', email.trim().toLowerCase());
    return { valid: false, reason: 'License key does not match this email address.' };
  }
  // Check expiry
  var nowDays = Math.floor(Date.now() / 86400000);
  console.log('[wasap-bg] nowDays:', nowDays, 'expiryDays:', parsed.expiry);
  if (parsed.expiry < nowDays) {
    var expiryDate = new Date(parsed.expiry * 86400000);
    return { valid: false, reason: 'License expired on ' + expiryDate.toISOString().split('T')[0] + '.' };
  }
  // Verify signature: SHA-256(secret + ':' + email + ':' + expiryHex)
  var sigInput = LICENSE_SECRET + ':' + parsed.email.toLowerCase() + ':' + parsed.expiryHex;
  console.log('[wasap-bg] sigInput:', sigInput);
  var fullSig = await sha256hex(sigInput);
  var sigHex = fullSig.substring(0, 12);
  console.log('[wasap-bg] expected sig:', parsed.signature, 'computed sig:', sigHex, 'fullSig:', fullSig.substring(0, 20));
  if (sigHex !== parsed.signature) {
    return { valid: false, reason: 'License key signature is invalid.' };
  }
  var expDate = new Date(parsed.expiry * 86400000);
  return { valid: true, expiryDate: expDate.toISOString().split('T')[0], email: parsed.email };
}

// ============================================================
// Daily Quota Tracking (Free tier: 25 AI operations/day)
// Anti-tamper: uses monotonic timestamp to detect clock rollback.
// ============================================================

const FREE_LIMIT = 25;
const MIN_RESET_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20 hours minimum between resets

/**
 * Quota storage structure:
 * {
 *   date: "YYYY-MM-DD",       // calendar date of last reset
 *   count: 0-25,              // operations used today
 *   lastOpEpoch: 1717600000,  // Date.now() at last operation (monotonic guard)
 *   tamperCount: 0,           // number of clock-rollback attempts detected
 * }
 */

async function getDailyUsage() {
  const result = await chrome.storage.local.get('dailyUsage');
  const usage = result.dailyUsage || {};
  return usage; // returns raw stored state, caller decides validity
}

async function incrementDailyUsage() {
  const now = Date.now();
  const today = new Date(now).toISOString().split('T')[0];
  const usage = await getDailyUsage();

  // Initialize if empty
  if (!usage.date) {
    usage.date = today;
    usage.count = 1;
    usage.lastOpEpoch = now;
    usage.tamperCount = 0;
    await chrome.storage.local.set({ dailyUsage: usage });
    return usage;
  }

  // --- Tamper detection ---
  // If clock went backwards relative to last operation, freeze quota
  if (usage.lastOpEpoch && now < usage.lastOpEpoch) {
    usage.tamperCount = (usage.tamperCount || 0) + 1;
    await chrome.storage.local.set({ dailyUsage: usage });
    return usage; // count unchanged — quota stays frozen
  }

  // --- Legitimate reset: date changed AND enough time has passed ---
  if (usage.date !== today) {
    const timeSinceLastOp = usage.lastOpEpoch ? now - usage.lastOpEpoch : Infinity;
    if (timeSinceLastOp >= MIN_RESET_INTERVAL_MS) {
      // Genuine new day — reset
      usage.date = today;
      usage.count = 1;
    } else {
      // Date changed but not enough real time passed → suspicious, freeze
      usage.tamperCount = (usage.tamperCount || 0) + 1;
      // Don't change count — quota stays as-is
    }
    usage.lastOpEpoch = now;
    await chrome.storage.local.set({ dailyUsage: usage });
    return usage;
  }

  // Same day — normal increment
  usage.count++;
  usage.lastOpEpoch = now;
  await chrome.storage.local.set({ dailyUsage: usage });
  return usage;
}

async function isPro(config) {
  // Developer bypass — set devMode:true via chrome.storage.local
  if (config && config.devMode === true) return true;
  if (!config || !config.licenseKey || !config.licenseEmail) return false;
  const result = await validateLicenseKey(config.licenseKey, config.licenseEmail);
  return result.valid;
}

async function checkQuota(config) {
  const pro = await isPro(config);
  if (pro) return { allowed: true, pro: true, remaining: Infinity };

  const usage = await getDailyUsage();
  const now = Date.now();

  // Detect tampered state
  if (usage.tamperCount > 0) {
    // If tampered too many times, lock permanently
    if (usage.tamperCount >= 3) {
      return {
        allowed: false,
        pro: false,
        remaining: 0,
        limit: FREE_LIMIT,
        tampered: true,
        message: 'Quota system integrity check failed. Upgrade to Pro to restore access.'
      };
    }
  }

  // If clock went backwards, freeze
  if (usage.lastOpEpoch && now < usage.lastOpEpoch) {
    return {
      allowed: false,
      pro: false,
      remaining: 0,
      limit: FREE_LIMIT,
      tamperSuspected: true,
      message: 'System clock appears to have been changed. AI operations temporarily disabled. Upgrade to Pro for uninterrupted access.'
    };
  }

  const count = usage.count || 0;
  if (count >= FREE_LIMIT) {
    return {
      allowed: false,
      pro: false,
      remaining: 0,
      limit: FREE_LIMIT,
      message: `Daily free limit (${FREE_LIMIT} messages) reached. Resets in approximately ${getTimeUntilReset(usage)}. Upgrade to Pro for unlimited access.`
    };
  }
  return { allowed: true, pro: false, remaining: FREE_LIMIT - count, limit: FREE_LIMIT };
}

function getTimeUntilReset(usage) {
  if (!usage.lastOpEpoch) return '24 hours';
  const resetAt = usage.lastOpEpoch + MIN_RESET_INTERVAL_MS;
  const remaining = resetAt - Date.now();
  if (remaining <= 0) return 'soon';
  const hours = Math.floor(remaining / 3600000);
  const mins = Math.floor((remaining % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

// ============================================================
// Storage Manager (chrome.storage.local)
// ============================================================

const Storage = {
  async getConfig() {
    const result = await chrome.storage.local.get('config');
    return {
      ...DEFAULT_CONFIG,
      ...result.config,
      llm: {
        ...DEFAULT_CONFIG.llm,
        ...(result.config?.llm || {}),
      },
    };
  },

  async setConfig(config) {
    await chrome.storage.local.set({ config: { ...DEFAULT_CONFIG, ...config } });
  },

  async getConversations() {
    const result = await chrome.storage.local.get('conversations');
    return result.conversations || {};
  },

  async setConversations(conversations) {
    await chrome.storage.local.set({ conversations });
  },

  async getMessages(chatId) {
    const key = `msgs_${chatId}`;
    const result = await chrome.storage.local.get(key);
    return result[key] || [];
  },

  async setMessages(chatId, messages) {
    const key = `msgs_${chatId}`;
    const trimmed = messages.slice(-200);
    await chrome.storage.local.set({ [key]: trimmed });
  },

  async getTranslation(messageId) {
    const key = `trans_${messageId}`;
    const result = await chrome.storage.local.get(key);
    return result[key] || null;
  },

  async setTranslation(messageId, translation) {
    const key = `trans_${messageId}`;
    await chrome.storage.local.set({ [key]: translation });
  },

  async getSuggestions(messageId) {
    const key = `sug_${messageId}`;
    const result = await chrome.storage.local.get(key);
    return result[key] || null;
  },

  async setSuggestions(messageId, suggestions) {
    const key = `sug_${messageId}`;
    await chrome.storage.local.set({ [key]: suggestions });
  },

  async getActiveChats(limit = 50) {
    const convos = await this.getConversations();
    return Object.values(convos)
      .filter(c => c.chatId && !/@newsletter|@broadcast|status@/.test(c.chatId))
      .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
      .slice(0, limit);
  },
};

// ============================================================
// AI Service
// ============================================================

const AI = {
  async chatCompletion(messages, temperature = 0.3, maxTokens = 1000, config) {
    const url = `${config.llm.baseURL}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`LLM API error ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  },

  async translate(text, direction, config) {
    if (!text || text.trim().length < 2) return text;

    const systemPrompt = direction === 'to_user'
      ? PROMPTS.TRANSLATE_TO_USER(config)
      : PROMPTS.TRANSLATE_TO_CUSTOMER(config);

    const result = await this.chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ], 0.2, 800, config);

    return result;
  },

  async generateSuggestions(history, customerName, config) {
    if (history.length === 0) {
      const defaultReplies = [
        'Thank you for reaching out! How can I assist you today?',
        'Hi! Thanks for your message. What can I help you with?',
        'Hello! I appreciate you contacting us. What would you like to discuss?',
        'Thanks for getting in touch. Let me know what you need and I will get right on it.',
        'Hi there! How can I help?',
      ];
      const customerReplies = await Promise.all(
        defaultReplies.map(text => this.translate(text, 'to_customer', config).catch(() => text))
      );
      const userTranslations = await Promise.all(
        customerReplies.map(text => this.translate(text, 'to_user', config).catch(() => '[Translation failed]'))
      );
      return customerReplies.map((reply, i) => ({ en: reply, zh: userTranslations[i] }));
    }

    const context = formatMessagesForPrompt(history);

    const result = await this.chatCompletion([
      { role: 'system', content: PROMPTS.GENERATE_SUGGESTIONS(context, customerName, config) },
      { role: 'user', content: 'Generate 5 reply options for the latest customer message above.' },
    ], 0.7, 1200, config);

    const customerSuggestions = parseSuggestions(result).map(cleanPlaceholders);
    while (customerSuggestions.length < 5) {
      customerSuggestions.push(await this.translate('Thank you for your message. I will get back to you shortly.', 'to_customer', config).catch(() => 'Thank you for your message. I will get back to you shortly.'));
    }

    const userTranslations = await Promise.all(
      customerSuggestions.map(reply => this.translate(reply, 'to_user', config).catch(() => '[Translation failed]'))
    );

    return customerSuggestions.map((reply, i) => ({ en: reply, zh: userTranslations[i] }));
  },

  async generateCustomReply(userPrompt, history, customerName, config) {
    const context = formatMessagesForPrompt(history);
    const enResult = await this.chatCompletion([
      { role: 'system', content: PROMPTS.GENERATE_CUSTOM(userPrompt, context, customerName, config) },
      { role: 'user', content: 'Generate a reply based on the instruction above.' },
    ], 0.7, 800, config);

    const en = cleanPlaceholders(enResult.trim());
    const zh = await this.translate(en, 'to_user', config).catch(() => '[Translation failed]');

    return { en, zh };
  },

  async processIncomingMessage(msg, history, config) {
    const translationPromise = this.translate(msg.body, 'to_user', config);
    const convo = await Storage.getConversations();
    const customerName = convo[msg.chatId]?.name || '';
    const suggestionsPromise = this.generateSuggestions(history, customerName, config);

    const [translation, suggestions] = await Promise.all([
      translationPromise,
      suggestionsPromise,
    ]);

    return { translation, suggestions };
  },
};

// ============================================================
// Prompt Templates
// ============================================================

const PROMPTS = {
  TRANSLATE_TO_USER(config) {
    const targetLanguage = getLanguageName(config.userNativeLang);
    return `You are a professional business translator specializing in international trade and B2B communications.

Translate the following message into ${targetLanguage}. Follow these rules strictly:

1. Preserve ALL business terminology, product names, brand names, and proper nouns in their original form
2. Keep ALL numbers, prices, dates, URLs, and email addresses exactly as-is
3. Maintain the original tone: formal stays formal, casual stays casual
4. If the message is already in ${targetLanguage}, return it unchanged
5. Return ONLY the translation text - no explanations, no notes, no prefixes`;
  },

  TRANSLATE_TO_CUSTOMER(config) {
    const sourceLanguage = getLanguageName(config.userNativeLang);
    const targetLanguage = getLanguageName(config.customerLang);
    return `You are a professional business translator specializing in international trade and B2B communications.

Translate the following message from ${sourceLanguage} into polished, professional ${targetLanguage} suitable for B2B customer communication. Follow these rules strictly:

1. Use natural, fluent business ${targetLanguage} - not literal/word-for-word translation
2. Maintain a warm yet professional tone appropriate for customer relationships
3. Preserve ALL numbers, prices, dates, product names, and proper nouns exactly
4. If the source message contains foreign words, SKU codes, product names, or industry terms, keep them when appropriate
5. Return ONLY the translation text - no explanations, no notes, no prefixes`;
  },

  GENERATE_SUGGESTIONS(context, customerName, config) {
    const targetLanguage = getLanguageName(config.customerLang);
    return `You are a senior B2B sales professional with 15 years of experience in international trade. You write natural, human-sounding messages that build genuine relationships — never stiff or robotic.

Based on the customer's latest message and the conversation context below, generate 5 distinct reply options in ${targetLanguage}.

=== CONVERSATION CONTEXT ===
${context}
=== END CONTEXT ===

Each option MUST follow a clearly different tone:

- **Option 1 [Professional]**: Confident, knowledgeable tone. Demonstrates expertise without being stiff.
- **Option 2 [Friendly]**: Warm, natural, conversational. Like talking to someone you have a good working relationship with.
- **Option 3 [Closing]**: Proactive, action-oriented. Guides toward a concrete next step.
- **Option 4 [Detailed]**: Thorough, informative. Provides specifics and next-step information.
- **Option 5 [Concise]**: Short, direct, to the point. 1-2 sentences max.

CRITICAL RULES:
- Each option MUST be 2-4 sentences (except Option 5: 1-2 sentences)
- Write like a real human, NOT a template. Use contractions naturally.
- NEVER use brackets, placeholders, or fill-in-the-blanks like [Name], [Company], etc.
- NEVER use the customer's name or any greeting with their name.
- NEVER invent prices, dates, specifications, or facts not present in the context.
- NEVER be pushy, aggressive, or overly salesy.

FORMAT YOUR RESPONSE EXACTLY AS FOLLOWS:

---OPTION_1---
[Professional reply text here]
---OPTION_2---
[Friendly reply text here]
---OPTION_3---
[Closing reply text here]
---OPTION_4---
[Detailed reply text here]
---OPTION_5---
[Concise reply text here]`;
  },

  GENERATE_CUSTOM(userPrompt, context, customerName, config) {
    const targetLanguage = getLanguageName(config.customerLang);
    return `You are a senior B2B sales professional with 15 years of experience in international trade.

=== USER'S INSTRUCTION ===
${userPrompt}
=== END INSTRUCTION ===

=== CONVERSATION CONTEXT ===
${context}
=== END CONTEXT ===

Craft a natural, polished reply in ${targetLanguage} based on the user's instruction and context.

RULES:
- Write like a real person, not a robot.
- NEVER use the customer's name.
- Incorporate all points from the user's instruction.
- Keep it concise: 3-5 sentences ideal.
- NEVER use brackets, placeholders, or fill-in-the-blanks.
- NEVER invent facts not in the instruction or context.
- Return ONLY the reply text — no explanations, no prefixes.`;
  },
};

// ============================================================
// Helpers
// ============================================================

function formatMessagesForPrompt(messages) {
  return messages.map(msg => {
    const role = msg.fromMe ? 'You' : 'Customer';
    return `${role}: ${msg.body}`;
  }).join('\n');
}

function parseSuggestions(raw) {
  const options = [];
  const matches = raw.match(/---OPTION_(\d)---\s*([\s\S]*?)(?=---OPTION_\d---|$)/g);
  if (matches) {
    for (const match of matches) {
      const text = match.replace(/---OPTION_\d---\s*/, '').trim();
      if (text) options.push(text);
    }
  }
  if (options.length === 0) {
    return raw.split(/\n\n+/).filter(p => p.trim().length > 0).slice(0, 5);
  }
  return options.slice(0, 5);
}

function cleanPlaceholders(text) {
  return text
    .replace(/\[.*?\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/\.\s*\./g, '.')
    .replace(/^\s*,/, '')
    .replace(/,\s*$/, '')
    .replace(/Hi\s+,/g, 'Hi,')
    .replace(/Hello\s+,/g, 'Hello,')
    .trim();
}

// ============================================================
// Message Processing Pipeline
// ============================================================

async function handleNewMessage(msg) {
  await saveMessage(msg);

  broadcastToSidepanel('new_message', {
    ...msg,
    translation: null,
    suggestions: [],
  });
}

async function saveMessage(msg) {
  const convos = await Storage.getConversations();
  if (!convos[msg.chatId]) {
    convos[msg.chatId] = {
      chatId: msg.chatId,
      name: msg.contactName || 'Unknown',
      number: msg.contactNumber || '',
      lastActivity: msg.timestamp,
    };
  }
  convos[msg.chatId].lastActivity = msg.timestamp;
  if (msg.contactName) convos[msg.chatId].name = msg.contactName;
  await Storage.setConversations(convos);

  const messages = await Storage.getMessages(msg.chatId);
  const existingIdx = messages.findIndex(m => m.messageId === msg.messageId);
  const msgObj = {
    messageId: msg.messageId,
    fromMe: msg.fromMe || false,
    body: msg.body || '',
    timestamp: msg.timestamp,
    type: msg.type || 'chat',
    isVoice: msg.isVoice || false,
  };

  if (existingIdx >= 0) {
    messages[existingIdx] = msgObj;
  } else {
    messages.push(msgObj);
  }
  messages.sort((a, b) => a.timestamp - b.timestamp);
  await Storage.setMessages(msg.chatId, messages);
}

// ============================================================
// Sidepanel Communication
// ============================================================

let sidepanelPort = null;
let whatsAppStoreReady = false;
const pendingOpenChats = new Map();

function broadcastToSidepanel(type, data) {
  if (sidepanelPort) {
    try {
      sidepanelPort.postMessage({ type, data });
    } catch (e) {
      sidepanelPort = null;
    }
  }
}

// ============================================================
// Event Handlers
// ============================================================

chrome.runtime.onConnect.addListener((port) => {
  console.log('[wasap-bg] Port connected:', port.name, 'from tab:', port.sender?.tab?.id);
  if (port.name === 'sidepanel') {
    sidepanelPort = port;
    port.onDisconnect.addListener(() => {
      console.log('[wasap-bg] Sidepanel port disconnected');
      if (sidepanelPort === port) sidepanelPort = null;
    });
    port.onMessage.addListener(async (msg) => {
      console.log('[wasap-bg] Sidepanel command:', msg.action);
      try {
        await handleSidepanelCommand(msg);
      } catch (e) {
        console.error('[wasap-bg] Error handling command', msg.action, ':', e);
        sidepanelPort?.postMessage({ type: 'error', data: { message: e.message } });
      }
    });

    if (whatsAppStoreReady) {
      port.postMessage({ type: 'whatsapp_ready', data: {} });
      sendToPage('get_chats', {});
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.source === 'content-script' && message.type === 'content_ready') {
    console.log('[wasap-bg] Content script ready');
    sendResponse({ ok: true });
    return;
  }

  if (message.source === 'page-script') {
    handlePageEvent(message.type, message.data).catch(e => {
      console.error('[wasap-bg] Unhandled page event error:', e);
    });
    sendResponse({ ok: true });
  }

  // Popup messages (license validation, etc.)
  if (message.source === 'popup') {
    handlePopupMessage(message.action, message.params).then(result => {
      sendResponse(result);
    }).catch(e => {
      sendResponse({ valid: false, reason: e.message });
    });
    return true; // keep channel open for async response
  }
  return false;
});

// ============================================================
// Page Event Handler
// ============================================================

async function handlePageEvent(type, data) {
  console.log('[wasap-bg] handlePageEvent:', type);
  switch (type) {
    case 'ready':
      console.log('[wasap-bg] WhatsApp Web Store ready');
      whatsAppStoreReady = true;
      broadcastToSidepanel('whatsapp_ready', {});
      sendToPage('get_chats', {});
      break;

    case 'monitoring_started':
      console.log('[wasap-bg] Message monitoring started');
      break;

    case 'new_message':
      console.log('[wasap-bg] New message:', data.chatId, data.body?.substring(0, 40));
      await handleNewMessage(data);
      sendToPage('get_chats', {});
      break;

    case 'message_updated':
      console.log('[wasap-bg] Message updated:', data.messageId);
      break;

    case 'active_chat_changed':
      console.log('[wasap-bg] Active chat changed:', data.chatId);
      if (data.chatId && data.chat) {
        const convos = await Storage.getConversations();
        if (!convos[data.chatId]) {
          convos[data.chatId] = {
            chatId: data.chatId,
            name: data.chat.name,
            number: data.chat.number,
            lastActivity: data.chat.timestamp,
            isGroup: data.chat.isGroup,
          };
          await Storage.setConversations(convos);
        }
      }
      broadcastToSidepanel('active_chat_changed', data);
      break;

    case 'chat_opened':
      pendingOpenChats.delete(data.chatId);
      broadcastToSidepanel('chat_opened', data);
      break;

    case 'open_chat_error':
      console.warn('[wasap-bg] Open chat failed:', data.message);
      if (data.chatId && pendingOpenChats.has(data.chatId)) {
        const pending = pendingOpenChats.get(data.chatId);
        if (!pending.triedFallback) {
          pending.triedFallback = true;
          pendingOpenChats.set(data.chatId, pending);
          const phone = pending.number
            ? String(pending.number).replace(/\D/g, '')
            : data.chatId?.endsWith('@c.us')
              ? String(data.chatId).replace('@c.us', '').replace(/\D/g, '')
              : '';
          if (phone) {
            sendToPage('open_chat_url', { chatId: data.chatId, phone });
            pendingOpenChats.delete(data.chatId);
            break;
          }
        }
        pendingOpenChats.delete(data.chatId);
      }
      broadcastToSidepanel('open_chat_error', data);
      break;

    case 'chats_list':
      console.log('[wasap-bg] Received', data.chats?.length, 'chats');
      const convos = await Storage.getConversations();
      for (const chat of (data.chats || [])) {
        if (!convos[chat.chatId]) {
          convos[chat.chatId] = {
            chatId: chat.chatId,
            name: chat.name,
            number: chat.number,
            lastActivity: chat.timestamp,
            isGroup: chat.isGroup,
          };
        } else {
          convos[chat.chatId].name = chat.name || convos[chat.chatId].name;
          convos[chat.chatId].number = chat.number || convos[chat.chatId].number;
          convos[chat.chatId].lastActivity = chat.timestamp || convos[chat.chatId].lastActivity;
        }
      }
      await Storage.setConversations(convos);
      broadcastToSidepanel('chats_list', { chats: data.chats });
      break;

    case 'messages_list':
      console.log('[wasap-bg] Received', data.messages?.length, 'messages for', data.chatId);
      for (const msg of (data.messages || [])) {
        const existing = await Storage.getTranslation(msg.messageId);
        broadcastToSidepanel('message_loaded', {
          ...msg,
          translation: existing,
        });
      }
      break;

    case 'send_success':
      console.log('[wasap-bg] Message sent:', data.chatId);
      const sentMsg = {
        messageId: `sent_${Date.now()}`,
        chatId: data.chatId,
        fromMe: true,
        body: data.text,
        timestamp: Math.floor(Date.now() / 1000),
      };
      await saveMessage(sentMsg);
      broadcastToSidepanel('message_sent', sentMsg);
      break;

    case 'send_error':
      console.error('[wasap-bg] Send error:', data.message);
      broadcastToSidepanel('send_error', data);
      break;

    case 'error':
      console.error('[wasap-bg] Page error:', data.message);
      broadcastToSidepanel('error', data);
      break;

    case 'voice_audio_data':
      console.log('[wasap-bg] Voice audio received for', data.messageId, '(Pro feature — not available in free version)');
      break;

    case 'voice_download_error':
      console.error('[wasap-bg] Voice download error:', data.messageId, data.error);
      break;

    case 'store_timeout':
      console.error('[wasap-bg] Store timeout after', data.elapsed, 'ms');
      broadcastToSidepanel('store_timeout', data);
      break;

    default:
      console.log('[wasap-bg] Unknown page event:', type);
  }
}

function sendToPage(action, params) {
  console.log('[wasap-bg] sendToPage:', action, params);
  chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
    console.log('[wasap-bg] sendToPage: found', tabs.length, 'WhatsApp tabs');
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        source: 'background',
        action,
        params,
      }).then((response) => {
        console.log('[wasap-bg] sendToPage response for tab', tab.id, ':', response);
      }).catch((e) => {
        console.log('[wasap-bg] sendToPage failed for tab', tab.id, ':', e.message);
      });
    }
  });
}

async function openWhatsAppChatTab(chatId, number = '', options = {}) {
  const phone = number
    ? String(number).replace(/\D/g, '')
    : chatId?.endsWith('@c.us')
      ? String(chatId).replace('@c.us', '').replace(/\D/g, '')
      : '';
  const allTabs = await chrome.tabs.query({});
  const tabs = allTabs.filter(tab => {
    try {
      return new URL(tab.url || '').hostname === 'web.whatsapp.com';
    } catch {
      return false;
    }
  });

  if (!phone) {
    sidepanelPort?.postMessage({
      type: 'open_chat_error',
      data: {
        chatId,
        hasNumber: !!number,
        message: `No phone number available for ${chatId}; falling back to WhatsApp Store open`,
      },
    });
    return false;
  }

  const url = `https://web.whatsapp.com/send?phone=${phone}`;
  if (!tabs.length) {
    const tab = await chrome.tabs.create({ url, active: true });
    sidepanelPort?.postMessage({
      type: 'chat_opened',
      data: { chatId, method: 'tab_create_url', phone, tabId: tab.id },
    });
    return true;
  }

  if (!options.updateExisting) return false;

  const targetTab = tabs.find(tab => tab.active) || tabs[0];
  if (targetTab.windowId) {
    await chrome.windows.update(targetTab.windowId, { focused: true }).catch(() => {});
  }
  await chrome.tabs.update(targetTab.id, { active: true });
  sendToPage('open_chat_url', { chatId, phone });
  sidepanelPort?.postMessage({
    type: 'chat_opened',
    data: { chatId, method: 'page_url_fallback', phone, tabId: targetTab.id },
  });
  return true;
}

// ============================================================
// Popup Message Handler (short-lived connection)
// ============================================================

async function handlePopupMessage(action, params = {}) {
  console.log('[wasap-bg] handlePopupMessage:', action);
  switch (action) {
    case 'validate_license': {
      const { licenseKey, email } = params;
      console.log('[wasap-bg] validate_license called, email:', email, 'keyLen:', licenseKey ? licenseKey.length : 0);
      const result = await validateLicenseKey(licenseKey, email);
      console.log('[wasap-bg] validate_license result:', JSON.stringify(result));
      return result;
    }
    default:
      return { valid: false, reason: 'Unknown action: ' + action };
  }
}

// ============================================================
// Sidepanel Command Handler
// ============================================================

async function handleSidepanelCommand(msg) {
  const { action, params = {} } = msg;

  switch (action) {
    case 'get_config': {
      const config = await Storage.getConfig();
      const pro = await isPro(config);
      const quota = await checkQuota(config);
      console.log('[wasap-bg] get_config: API key configured:', !!config.llm.apiKey, 'Pro:', pro);
      sidepanelPort?.postMessage({ type: 'config', data: {
        ...config,
        llm: { ...config.llm, apiKey: config.llm.apiKey ? '***' : '' },
        isPro: pro,
        dailyUsage: await getDailyUsage(),
        quota: quota,
        freeLimit: FREE_LIMIT,
      }});
      break;
    }

    case 'update_config': {
      await Storage.setConfig(params);
      sidepanelPort?.postMessage({ type: 'config_updated', data: params });
      break;
    }

    case 'validate_license': {
      const { licenseKey, email } = params;
      if (!licenseKey || !email) {
        sidepanelPort?.postMessage({ type: 'license_result', data: { valid: false, reason: 'License key and email are required.' } });
        return;
      }
      const result = await validateLicenseKey(licenseKey, email);
      if (result.valid) {
        // Save to config
        const config = await Storage.getConfig();
        config.licenseKey = licenseKey;
        config.licenseEmail = email;
        await Storage.setConfig(config);
      }
      sidepanelPort?.postMessage({ type: 'license_result', data: result });
      break;
    }

    case 'get_quota': {
      const config = await Storage.getConfig();
      const quota = await checkQuota(config);
      sidepanelPort?.postMessage({ type: 'quota_info', data: quota });
      break;
    }

    case 'get_chats': {
      const chats = await Storage.getActiveChats(params.limit || 50);
      console.log('[wasap-bg] get_chats: returning', chats.length, 'chats from storage');
      sidepanelPort?.postMessage({ type: 'chats_list', data: { chats } });
      sendToPage('get_chats', {});
      break;
    }

    case 'get_messages': {
      const { chatId, limit = 50 } = params;
      const messages = await Storage.getMessages(chatId);
      const recent = messages.slice(-limit);
      const withTranslations = await Promise.all(
        recent.map(async (msg) => {
          const translation = await Storage.getTranslation(msg.messageId);
          const suggestions = await Storage.getSuggestions(msg.messageId);
          return { ...msg, translation, suggestions };
        })
      );
      sidepanelPort?.postMessage({ type: 'messages_list', data: { chatId, messages: withTranslations } });
      sendToPage('get_messages', { chatId, limit });
      break;
    }

    case 'open_chat': {
      const { chatId, number } = params;
      const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
      if (tabs.length) {
        pendingOpenChats.set(chatId, { number, ts: Date.now(), triedFallback: false });
        sendToPage('open_chat', params);
        break;
      }
      await openWhatsAppChatTab(chatId, number);
      break;
    }

    case 'send_message': {
      sendToPage('send_message', params);
      break;
    }

    case 'sidebar_back': {
      sendToPage('sidebar_back', {});
      break;
    }

    case 'send_translated': {
      const { chatId, text } = params;
      const config = await Storage.getConfig();
      if (!config.llm.apiKey) {
        sidepanelPort?.postMessage({ type: 'send_error', data: { message: 'No API key configured' } });
        return;
      }
      // Check quota
      const quota = await checkQuota(config);
      if (!quota.allowed) {
        sidepanelPort?.postMessage({ type: 'send_error', data: { message: quota.message } });
        return;
      }
      try {
        const enText = await AI.translate(text, 'to_customer', config);
        await incrementDailyUsage();
        sendToPage('send_message', { chatId, text: enText });
        const sentMsg2 = {
          messageId: 'sent_' + Date.now(),
          chatId,
          fromMe: true,
          body: enText,
          timestamp: Math.floor(Date.now() / 1000),
        };
        await saveMessage(sentMsg2);
        broadcastToSidepanel('message_sent', sentMsg2);
        // Broadcast updated quota
        const updatedQuota = await checkQuota(config);
        broadcastToSidepanel('quota_info', updatedQuota);
      } catch (e) {
        sidepanelPort?.postMessage({ type: 'send_error', data: { message: 'Translation failed: ' + e.message } });
      }
      break;
    }

    case 'translate_message': {
      const { messageId, body, direction } = params;
      const config = await Storage.getConfig();
      if (!config.llm.apiKey) {
        sidepanelPort?.postMessage({ type: 'translate_error', data: { messageId, error: 'No API key configured' } });
        return;
      }
      // Check quota
      const quota = await checkQuota(config);
      if (!quota.allowed) {
        sidepanelPort?.postMessage({ type: 'translate_error', data: { messageId, error: quota.message } });
        return;
      }
      try {
        // Use direction param if provided; default to 'to_user' for normal messages,
        // 'to_customer' for modal/AI temp translations
        const translateDirection = direction || 'to_user';
        const translation = await AI.translate(body, translateDirection, config);
        await incrementDailyUsage();
        if (messageId !== 'modal_temp' && messageId !== 'ai_temp') {
          await Storage.setTranslation(messageId, translation);
        }
        sidepanelPort?.postMessage({ type: 'translation_ready', data: { messageId, translation } });
        // Broadcast updated quota
        const updatedQuota = await checkQuota(config);
        broadcastToSidepanel('quota_info', updatedQuota);
      } catch (e) {
        sidepanelPort?.postMessage({ type: 'translate_error', data: { messageId, error: e.message } });
      }
      break;
    }

    case 'generate_suggestions': {
      const { chatId, messageId, body } = params;
      const config = await Storage.getConfig();
      if (!config.llm.apiKey) {
        sidepanelPort?.postMessage({ type: 'suggestions_error', data: { messageId, error: 'No API key configured' } });
        return;
      }
      // Check quota
      const quota = await checkQuota(config);
      if (!quota.allowed) {
        sidepanelPort?.postMessage({ type: 'suggestions_error', data: { messageId, error: quota.message } });
        return;
      }
      try {
        const history = await Storage.getMessages(chatId);
        const recentHistory = history.slice(-config.contextWindow);
        const convos = await Storage.getConversations();
        const customerName = convos[chatId]?.name || '';
        const suggestions = await AI.generateSuggestions(recentHistory, customerName, config);
        await incrementDailyUsage();
        await Storage.setSuggestions(messageId, suggestions);
        sidepanelPort?.postMessage({ type: 'suggestions_ready', data: { messageId, suggestions } });
        // Broadcast updated quota
        const updatedQuota = await checkQuota(config);
        broadcastToSidepanel('quota_info', updatedQuota);
      } catch (e) {
        sidepanelPort?.postMessage({ type: 'suggestions_error', data: { messageId, error: e.message } });
      }
      break;
    }

    case 'custom_reply': {
      const { chatId, prompt, history } = params;
      const config = await Storage.getConfig();
      if (!config.llm.apiKey) {
        sidepanelPort?.postMessage({ type: 'custom_reply_error', data: { error: 'No API key configured' } });
        return;
      }
      // Check quota
      const quota = await checkQuota(config);
      if (!quota.allowed) {
        sidepanelPort?.postMessage({ type: 'custom_reply_error', data: { error: quota.message } });
        return;
      }
      try {
        const convos = await Storage.getConversations();
        const customerName = convos[chatId]?.name || '';
        const result = await AI.generateCustomReply(prompt, history || [], customerName, config);
        await incrementDailyUsage();
        sidepanelPort?.postMessage({ type: 'custom_reply_ready', data: result });
        // Broadcast updated quota
        const updatedQuota = await checkQuota(config);
        broadcastToSidepanel('quota_info', updatedQuota);
      } catch (e) {
        sidepanelPort?.postMessage({ type: 'custom_reply_error', data: { error: e.message } });
      }
      break;
    }

    case 'test_llm': {
      const config = await Storage.getConfig();
      try {
        const result = await AI.chatCompletion([
          { role: 'user', content: 'Reply with just the word "OK".' }
        ], 0, 20, config);
        sidepanelPort?.postMessage({ type: 'llm_test_result', data: { ok: true, reply: result } });
      } catch (e) {
        sidepanelPort?.postMessage({ type: 'llm_test_result', data: { ok: false, error: e.message } });
      }
      break;
    }

    case 'mark_read': {
      sendToPage('mark_read', params);
      break;
    }

    default:
      console.warn('[wasap-bg] Unknown sidepanel command:', action);
  }
}

// ============================================================
// Install/Update Handler
// ============================================================

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[wasap-bg] Extension installed');
    Storage.setConfig(DEFAULT_CONFIG);
  } else if (details.reason === 'update') {
    console.log('[wasap-bg] Extension updated');
  }
});

// When service worker starts, check for existing WhatsApp Web tabs and open side panel
(async function init() {
  console.log('[wasap-bg] Service worker initializing...');

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'open-sidepanel',
      title: 'Open AI Sales Copilot',
      contexts: ['page'],
      documentUrlPatterns: ['https://web.whatsapp.com/*'],
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'open-sidepanel' && tab) {
      chrome.sidePanel.open({ tabId: tab.id }).catch(e => {
        console.log('[wasap-bg] Context menu side panel open failed:', e.message);
      });
    }
  });
})();

console.log('[wasap-bg] Service worker started');
