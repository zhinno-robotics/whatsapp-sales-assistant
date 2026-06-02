/**
 * background.js — Service Worker
 * AI calls, chrome.storage management, message routing.
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
};

// ============================================================
// Storage Manager (chrome.storage.local)
// ============================================================

const Storage = {
  async getConfig() {
    const result = await chrome.storage.local.get('config');
    return { ...DEFAULT_CONFIG, ...result.config };
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
    // Trim old messages (keep last 200)
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
      ? PROMPTS.TRANSLATE_TO_USER
      : PROMPTS.TRANSLATE_TO_CUSTOMER;

    const result = await this.chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ], 0.2, 800, config);

    return result;
  },

  async generateSuggestions(history, customerName, config) {
    if (history.length === 0) {
      return [
        { en: 'Thank you for reaching out! How can I assist you today?', zh: '感谢您联系我们！请问有什么可以帮您的？' },
        { en: 'Hi! Thanks for your message. What can I help you with?', zh: '您好！感谢您的消息，请问需要什么帮助？' },
        { en: 'Hello! I appreciate you contacting us. What would you like to discuss?', zh: '您好！感谢您联系我们，想讨论什么内容呢？' },
        { en: 'Thanks for getting in touch. Let me know what you need and I will get right on it.', zh: '感谢联系。请告诉我您的需求，我马上处理。' },
        { en: 'Hi there! How can I help?', zh: '您好！需要什么帮助？' },
      ];
    }

    const context = formatMessagesForPrompt(history);

    const result = await this.chatCompletion([
      { role: 'system', content: PROMPTS.GENERATE_SUGGESTIONS(context, customerName) },
      { role: 'user', content: 'Generate 5 reply options for the latest customer message above.' },
    ], 0.7, 1200, config);

    const enSuggestions = parseSuggestions(result).map(cleanPlaceholders);
    while (enSuggestions.length < 5) {
      enSuggestions.push('Thank you for your message. I will get back to you shortly.');
    }

    // Translate to user's native language in parallel
    const zhTranslations = await Promise.all(
      enSuggestions.map(en => this.translate(en, 'to_user', config).catch(() => '[翻译失败]'))
    );

    return enSuggestions.map((en, i) => ({ en, zh: zhTranslations[i] }));
  },

  async generateCustomReply(userPrompt, history, customerName, config) {
    const context = formatMessagesForPrompt(history);
    const enResult = await this.chatCompletion([
      { role: 'system', content: PROMPTS.GENERATE_CUSTOM(userPrompt, context, customerName) },
      { role: 'user', content: 'Generate a reply based on the instruction above.' },
    ], 0.7, 800, config);

    const en = cleanPlaceholders(enResult.trim());
    const zh = await this.translate(en, 'to_user', config).catch(() => '[翻译失败]');

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
  TRANSLATE_TO_USER: `You are a professional business translator specializing in international trade and B2B communications.

Translate the following message into Chinese (Simplified). Follow these rules strictly:

1. Preserve ALL business terminology, product names, brand names, and proper nouns in their original form
2. Keep ALL numbers, prices, dates, URLs, and email addresses exactly as-is
3. Maintain the original tone: formal stays formal, casual stays casual
4. If the message is already in Chinese, return it unchanged
5. Return ONLY the translation text — no explanations, no notes, no prefixes`,

  TRANSLATE_TO_CUSTOMER: `You are a professional business translator specializing in international trade and B2B communications.

Translate the following message from Chinese into polished, professional English suitable for B2B customer communication. Follow these rules strictly:

1. Use natural, fluent business English — not literal/word-for-word translation
2. Maintain a warm yet professional tone appropriate for customer relationships
3. Preserve ALL numbers, prices, dates, product names, and proper nouns exactly
4. If the source message contains English words or terms, keep them in the translation
5. Return ONLY the translation text — no explanations, no notes, no prefixes`,

  GENERATE_SUGGESTIONS(context, customerName) {
    return `You are a senior B2B sales professional with 15 years of experience in international trade. You write natural, human-sounding messages that build genuine relationships — never stiff or robotic.

Based on the customer's latest message and the conversation context below, generate 5 distinct reply options in English.

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

  GENERATE_CUSTOM(userPrompt, context, customerName) {
    return `You are a senior B2B sales professional with 15 years of experience in international trade.

=== USER'S INSTRUCTION ===
${userPrompt}
=== END INSTRUCTION ===

=== CONVERSATION CONTEXT ===
${context}
=== END CONTEXT ===

Craft a natural, polished reply in English based on the user's instruction and context.

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
  // Save message (no auto-translation — user clicks translate button)
  await saveMessage(msg);

  broadcastToSidepanel('new_message', {
    ...msg,
    translation: null,
    suggestions: [],
  });
}

async function saveMessage(msg) {
  // Update conversation
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

  // Save message
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

// Sidepanel connection
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

    // If WhatsApp Store was already ready before sidepanel connected,
    // re-send the event so the sidepanel knows the connection is alive
    if (whatsAppStoreReady) {
      port.postMessage({ type: 'whatsapp_ready', data: {} });
      // Re-request chat list so sidepanel gets fresh data
      sendToPage('get_chats', {});
    }
  }
});

// Content script messages
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
  return false;
});

// Side panel auto-open — only works in response to user gestures
// Users can open via:
// 1. Right-click on WhatsApp Web → "Open Sales Assistant"
// 2. Click extension icon → popup has "Open Side Panel" button
// 3. Pin the extension and click the icon (if no popup)

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
      // Fetch initial chat list
      sendToPage('get_chats', {});
      break;

    case 'monitoring_started':
      console.log('[wasap-bg] Message monitoring started');
      break;

    case 'new_message':
      console.log('[wasap-bg] New message:', data.chatId, data.body?.substring(0, 40));
      await handleNewMessage(data);
      // Refresh chat list
      sendToPage('get_chats', {});
      break;

    case 'message_updated':
      console.log('[wasap-bg] Message updated:', data.messageId);
      break;

    case 'chats_list':
      console.log('[wasap-bg] Received', data.chats?.length, 'chats');
      // Update conversations in storage
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
          convos[chat.chatId].lastActivity = chat.timestamp || convos[chat.chatId].lastActivity;
        }
      }
      await Storage.setConversations(convos);
      broadcastToSidepanel('chats_list', { chats: data.chats });
      break;

    case 'messages_list':
      console.log('[wasap-bg] Received', data.messages?.length, 'messages for', data.chatId);
      // Save messages to storage
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
      // Save sent message
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
      console.log('[wasap-bg] Voice audio received for', data.messageId, '(not processing in free version)');
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

// ============================================================
// Sidepanel Command Handler
// ============================================================

async function handleSidepanelCommand(msg) {
  const { action, params = {} } = msg;

  switch (action) {
    case 'get_config': {
      const config = await Storage.getConfig();
      console.log('[wasap-bg] get_config: API key configured:', !!config.llm.apiKey);
      sidepanelPort?.postMessage({ type: 'config', data: config });
      break;
    }

    case 'update_config': {
      await Storage.setConfig(params);
      sidepanelPort?.postMessage({ type: 'config_updated', data: params });
      break;
    }

    case 'get_chats': {
      const chats = await Storage.getActiveChats(params.limit || 50);
      console.log('[wasap-bg] get_chats: returning', chats.length, 'chats from storage');
      sidepanelPort?.postMessage({ type: 'chats_list', data: { chats } });
      // Also request fresh data from page
      sendToPage('get_chats', {});
      break;
    }

    case 'get_messages': {
      const { chatId, limit = 50 } = params;
      const messages = await Storage.getMessages(chatId);
      const recent = messages.slice(-limit);

      // Load translations and suggestions for each message
      const withTranslations = await Promise.all(
        recent.map(async (msg) => {
          const translation = await Storage.getTranslation(msg.messageId);
          const suggestions = await Storage.getSuggestions(msg.messageId);
          return { ...msg, translation, suggestions };
        })
      );

      sidepanelPort?.postMessage({ type: 'messages_list', data: { chatId, messages: withTranslations } });
      // Also request from page for fresh data
      sendToPage('get_messages', { chatId, limit });
      break;
    }

    case 'send_message': {
      sendToPage('send_message', params);
      break;
    }

    case 'send_translated': {
      const { chatId, text } = params;
      const config = await Storage.getConfig();
      if (!config.llm.apiKey) {
        sidepanelPort?.postMessage({ type: 'send_error', data: { message: 'No API key configured' } });
        return;
      }
      try {
        const enText = await AI.translate(text, 'to_customer', config);
        sendToPage('send_message', { chatId, text: enText });
        // Cache the sent message immediately so UI updates
        const sentMsg = {
          messageId: 'sent_' + Date.now(),
          chatId,
          fromMe: true,
          body: enText,
          timestamp: Math.floor(Date.now() / 1000),
        };
        await saveMessage(sentMsg);
        broadcastToSidepanel('message_sent', sentMsg);
      } catch (e) {
        sidepanelPort?.postMessage({ type: 'send_error', data: { message: 'Translation failed: ' + e.message } });
      }
      break;
    }

    case 'translate_message': {
      const { messageId, body } = params;
      const config = await Storage.getConfig();
      if (!config.llm.apiKey) {
        sidepanelPort?.postMessage({ type: 'translate_error', data: { messageId, error: 'No API key configured' } });
        return;
      }
      try {
        const translation = await AI.translate(body, 'to_user', config);
        await Storage.setTranslation(messageId, translation);
        sidepanelPort?.postMessage({ type: 'translation_ready', data: { messageId, translation } });
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
      try {
        const history = await Storage.getMessages(chatId);
        const recentHistory = history.slice(-config.contextWindow);
        const convos = await Storage.getConversations();
        const customerName = convos[chatId]?.name || '';
        const suggestions = await AI.generateSuggestions(recentHistory, customerName, config);
        await Storage.setSuggestions(messageId, suggestions);
        sidepanelPort?.postMessage({ type: 'suggestions_ready', data: { messageId, suggestions } });
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
      try {
        const convos = await Storage.getConversations();
        const customerName = convos[chatId]?.name || '';
        const result = await AI.generateCustomReply(prompt, history || [], customerName, config);
        sidepanelPort?.postMessage({ type: 'custom_reply_ready', data: result });
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

  // Remove existing context menu to avoid duplicate (service worker can restart)
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'open-sidepanel',
      title: 'Open Sales Assistant',
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

  // Note: sidePanel.open() requires user gesture, so we can't auto-open on init.
  // Users must click the extension icon or right-click → "Open Sales Assistant".
})();

console.log('[wasap-bg] Service worker started');
