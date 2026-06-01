/**
 * page-script.js — MAIN world script
 * Injected into WhatsApp Web page to access window.Store internals.
 * Communicates with content.js (ISOLATED world) via CustomEvent.
 */

(function () {
  'use strict';

  // Prevent double-injection
  if (window.__WASAP_PAGE_SCRIPT_LOADED) return;
  window.__WASAP_PAGE_SCRIPT_LOADED = true;

  const EVENT_FROM_PAGE = 'wasap:page:event';
  const EVENT_TO_PAGE = 'wasap:page:command';

  /**
   * Dispatch event to content.js (ISOLATED world)
   */
  function emitToContent(type, data) {
    console.log('[wasap-page] Emitting to content:', type, data ? '(has data)' : '');
    window.dispatchEvent(new CustomEvent(EVENT_FROM_PAGE, {
      detail: { type, data: JSON.parse(JSON.stringify(data)) }
    }));
  }

  /**
   * Build WhatsApp Store from Comet module system (WhatsApp Web 2.3000.x+)
   * Old window.Store is no longer exposed; we use require('__debug').modulesMap
   */
  function buildStore() {
    const requireFn = window.require || self.require;
    if (!requireFn) {
      console.log('[wasap-page] No require() function found — trying later');
      return null;
    }

    try {
      // New Comet system: access modules via __debug
      const debug = requireFn('__debug');
      if (!debug || !debug.modulesMap) {
        console.log('[wasap-page] __debug.modulesMap not available');
        return null;
      }

      const modulesMap = debug.modulesMap;
      const waKeys = Object.keys(modulesMap).filter(k => k.includes('WA'));
      console.log('[wasap-page] Found', waKeys.length, 'WA modules in debug.modulesMap');

      // Build module instances
      const modules = {};
      for (const key of waKeys) {
        try {
          const mod = modulesMap[key];
          let instance = mod.defaultExport || mod.factory;
          if (!instance || Object.keys(instance).length === 0) {
            try {
              self.ErrorGuard?.skipGuardGlobal?.(true);
              instance = requireFn(key);
            } catch (e) {
              // Module not loadable
            }
          }
          if (instance) {
            modules[key] = instance;
          }
        } catch (e) {
          // Skip unloadable modules
        }
      }

      console.log('[wasap-page] Loaded', Object.keys(modules).length, 'module instances');

      // Find Chat and Msg collections
      let Chat, Msg, SendMessage, Contact, SendSeen, Cmd;

      for (const [key, mod] of Object.entries(modules)) {
        try {
          // Chat collection
          if (!Chat && mod.Chat && mod.Msg && mod.Contact) {
            Chat = mod.Chat;
            Msg = mod.Msg;
            Contact = mod.Contact;
            console.log('[wasap-page] Found Store module:', key);
          }
          // Chat alone
          if (!Chat && mod.models && mod.models.length > 0) {
            const first = mod.models[0];
            if (first && (first.id?._serialized || first.name || first.pushname)) {
              Chat = mod;
              console.log('[wasap-page] Found Chat collection via models:', key);
            }
          }
          // Msg alone  
          if (!Msg && mod.models && mod.models.length > 0) {
            const first = mod.models[0];
            if (first && (first.body !== undefined || first.t)) {
              Msg = mod;
              console.log('[wasap-page] Found Msg collection via models:', key);
            }
          }
          // SendMessage
          if (!SendMessage && (key.includes('SendMsg') || key.includes('SendMessage'))) {
            SendMessage = mod;
          }
          // SendSeen / Cmd
          if (!SendSeen && key.includes('SendSeen')) SendSeen = mod;
          if (!Cmd && (key.includes('Cmd') || key.includes('Commands'))) Cmd = mod;
        } catch (e) {
          // Skip
        }
      }

      if (Chat && Msg) {
        const store = {
          Chat: Chat,
          Msg: Msg,
          Contact: Contact,
          SendMessage: SendMessage,
          SendSeen: SendSeen,
          Cmd: Cmd,
        };
        console.log('[wasap-page] Store built successfully. Chat models:', Chat.models?.length, 'Msg models:', Msg.models?.length);
        return store;
      }

      console.log('[wasap-page] Store built but missing Chat:', !!Chat, 'Msg:', !!Msg);
      return null;
    } catch (e) {
      console.error('[wasap-page] buildStore error:', e.message);
      return null;
    }
  }

  /**
   * Wait for WhatsApp Web's Store to be ready (supports both old and new WA)
   */
  let localStore = null;

  function waitForStore(callback, timeout = 60000) {
    const start = Date.now();
    const check = () => {
      // Try building store via new Comet method
      if (!localStore) {
        localStore = buildStore();
      }

      // Also check for old-style window.Store
      if (!localStore && window.Store && window.Store.Chat && window.Store.Msg) {
        localStore = window.Store;
        console.log('[wasap-page] Using legacy window.Store');
      }

      if (localStore && localStore.Chat && localStore.Msg) {
        // Override window.Store for compatibility
        if (!window.Store || !window.Store.Chat) {
          window.Store = localStore;
        }
        console.log('[wasap-page] Store ready — Chat models:', localStore.Chat.models?.length, 'Msg models:', localStore.Msg.models?.length);
        callback();
        return;
      }

      if (Date.now() - start < timeout) {
        if ((Date.now() - start) % 5000 < 1000) {
          const hasRequire = !!(window.require || self.require);
          console.log('[wasap-page] Waiting for Store...', (Date.now() - start) / 1000, 's, require:', hasRequire);
        }
        setTimeout(check, 1000);
      } else {
        emitToContent('store_timeout', {
          elapsed: Date.now() - start,
          detail: 'Could not find Chat/Msg modules. Require available: ' + !!(window.require || self.require),
        });
      }
    };
    check();
  }

  // ============================================================
  // WhatsApp Store Helpers
  // ============================================================

  /**
   * Check if a chat ID is a channel/newsletter/broadcast
   */
  function isChannelChat(chatId) {
    if (!chatId) return false;
    return /@newsletter|@broadcast|status@/.test(chatId);
  }

  /**
   * Get contact info from a chat
   */
  function getContactInfo(chat) {
    try {
      const contact = chat.contact || chat.getContact?.();
      if (!contact) return { name: chat.name || chat.pushname || 'Unknown', number: '' };
      return {
        name: contact.name || contact.pushname || contact.shortName || contact.formattedName || 'Unknown',
        number: contact.number || contact.userid || '',
      };
    } catch {
      return { name: chat.name || chat.pushname || 'Unknown', number: '' };
    }
  }

  /**
   * Serialize a message object for transfer
   */
  function serializeMessage(msg) {
    try {
      return {
        chatId: msg.id?.remote?._serialized || msg.chatId || msg.from || '',
        messageId: msg.id?._serialized || `msg_${Date.now()}`,
        body: msg.body || '',
        timestamp: msg.t || msg.timestamp || Math.floor(Date.now() / 1000),
        fromMe: msg.id?.fromMe || msg.fromMe || false,
        type: msg.type || 'chat',
        hasMedia: msg.hasMedia || false,
        isVoice: msg.type === 'ptt' || msg.type === 'audio',
      };
    } catch {
      return null;
    }
  }

  /**
   * Serialize a chat object for transfer
   */
  function serializeChat(chat) {
    try {
      const contactInfo = getContactInfo(chat);
      const lastMsg = chat.lastMessage || (chat.msgs && chat.msgs.models && chat.msgs.models[chat.msgs.models.length - 1]);
      return {
        chatId: chat.id?._serialized || chat.id || '',
        name: contactInfo.name,
        number: contactInfo.number,
        timestamp: chat.t || chat.timestamp || 0,
        unreadCount: chat.unreadCount || chat.pendingMsgs?.length || 0,
        lastMessage: lastMsg ? (lastMsg.body || '') : '',
        isGroup: chat.isGroup || false,
      };
    } catch {
      return null;
    }
  }

  // ============================================================
  // Voice Audio Capture via AudioContext Interception
  // ============================================================
  //
  // msg.downloadMedia() does NOT populate mediaBlob in recent WA Web.
  // Instead, we intercept the AudioContext to capture decrypted audio
  // when the user plays a voice message. WhatsApp's own decryption
  // pipeline feeds the audio to decodeAudioData() — we hook there.

  let pendingVoiceCapture = null; // { messageId, chatId } or null
  let capturedAudioChunks = [];

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (result && typeof result === 'string') {
          resolve(result.split(',')[1]);
        } else {
          reject(new Error('Failed to read blob as base64'));
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function installAudioContextHook() {
    const OrigAudioContext = window.AudioContext || window.webkitAudioContext;
    if (!OrigAudioContext || OrigAudioContext.__wasapHooked) return;
    OrigAudioContext.__wasapHooked = true;

    const origDecodeAudioData = OrigAudioContext.prototype.decodeAudioData;
    OrigAudioContext.prototype.decodeAudioData = function (audioData, successCallback, errorCallback) {
      // If we're waiting for a voice capture and this is an ArrayBuffer
      if (pendingVoiceCapture && audioData instanceof ArrayBuffer) {
        try {
          const wavBlob = encodeWAV(audioData);
          blobToBase64(wavBlob).then(base64 => {
            console.log('[wasap-page] AudioContext: captured', audioData.byteLength, 'bytes of decoded audio');
            emitToContent('voice_audio_data', {
              messageId: pendingVoiceCapture.messageId,
              chatId: pendingVoiceCapture.chatId,
              audioBase64: base64,
              mimeType: 'audio/wav',
              manual: true,
            });
            pendingVoiceCapture = null;
          }).catch(e => {
            console.error('[wasap-page] AudioContext: blobToBase64 failed:', e.message);
            pendingVoiceCapture = null;
          });
        } catch (e) {
          console.error('[wasap-page] AudioContext: encodeWAV failed:', e.message);
          pendingVoiceCapture = null;
        }
      }
      return origDecodeAudioData.call(this, audioData, successCallback, errorCallback);
    };
    console.log('[wasap-page] AudioContext hook installed');
  }

  // Convert raw PCM audio (from decodeAudioData's ArrayBuffer) to WAV blob
  function encodeWAV(arrayBuffer) {
    // decodeAudioData input is already decoded PCM as an AudioBuffer wrapped in ArrayBuffer...
    // Actually, decodeAudioData INPUT is encoded (ogg/mp3), OUTPUT is AudioBuffer.
    // We're hooking the INPUT, so audioData is the encoded/compressed stream.
    // Just wrap it as-is (it's the original ogg/opus).
    return new Blob([arrayBuffer], { type: 'audio/ogg' });
  }

  function setupVoiceCapture(messageId, chatId) {
    pendingVoiceCapture = { messageId, chatId };
    console.log('[wasap-page] Voice capture armed for', messageId);
  }

  // Voice message decrypt cache (raw buffers, no base64 — avoids call stack overflow)
  const voiceCache = new Map();

  function base64ToBytes(b64) {
    const chars = atob(b64);
    const bytes = new Uint8Array(chars.length);
    for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i);
    return bytes;
  }

  // Try one decrypt parameter set
  async function tryDecryptWithParams(encBytes, keyBytes, info, algo, stripMac) {
    try {
      const hkdfKey = await crypto.subtle.importKey('raw', keyBytes, 'HKDF', false, ['deriveBits']);
      const expanded = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(info) },
        hkdfKey, 112 * 8
      );
      const ex = new Uint8Array(expanded);
      const iv = ex.slice(0, 16);
      const cipherKey = ex.slice(16, 48);
      const ciphertext = (stripMac && encBytes.length > 10) ? encBytes.slice(0, encBytes.length - 10) : encBytes;
      const cryptoKey = await crypto.subtle.importKey('raw', cipherKey, algo, false, ['decrypt']);
      const decrypted = await crypto.subtle.decrypt({ name: algo, iv }, cryptoKey, ciphertext);
      console.log('[wasap-page] ✓ Decrypt OK — info:', info, 'algo:', algo, 'output:', decrypted.byteLength, 'bytes');
      return decrypted;
    } catch (e) {
      return null;
    }
  }

  // Try multiple decrypt approaches (WA changes params across versions)
  async function tryDecrypt(encBytes, keyBytes) {
    const attempts = [
      ['WhatsApp Audio Keys', 'AES-CBC', true],
      ['WhatsApp Audio Keys', 'AES-CBC', false],
      ['WhatsApp Audio Keys', 'AES-CTR', true],
      ['WhatsApp Voice Keys', 'AES-CBC', true],
      ['WhatsApp Media Keys', 'AES-CBC', true],
    ];
    for (const [info, algo, stripMac] of attempts) {
      const result = await tryDecryptWithParams(encBytes, keyBytes, info, algo, stripMac);
      if (result) return result;
    }
    return null;
  }

  // Fetch from CDN and decrypt
  async function tryFetchAndDecrypt(msg) {
    const directPath = msg.__x_directPath || msg.directPath || msg.mediaUrl;
    let mediaKey = msg.__x_mediaKey || msg.mediaKey;
    if (!directPath || !mediaKey) return null;

    try {
      let keyBytes;
      if (mediaKey instanceof Uint8Array) keyBytes = mediaKey;
      else if (typeof mediaKey === 'string') keyBytes = base64ToBytes(mediaKey);
      else if (mediaKey.buffer) keyBytes = new Uint8Array(mediaKey.buffer);
      else if (Array.isArray(mediaKey)) keyBytes = new Uint8Array(mediaKey);
      else return null;

      const base = directPath.startsWith('http') ? '' : 'https://mmg.whatsapp.net';
      const url = base + directPath;
      console.log('[wasap-page] CDN fetch:', url.substring(0, 120));
      const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!resp.ok) { console.log('[wasap-page] CDN status:', resp.status); return null; }
      const encBytes = new Uint8Array(await resp.arrayBuffer());
      console.log('[wasap-page] CDN: got', encBytes.length, 'bytes, key:', keyBytes.length, 'bytes');

      // Cache in memory for retry
      voiceCache.set(msg.id?._serialized, {
        encrypted: encBytes,
        keyBytes,
        mimetype: msg.__x_mimetype || msg.mimetype || 'audio/ogg',
        chatId: msg.id?.remote?._serialized || msg.chatId || msg.from,
      });

      const decrypted = await tryDecrypt(encBytes, keyBytes);
      if (decrypted) return new Blob([decrypted], { type: msg.__x_mimetype || msg.mimetype || 'audio/ogg' });
      console.warn('[wasap-page] All decrypt approaches failed');
      return null;
    } catch (e) {
      console.error('[wasap-page] CDN fetch/decrypt error:', e.message);
      return null;
    }
  }

  async function captureVoiceMedia(msg) {
    const chatId = msg.id?.remote?._serialized || msg.chatId || msg.from;
    const messageId = msg.id?._serialized;
    if (!chatId || !messageId) return;

    const blob = await tryFetchAndDecrypt(msg);
    if (blob) {
      const base64 = await blobToBase64(blob);
      emitToContent('voice_audio_data', { messageId, chatId, audioBase64: base64, mimeType: blob.type || 'audio/ogg' });
      return;
    }

    setupVoiceCapture(messageId, chatId);
    console.log('[wasap-page] Decrypt not yet successful — awaiting AudioContext capture');
  }

  async function retryDecryptFromCache(messageId) {
    const cached = voiceCache.get(messageId);
    if (!cached) return null;
    console.log('[wasap-page] Retrying decrypt from cache (' + cached.encrypted.length + ' bytes)');
    const decrypted = await tryDecrypt(cached.encrypted, cached.keyBytes);
    if (decrypted) return new Blob([decrypted], { type: cached.mimetype });
    console.warn('[wasap-page] Retry decrypt still failed');
    return null;
  }

  // ============================================================
  // Message Monitoring
  // ============================================================

  let monitoredMsgIds = new Set();

  function startMessageMonitoring() {
    if (!window.Store) {
      emitToContent('error', { message: 'window.Store not available' });
      return;
    }

    // Find Msg collection with fallback
    let msgCollection = window.Store.Msg;
    if (!msgCollection) {
      for (const key of Object.keys(window.Store)) {
        const val = window.Store[key];
        if (val && typeof val === 'object' && val.models && val.models.length > 0) {
          const first = val.models[0];
          if (first && (first.id?._serialized || first.body !== undefined || first.t)) {
            msgCollection = val;
            console.log('[wasap-page] Found msg collection for monitoring:', key);
            break;
          }
        }
      }
    }

    if (!msgCollection) {
      emitToContent('error', { message: 'Store.Msg not available for monitoring' });
      return;
    }

    // Listen for new messages
    msgCollection.on('add', (msg) => {
      try {
        if (!msg || msg.id?.fromMe) return; // Skip own messages
        if (msg.isNotification || msg.type === 'revoked') return;
        if (msg.type === 'vcard') return;

        const chatId = msg.id?.remote?._serialized || msg.chatId || msg.from;
        if (!chatId || isChannelChat(chatId)) return;

        const msgId = msg.id?._serialized;
        if (msgId && monitoredMsgIds.has(msgId)) return;
        if (msgId) monitoredMsgIds.add(msgId);

        const serialized = serializeMessage(msg);
        if (serialized && (serialized.body || serialized.isVoice)) {
          emitToContent('new_message', serialized);
          if (serialized.isVoice) {
            captureVoiceMedia(msg);
          }
        }
      } catch (e) {
        console.error('[wasap-page] Error processing new message:', e);
      }
    });

    // Also listen for message changes (for media resolution)
    msgCollection.on('change', (msg, change) => {
      try {
        if (!msg || msg.id?.fromMe) return;
        if (change?.body && msg.body) {
          const chatId = msg.id?.remote?._serialized || msg.chatId;
          if (!chatId || isChannelChat(chatId)) return;
          const serialized = serializeMessage(msg);
          if (serialized && serialized.body) {
            emitToContent('message_updated', serialized);
          }
        }
      } catch (e) {
        // Ignore
      }
    });

    emitToContent('monitoring_started', {});
  }

  // ============================================================
  // Command Handler (from content.js)
  // ============================================================

  async function handleCommand(cmd) {
    const { action, params } = cmd;

    switch (action) {
      case 'get_chats': {
        try {
          if (!window.Store) {
            emitToContent('error', { message: 'window.Store not available' });
            return;
          }

          // Try standard Store.Chat first
          let chatCollection = window.Store.Chat;

          // Fallback: search for Chat-like collection in Store
          if (!chatCollection) {
            for (const key of Object.keys(window.Store)) {
              const val = window.Store[key];
              if (val && typeof val === 'object' && val.models && val.models.length > 0) {
                // Check if it looks like a chat collection
                const first = val.models[0];
                if (first && (first.id?._serialized || first.name || first.pushname)) {
                  chatCollection = val;
                  console.log('[wasap-page] Found chat collection via fallback:', key);
                  break;
                }
              }
            }
          }

          // In Comet system, Chat might not have .models — find the actual list
          let chats = chatCollection.models;
          if (!chats) {
            // Try common alternatives
            const altProps = ['_models', 'items', 'list', 'entries', 'data', 'collection'];
            for (const prop of altProps) {
              if (Array.isArray(chatCollection[prop])) {
                chats = chatCollection[prop];
                console.log('[wasap-page] Found chats via .' + prop);
                break;
              }
            }
            // Try iterating if it's iterable (like a Map or Set)
            if (!chats && typeof chatCollection[Symbol.iterator] === 'function') {
              chats = [...chatCollection];
              console.log('[wasap-page] Found chats via iterator');
            }
            // Try Object.values
            if (!chats && typeof chatCollection === 'object') {
              const vals = Object.values(chatCollection).filter(v => v && typeof v === 'object' && (v.id || v.name));
              if (vals.length > 0) {
                chats = vals;
                console.log('[wasap-page] Found chats via Object.values');
              }
            }
            // Last resort: dump properties
            if (!chats) {
              const keys = Object.keys(chatCollection);
              console.log('[wasap-page] Chat object keys:', keys.slice(0, 20).join(', '));
              console.log('[wasap-page] Chat object type:', typeof chatCollection, Array.isArray(chatCollection));
              // Try dumping first few values
              for (const key of keys.slice(0, 3)) {
                console.log('[wasap-page] Chat[' + key + '] type:', typeof chatCollection[key]);
              }
            }
          }

          if (!chats) {
            emitToContent('error', { message: 'Store.Chat available but cannot find chat models list' });
            return;
          }

          console.log('[wasap-page] get_chats: found', chats.length, 'chats');
          const serialized = chats
            .map(serializeChat)
            .filter(c => c && !isChannelChat(c.chatId))
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            .slice(0, 100);
          emitToContent('chats_list', { chats: serialized });
        } catch (e) {
          console.error('[wasap-page] get_chats error:', e);
          emitToContent('error', { message: 'get_chats failed: ' + e.message });
        }
        break;
      }

      case 'get_messages': {
        try {
          const { chatId, limit = 50 } = params;
          if (!window.Store) {
            emitToContent('error', { message: 'window.Store not available' });
            return;
          }

          // Try standard Store.Msg first
          let msgCollection = window.Store.Msg;

          // Fallback: search for Msg-like collection
          if (!msgCollection) {
            for (const key of Object.keys(window.Store)) {
              const val = window.Store[key];
              if (val && typeof val === 'object' && val.models && val.models.length > 0) {
                const first = val.models[0];
                if (first && (first.id?._serialized || first.body !== undefined || first.t)) {
                  msgCollection = val;
                  console.log('[wasap-page] Found msg collection via fallback:', key);
                  break;
                }
              }
            }
          }

          // In Comet system, Msg might not have .models — find the actual list
          let msgsToUse = msgCollection.models;
          if (!msgsToUse) {
            const altProps = ['_models', 'items', 'list', 'entries', 'data', 'collection'];
            for (const prop of altProps) {
              if (Array.isArray(msgCollection[prop])) {
                msgsToUse = msgCollection[prop];
                break;
              }
            }
            if (!msgsToUse && typeof msgCollection[Symbol.iterator] === 'function') {
              msgsToUse = [...msgCollection];
            }
            if (!msgsToUse && typeof msgCollection === 'object') {
              const vals = Object.values(msgCollection).filter(v => v && typeof v === 'object' && v.t !== undefined);
              if (vals.length > 0) msgsToUse = vals;
            }
          }

          if (!msgsToUse) {
            emitToContent('error', { message: 'Store.Msg available but cannot find messages list' });
            return;
          }

          const chatMsgs = msgsToUse
            .filter(m => {
              const mChatId = m.id?.remote?._serialized || m.chatId || m.from;
              return mChatId === chatId;
            })
            .sort((a, b) => (a.t || a.timestamp || 0) - (b.t || b.timestamp || 0))
            .slice(-limit)
            .map(serializeMessage)
            .filter(Boolean);
          emitToContent('messages_list', { chatId, messages: chatMsgs });
        } catch (e) {
          emitToContent('error', { message: 'get_messages failed: ' + e.message });
        }
        break;
      }

      case 'send_message': {
        try {
          const { chatId, text } = params;
          if (!text || !text.trim()) {
            emitToContent('send_error', { chatId, message: 'Empty message' });
            return;
          }

          const chat = window.Store.Chat?.get(chatId);
          if (!chat) {
            emitToContent('send_error', { chatId, message: 'Chat not found: ' + chatId });
            return;
          }

          // Log available SendMessage API surface for debugging
          if (window.Store.SendMessage) {
            const smMethods = Object.keys(window.Store.SendMessage).filter(k => typeof window.Store.SendMessage[k] === 'function');
            console.log('[wasap-page] SendMessage available methods:', smMethods.join(', ') || '(none)');
          }

          // Method 1: addAndSendMsgToChat (legacy WA)
          if (typeof window.Store?.SendMessage?.addAndSendMsgToChat === 'function') {
            try {
              await window.Store.SendMessage.addAndSendMsgToChat(chat, {
                body: text.trim(),
                quotedMsg: undefined,
                quotedMsgStanzaID: undefined,
                quotedParticipant: undefined,
                mentionedJidList: [],
                extraOptions: {},
              });
              emitToContent('send_success', { chatId, text: text.trim() });
              return;
            } catch (e) {
              console.log('[wasap-page] addAndSendMsgToChat failed:', e.message);
            }
          }

          // Method 2: sendTextMessage (newer WA)
          if (typeof window.Store?.SendMessage?.sendTextMessage === 'function') {
            try {
              await window.Store.SendMessage.sendTextMessage(chat, text.trim());
              emitToContent('send_success', { chatId, text: text.trim() });
              return;
            } catch (e) {
              console.log('[wasap-page] sendTextMessage failed:', e.message);
            }
          }

          // Method 3: WWebJS.sendMessage
          if (window.WWebJS && typeof window.WWebJS.sendMessage === 'function') {
            try {
              await window.WWebJS.sendMessage(chat, text.trim());
              emitToContent('send_success', { chatId, text: text.trim() });
              return;
            } catch (e) {
              console.log('[wasap-page] WWebJS.sendMessage failed:', e.message);
            }
          }

          // Method 4: DOM-based input (most reliable fallback)
          sendViaInput(chatId, text.trim());
        } catch (e) {
          emitToContent('send_error', { message: 'send_message failed: ' + e.message });
        }
        break;
      }

      case 'get_contact': {
        try {
          const { chatId } = params;
          const chat = window.Store.Chat?.get(chatId);
          if (chat) {
            const info = getContactInfo(chat);
            emitToContent('contact_info', { chatId, ...info });
          } else {
            emitToContent('error', { message: 'Chat not found: ' + chatId });
          }
        } catch (e) {
          emitToContent('error', { message: 'get_contact failed: ' + e.message });
        }
        break;
      }

      case 'transcribe_voice': {
        try {
          const { chatId, messageId } = params;
          let msg = null;

          // Search all Msg collections we can find
          const searchSources = [];

          // Source 1: global Msg.models
          const globalModels = window.Store.Msg?.models;
          if (Array.isArray(globalModels)) searchSources.push({ name: 'Msg.models', msgs: globalModels });

          // Source 2: Msg as iterable/object
          const msgColl = window.Store.Msg;
          if (msgColl && !Array.isArray(globalModels)) {
            if (typeof msgColl[Symbol.iterator] === 'function') {
              searchSources.push({ name: 'Msg(iter)', msgs: [...msgColl] });
            } else if (typeof msgColl === 'object') {
              searchSources.push({ name: 'Msg(obj)', msgs: Object.values(msgColl) });
            }
          }

          // Source 3: target chat's messages
          const chat = window.Store.Chat?.get(chatId);
          if (chat) {
            const raw = chat.msgs;
            let chatMsgs = null;
            if (raw?.models && Array.isArray(raw.models)) chatMsgs = raw.models;
            else if (Array.isArray(raw)) chatMsgs = raw;
            else if (raw && typeof raw === 'object') chatMsgs = Object.values(raw);
            if (chatMsgs) searchSources.push({ name: 'chat.msgs', msgs: chatMsgs });
          }

          // Source 4: all Chat collections — search every chat
          const chatColl = window.Store.Chat;
          if (chatColl) {
            const allChats = Array.isArray(chatColl.models) ? chatColl.models
              : typeof chatColl[Symbol.iterator] === 'function' ? [...chatColl]
              : Object.values(chatColl).filter(v => v && (v.id || v.msgs));
            for (const c of allChats) {
              const raw = c.msgs;
              if (!raw) continue;
              let msgs = null;
              if (raw?.models && Array.isArray(raw.models)) msgs = raw.models;
              else if (Array.isArray(raw)) msgs = raw;
              else if (typeof raw === 'object') msgs = Object.values(raw);
              if (msgs) searchSources.push({ name: 'chat[' + (c.id?._serialized || '?') + '].msgs', msgs });
            }
          }

          console.log('[wasap-page] transcribe_voice: searching', searchSources.length, 'sources for', messageId);
          for (const src of searchSources) {
            const found = src.msgs.find(m => {
              if (!m) return false;
              const mid = m.id?._serialized || m.__x_id || m.key?.id;
              return mid === messageId || String(mid) === String(messageId);
            });
            if (found) {
              msg = found;
              console.log('[wasap-page] Found message in', src.name);
              break;
            }
          }

          if (!msg) {
            console.log('[wasap-page] Message not found:', messageId, '— trying cached encrypted data');
            const blob = await retryDecryptFromCache(messageId);
            if (blob) {
              const base64 = await blobToBase64(blob);
              emitToContent('voice_audio_data', { messageId, chatId, audioBase64: base64, mimeType: blob.type || 'audio/ogg', manual: true });
              return;
            }
            emitToContent('voice_download_error', { messageId, chatId, error: 'Message not found — try playing the voice message first' });
            return;
          }
          await captureVoiceMedia(msg);
        } catch (e) {
          emitToContent('voice_download_error', { messageId: params.messageId, chatId: params.chatId, error: e.message });
        }
        break;
      }

      case 'mark_read': {
        try {
          const { chatId } = params;
          const chat = window.Store.Chat?.get(chatId);
          if (chat && window.Store.SendSeen) {
            window.Store.SendSeen.sendSeen(chat);
          }
        } catch (e) {
          // Ignore mark read errors
        }
        break;
      }

      default:
        console.warn('[wasap-page] Unknown command:', action);
    }
  }

  /**
   * Fallback: send message via DOM input (when Store API fails)
   */
  function sendViaInput(chatId, text) {
    try {
      // First, navigate to the chat by clicking on it in the chat list
      const chat = window.Store.Chat?.get(chatId);
      if (chat) {
        window.Store.Cmd?.openChatAt?.(chat);
      }

      // Wait for input to be ready, then type
      setTimeout(() => {
        const inputEl = document.querySelector('[contenteditable="true"][data-tab="10"]');
        if (!inputEl) {
          emitToContent('send_error', { chatId, message: 'Input element not found' });
          return;
        }

        // Set text via clipboard event (more reliable for React)
        inputEl.focus();
        inputEl.textContent = '';

        // Use InputEvent for React compatibility
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text,
        });
        inputEl.textContent = text;
        inputEl.dispatchEvent(inputEvent);

        // Press Enter to send
        setTimeout(() => {
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            bubbles: true,
          });
          inputEl.dispatchEvent(enterEvent);
          emitToContent('send_success', { chatId, text });
        }, 100);
      }, 500);
    } catch (e) {
      emitToContent('send_error', { chatId, message: 'DOM send failed: ' + e.message });
    }
  }

  // ============================================================
  // Initialization
  // ============================================================

  // Command queue: buffer commands until Store is ready
  let storeReady = false;
  const commandQueue = [];

  // Listen for commands from content.js
  window.addEventListener(EVENT_TO_PAGE, (e) => {
    const cmd = e.detail;
    console.log('[wasap-page] Received command:', cmd.action, 'storeReady:', storeReady);
    if (storeReady) {
      handleCommand(cmd);
    } else {
      // Queue commands that need Store (get_chats, get_messages, send_message, etc.)
      const needsStore = ['get_chats', 'get_messages', 'send_message', 'get_contact', 'mark_read', 'transcribe_voice'];
      if (needsStore.includes(cmd.action)) {
        console.log('[wasap-page] Queueing command:', cmd.action, '(Store not ready yet)');
        commandQueue.push(cmd);
      } else {
        handleCommand(cmd);
      }
    }
  });

  // Wait for Store and start monitoring
  waitForStore(() => {
    storeReady = true;
    console.log('[wasap-page] Store ready, processing', commandQueue.length, 'queued commands');

    // Process queued commands
    for (const cmd of commandQueue) {
      handleCommand(cmd);
    }
    commandQueue.length = 0;

    installAudioContextHook();
    startMessageMonitoring();
    emitToContent('ready', {});
  });

  console.log('[wasap-page] Page script loaded');
})();
