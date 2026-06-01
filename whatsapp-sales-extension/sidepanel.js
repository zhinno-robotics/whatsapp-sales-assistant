/**
 * sidepanel.js — Sidepanel UI logic
 * Communicates with background.js via chrome.runtime.connect (long-lived port).
 */

// ============================================================
// State
// ============================================================

const state = {
  chats: {},           // chatId -> chat info
  messages: {},        // chatId -> [messages]
  activeChat: null,
  showGroups: true,
  isDark: true,
  aiResultEn: '',
  aiResultZh: '',
  modalMsg: null,
  modalSuggestions: [],
  modalSelectedIdx: -1,
  config: null,
};

// ============================================================
// Background Connection
// ============================================================

let bgPort = null;
let connectAttempts = 0;
let reconnectDelay = 1000;
const MAX_CONNECT_ATTEMPTS = 10;
let connectionTimeout = null;

function connectBackground() {
  connectAttempts++;
  const currentDelay = reconnectDelay;
  console.log(`[sidepanel] Connecting to background (attempt ${connectAttempts}, delay ${currentDelay}ms)...`);

  if (bgPort) {
    try { bgPort.disconnect(); } catch (e) { /* ignore */ }
    bgPort = null;
  }
  if (connectionTimeout) clearTimeout(connectionTimeout);

  updateStatus('connecting', 'Connecting...');

  try {
    bgPort = chrome.runtime.connect({ name: 'sidepanel' });
  } catch (e) {
    console.error('[sidepanel] Failed to create port:', e);
    updateStatus('disconnected', 'Connection failed — ' + e.message);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    if (connectAttempts < MAX_CONNECT_ATTEMPTS) {
      setTimeout(connectBackground, reconnectDelay);
    }
    return;
  }

  let handshakeDone = false;

  bgPort.onMessage.addListener((msg) => {
    if (!handshakeDone && (msg.type === 'config' || msg.type === 'chats_list')) {
      handshakeDone = true;
      connectAttempts = 0;
      reconnectDelay = 1000;
      updateStatus('connected', 'WhatsApp Connected');
      clearTimeout(connectionTimeout);
    }
    handleBgMessage(msg);
  });

  bgPort.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;
    console.log('[sidepanel] Port disconnected', err ? `— ${err.message}` : '');
    bgPort = null;
    updateStatus('disconnected', 'Disconnected — reconnecting...');
    if (!handshakeDone) {
      // Never got config — back off
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    } else {
      reconnectDelay = 1500; // Quick retry for established connections
    }
    if (connectAttempts < MAX_CONNECT_ATTEMPTS) {
      setTimeout(connectBackground, reconnectDelay);
    }
  });

  // Request data
  bgPort.postMessage({ action: 'get_config' });
  bgPort.postMessage({ action: 'get_chats', params: {} });
}

function sendToBg(action, params = {}) {
  if (bgPort) {
    bgPort.postMessage({ action, params });
  }
}

// ============================================================
// Background Message Handler
// ============================================================

function handleBgMessage(msg) {
  const { type, data } = msg;

  switch (type) {
    case 'config':
      state.config = data;
      updateStatus('connected', 'WhatsApp Connected');
      clearTimeout(connectionTimeout);
      if (data.userNativeLang === 'zh') {
        document.getElementById('replyInput').placeholder = '输入回复... (Enter 发送，Shift+Enter 换行)';
      }
      break;

    case 'whatsapp_ready':
      updateStatus('connected', 'WhatsApp Connected');
      break;

    case 'chats_list':
      if (data.chats && data.chats.length > 0) {
        for (const chat of data.chats) {
          state.chats[chat.chatId] = chat;
        }
        renderChatList();
        updateStatus('connected', 'WhatsApp Connected');
      }
      break;

    case 'messages_list':
      if (data.messages) {
        data.messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        state.messages[data.chatId] = data.messages;
        if (state.activeChat === data.chatId) {
          renderMessages();
          scrollToBottom();
        }
      }
      break;

    case 'message_loaded':
      // Individual message loaded from page
      if (state.activeChat) {
        const msgs = state.messages[state.activeChat] || [];
        const existing = msgs.find(m => m.messageId === data.messageId);
        if (!existing) {
          msgs.push(data);
          msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          renderMessages();
          scrollToBottom();
        }
      }
      break;

    case 'new_message':
      handleNewMessage(data);
      break;

    case 'message_sent':
      handleSentMessage(data);
      break;

    case 'translation_ready':
      handleTranslationReady(data);
      break;

    case 'suggestions_ready':
      handleSuggestionsReady(data);
      break;

    case 'custom_reply_ready':
      handleCustomReplyReady(data);
      break;

    case 'send_error':
      alert('Send failed: ' + (data.message || 'Unknown error'));
      break;

    case 'error':
      console.error('[sidepanel] Error:', data.message);
      break;

    case 'store_timeout':
      updateStatus('disconnected', 'WhatsApp loading — please wait or refresh the page');
      console.log('[sidepanel] Store timeout detail:', data.detail || '');
      break;

    case 'transcribing':
      if (state.activeChat === data.chatId && state.messages[state.activeChat]) {
        const tmsg = state.messages[state.activeChat].find(m => m.messageId === data.messageId);
        if (tmsg) {
          tmsg._transcribing = true;
          renderMessages();
        }
      }
      break;

    case 'transcription_ready':
      if (state.messages[data.chatId]) {
        const trMsg = state.messages[data.chatId].find(m => m.messageId === data.messageId);
        if (trMsg) {
          trMsg.transcription = data.transcription;
          trMsg._transcribing = false;
          if (state.activeChat === data.chatId) {
            renderMessages();
          }
        }
      }
      break;

    case 'transcription_error':
      if (state.messages[data.chatId]) {
        const teMsg = state.messages[data.chatId].find(m => m.messageId === data.messageId);
        if (teMsg) {
          teMsg._transcribing = false;
          teMsg._transcriptionError = data.error;
          if (state.activeChat === data.chatId) {
            renderMessages();
          }
        }
      }
      break;
  }
}

// ============================================================
// Message Handlers
// ============================================================

function handleNewMessage(msg) {
  // Update chat list
  if (state.chats[msg.chatId]) {
    state.chats[msg.chatId].lastActivity = msg.timestamp;
    state.chats[msg.chatId].lastMessage = msg.body || '[Voice]';
  }

  // Add to messages (avoid duplicates, sort by timestamp)
  if (!state.messages[msg.chatId]) {
    state.messages[msg.chatId] = [];
  }
  const existing = state.messages[msg.chatId].find(m => m.messageId === msg.messageId);
  if (!existing) {
    state.messages[msg.chatId].push(msg);
    state.messages[msg.chatId].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }

  // Re-render if active chat
  if (state.activeChat === msg.chatId) {
    renderMessages();
    scrollToBottom();
  }

  renderChatList();
}

function handleSentMessage(msg) {
  if (!state.messages[msg.chatId]) {
    state.messages[msg.chatId] = [];
  }
  state.messages[msg.chatId].push(msg);
  state.messages[msg.chatId].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  if (state.activeChat === msg.chatId) {
    renderMessages();
    scrollToBottom();
  }
}

function handleTranslationReady(data) {
  // Update message in state
  if (state.activeChat && state.messages[state.activeChat]) {
    const msg = state.messages[state.activeChat].find(m => m.messageId === data.messageId);
    if (msg) {
      msg.translation = data.translation;
      renderMessages();
    }
  }
  // Also update modal if open
  if (state.modalMsg && state.modalMsg.messageId === data.messageId) {
    state.modalMsg.translation = data.translation;
    updateModalTranslation();
  }
}

function handleSuggestionsReady(data) {
  state.modalSuggestions = data.suggestions;
  renderModalSuggestions();
}

function handleCustomReplyReady(data) {
  state.aiResultEn = data.en;
  state.aiResultZh = data.zh;
  document.getElementById('aiResultZh').value = data.zh;
  document.getElementById('aiResultEn').textContent = data.en;
  document.getElementById('aiResultEn').style.display = 'block';
  document.getElementById('aiResult').style.display = 'block';
}

// ============================================================
// Chat List Rendering
// ============================================================

const AVATAR_COLORS = [
  '#00a884', '#0084ff', '#ff6b6b', '#ffd93d',
  '#6c5ce7', '#fd79a8', '#00cec9', '#e17055',
  '#0984e3', '#a29bfe', '#55efc4', '#fab1a0',
  '#74b9ff', '#ffeaa7', '#dfe6e9', '#636e72',
];

function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitial(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now - d;
  if (diff < 86400000 && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 172800000) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderChatList() {
  const $chatList = document.getElementById('chatList');
  const searchTerm = (document.getElementById('searchInput').value || '').toLowerCase();

  let chats = Object.values(state.chats)
    .filter(c => c.chatId && !/@newsletter|@broadcast|status@/.test(c.chatId));

  // Filter groups
  if (!state.showGroups) {
    chats = chats.filter(c => !c.chatId.includes('@g.us'));
  }

  // Search filter
  if (searchTerm) {
    chats = chats.filter(c =>
      (c.name || '').toLowerCase().includes(searchTerm) ||
      (c.number || '').includes(searchTerm)
    );
  }

  // Sort by last activity
  chats.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));

  // Separate groups and personal
  const personal = chats.filter(c => !c.chatId.includes('@g.us'));
  const groups = chats.filter(c => c.chatId.includes('@g.us'));

  let html = '';

  if (personal.length === 0 && groups.length === 0) {
    html = '<div style="padding:30px;text-align:center;color:var(--text-secondary)"><div style="font-size:24px;margin-bottom:8px">💬</div><div>No conversations yet</div><div style="font-size:11px;margin-top:4px;opacity:0.7">Open WhatsApp Web and wait for messages to sync</div></div>';
  } else {
    for (const chat of personal) {
      html += renderChatItem(chat);
    }
    if (groups.length > 0 && state.showGroups) {
      html += '<div class="divider">Groups</div>';
      for (const chat of groups) {
        html += renderChatItem(chat);
      }
    }
  }

  $chatList.innerHTML = html;
}

function renderChatItem(chat) {
  const isActive = state.activeChat === chat.chatId;
  const color = getAvatarColor(chat.name);
  const initial = getInitial(chat.name);
  const preview = chat.lastMessage || '';
  const time = formatTime(chat.timestamp);

  return `
    <div class="item ${isActive ? 'active' : ''}" data-chatid="${escapeAttr(chat.chatId)}">
      <div class="avatar" style="background:${color}">${initial}</div>
      <div class="info">
        <div class="name">${escapeHtml(chat.name || 'Unknown')}</div>
        <div class="preview">${escapeHtml(preview.substring(0, 50))}</div>
      </div>
      <div class="meta">
        <div class="time">${time}</div>
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================
// Chat Selection & Message Rendering
// ============================================================

function selectChat(chatId) {
  state.activeChat = chatId;
  const chat = state.chats[chatId];

  // Update header
  document.getElementById('chatHeaderText').textContent = chat ? chat.name : 'Unknown';

  // Show chat view, hide sidebar
  document.getElementById('sidebar').classList.add('hide');
  document.getElementById('chatView').classList.add('active');

  // Load messages
  sendToBg('get_messages', { chatId, limit: 100 });

  // Mark as read
  sendToBg('mark_read', { chatId });

  renderChatList();
}

function goBack() {
  state.activeChat = null;
  document.getElementById('sidebar').classList.remove('hide');
  document.getElementById('chatView').classList.remove('active');
  renderChatList();
}

function renderMessages() {
  const $messages = document.getElementById('messages');
  const msgs = state.messages[state.activeChat] || [];

  if (msgs.length === 0) {
    $messages.innerHTML = '<div id="emptyState"><div class="icon">💬</div><div>No messages yet</div></div>';
    return;
  }

  let html = '';
  for (const msg of msgs) {
    html += renderMessage(msg);
  }
  $messages.innerHTML = html;
}

function renderMessage(msg) {
  const isMe = msg.fromMe;
  const time = formatTime(msg.timestamp);
  const body = msg.body || '';

  let content = '';

  if (msg.isVoice) {
    const isPro = state.config && state.config.isPro;
    content = `<span class="voice-badge">🎤 Voice Message</span>`;
    if (msg._transcribing) {
      content += `<div class="loading-inline">Transcribing...</div>`;
    } else if (msg.transcription) {
      content += `<div class="trans" style="border-top-color:var(--send-btn)">${escapeHtml(msg.transcription)}</div>`;
    } else if (msg._transcriptionError && isPro) {
      content += `<div class="trans" style="color:#ff6b6b;border-top-color:#ff6b6b">⚠️ ${escapeHtml(msg._transcriptionError)}</div>`;
      content += `<button class="transcribe-btn" data-msgid="${escapeAttr(msg.messageId)}">🔄 Retry</button>`;
    } else if (msg._transcriptionError && !isPro) {
      content += `<div class="trans" style="color:#ff6b6b;border-top-color:#ff6b6b">🔒 ${escapeHtml(msg._transcriptionError)}</div>`;
      content += `<button class="upgrade-btn">🔑 Upgrade to Pro</button>`;
    } else if (isPro) {
      content += `<button class="transcribe-btn" data-msgid="${escapeAttr(msg.messageId)}">📝 Transcribe</button>`;
    } else {
      content += `<button class="upgrade-btn">🔑 Unlock Voice Transcription</button>`;
    }
  } else if (body) {
    content = escapeHtml(body);
    if (msg.translation) {
      content += `<div class="trans">${escapeHtml(msg.translation)}</div>`;
    }
  } else {
    content = `<span class="voice-badge">📎 ${msg.type || 'Media'}</span>`;
  }

  // Suggestions
  let suggestionsHtml = '';
  if (msg.suggestions && msg.suggestions.length > 0 && !isMe) {
    suggestionsHtml = `
      <div class="msg-suggestions">
        <span class="toggle-btn" data-msgid="${escapeAttr(msg.messageId)}">💡 ${msg.suggestions.length} AI Suggestions ▸</span>
        <div class="sug-list" id="sug-${escapeAttr(msg.messageId)}" style="display:none">
          ${msg.suggestions.map((s, i) => `
            <div class="sug-item" data-msgid="${escapeAttr(msg.messageId)}" data-idx="${i}">
              <div>${escapeHtml(s.en)}</div>
              <div class="zh">${escapeHtml(s.zh)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Reply button for customer messages
  const replyBtn = !isMe ? `<div style="margin-top:4px"><button class="reply-to-msg-btn" data-msgid="${escapeAttr(msg.messageId)}" style="font-size:11px;color:var(--text-secondary);background:none;border:none;cursor:pointer">↩ Reply to this message</button></div>` : '';

  return `
    <div class="msg ${isMe ? 'me' : 'customer'}">
      <div class="meta">${time}</div>
      <div>${content}</div>
      ${replyBtn}
      ${suggestionsHtml}
    </div>
  `;
}

function toggleSuggestions(messageId) {
  const el = document.getElementById('sug-' + messageId);
  if (el) {
    el.style.display = el.style.display === 'none' ? 'flex' : 'none';
  }
}

function scrollToBottom() {
  const $messages = document.getElementById('messages');
  setTimeout(() => {
    $messages.scrollTop = $messages.scrollHeight;
  }, 50);
}

// ============================================================
// Send Reply
// ============================================================

function sendReply() {
  const $input = document.getElementById('replyInput');
  const text = $input.value.trim();
  if (!text || !state.activeChat) return;

  sendToBg('send_message', { chatId: state.activeChat, text });
  $input.value = '';
  autoResizeTextarea($input);
}

// ============================================================
// AI Popup
// ============================================================

function openAIPopup() {
  document.getElementById('aiPopup').classList.add('show');
  document.getElementById('aiPrompt').value = '';
  document.getElementById('aiResult').style.display = 'none';
  document.getElementById('aiPrompt').focus();
}

function closeAIPopup() {
  document.getElementById('aiPopup').classList.remove('show');
}

function generateAI() {
  const prompt = document.getElementById('aiPrompt').value.trim();
  if (!prompt || !state.activeChat) return;

  const history = state.messages[state.activeChat] || [];
  sendToBg('custom_reply', {
    chatId: state.activeChat,
    prompt,
    history: history.slice(-10),
  });
}

function translateAIResult() {
  const zh = document.getElementById('aiResultZh').value.trim();
  if (!zh) return;

  // Use the config to translate
  if (state.config && state.config.llm.apiKey) {
    // Send to background for translation
    sendToBg('translate_message', {
      messageId: 'ai_temp',
      body: zh,
    });
    // For now, just show the EN result we already have
    document.getElementById('aiResultEn').style.display =
      document.getElementById('aiResultEn').style.display === 'none' ? 'block' : 'none';
  }
}

function sendAIResult(lang) {
  if (!state.activeChat) return;
  const zhText = document.getElementById('aiResultZh').value.trim();

  if (lang === 'zh') {
    if (zhText) {
      sendToBg('send_message', { chatId: state.activeChat, text: zhText });
      closeAIPopup();
    }
  } else {
    // Send EN: translate zh text to English first, then send
    if (zhText) {
      sendToBg('send_translated', { chatId: state.activeChat, text: zhText });
      closeAIPopup();
    }
  }
}

function requestTranscription(messageId) {
  if (!state.activeChat) return;
  const msgs = state.messages[state.activeChat] || [];
  const msg = msgs.find(m => m.messageId === messageId);
  if (msg) {
    msg._transcribing = true;
    msg._transcriptionError = null;
    renderMessages();
  }
  sendToBg('transcribe_message', { messageId, chatId: state.activeChat });
}

// ============================================================
// Reply Modal
// ============================================================

function openReplyModal(messageId, suggestionIdx) {
  // Find the message
  const msgs = state.messages[state.activeChat] || [];
  const msg = msgs.find(m => m.messageId === messageId);
  if (!msg) return;

  state.modalMsg = msg;
  state.modalSelectedIdx = suggestionIdx !== undefined ? suggestionIdx : -1;

  // Set preview
  const displayBody = msg.isVoice && msg.transcription ? msg.transcription : (msg.body || '[Voice]');
  document.getElementById('modalMsgPreview').innerHTML = `
    <div>${escapeHtml(displayBody)}</div>
    ${msg.translation ? `<div class="zh">${escapeHtml(msg.translation)}</div>` : ''}
  `;

  // Set suggestions
  if (msg.suggestions && msg.suggestions.length > 0) {
    state.modalSuggestions = msg.suggestions;
    renderModalSuggestions();
    document.getElementById('modalOptCards').style.display = 'block';
    document.getElementById('modalToggleSuggestions').textContent = '💡 5 AI Suggestions ▾';
  } else {
    state.modalSuggestions = [];
    document.getElementById('modalOptCards').innerHTML = '<div class="loading">Generating suggestions...</div>';
    document.getElementById('modalOptCards').style.display = 'block';
    document.getElementById('modalToggleSuggestions').textContent = '💡 5 AI Suggestions ▸';

    // Request suggestions (use transcription for voice messages)
    const sugBody = msg.isVoice && msg.transcription ? msg.transcription : msg.body;
    sendToBg('generate_suggestions', {
      chatId: state.activeChat,
      messageId: msg.messageId,
      body: sugBody,
    });
  }

  // Set edit text
  if (suggestionIdx !== undefined && suggestionIdx >= 0 && state.modalSuggestions[suggestionIdx]) {
    document.getElementById('modalEditText').value = state.modalSuggestions[suggestionIdx].zh;
  } else {
    document.getElementById('modalEditText').value = '';
  }

  document.getElementById('modalTranslation').style.display = 'none';
  document.getElementById('replyModal').classList.add('show');
}

function closeReplyModal() {
  document.getElementById('replyModal').classList.remove('show');
  state.modalMsg = null;
  state.modalSuggestions = [];
}

function renderModalSuggestions() {
  const $cards = document.getElementById('modalOptCards');
  const labels = ['Professional', 'Friendly', 'Closing', 'Detailed', 'Concise'];

  $cards.innerHTML = state.modalSuggestions.map((s, i) => `
    <div class="opt-card ${state.modalSelectedIdx === i ? 'selected' : ''}" data-idx="${i}">
      <div class="label">${labels[i] || 'Option ' + (i + 1)}</div>
      <div class="en">${escapeHtml(s.en)}</div>
      <div class="zh">${escapeHtml(s.zh)}</div>
    </div>
  `).join('');

  // Bind click on each card via event delegation
  $cards.querySelectorAll('.opt-card').forEach(card => {
    card.addEventListener('click', () => {
      selectModalSuggestion(parseInt(card.dataset.idx, 10));
    });
  });
}

function selectModalSuggestion(idx) {
  state.modalSelectedIdx = idx;
  const sug = state.modalSuggestions[idx];
  if (sug) {
    document.getElementById('modalEditText').value = sug.zh;
    renderModalSuggestions();
  }
}

function toggleModalSuggestions() {
  const $cards = document.getElementById('modalOptCards');
  const $btn = document.getElementById('modalToggleSuggestions');
  if ($cards.style.display === 'none') {
    $cards.style.display = 'block';
    $btn.textContent = '💡 5 AI Suggestions ▾';
  } else {
    $cards.style.display = 'none';
    $btn.textContent = '💡 5 AI Suggestions ▸';
  }
}

function retryModalSuggestions() {
  if (!state.modalMsg || !state.activeChat) return;
  document.getElementById('modalOptCards').innerHTML = '<div class="loading">Regenerating...</div>';
  const sugBody = state.modalMsg.isVoice && state.modalMsg.transcription ? state.modalMsg.transcription : state.modalMsg.body;
  sendToBg('generate_suggestions', {
    chatId: state.activeChat,
    messageId: state.modalMsg.messageId,
    body: sugBody,
  });
}

function translateModalText() {
  const text = document.getElementById('modalEditText').value.trim();
  if (!text) return;

  const $trans = document.getElementById('modalTranslation');
  $trans.style.display = 'block';
  $trans.textContent = 'Translating...';

  sendToBg('translate_message', {
    messageId: 'modal_temp',
    body: text,
  });

  // Listen for the translation result
  // (handled by handleTranslationReady)
}

function updateModalTranslation() {
  if (state.modalMsg && state.modalMsg.translation) {
    const $trans = document.getElementById('modalTranslation');
    $trans.style.display = 'block';
    $trans.textContent = state.modalMsg.translation;
  }
}

function sendModalReply(lang) {
  if (!state.activeChat) return;
  const text = document.getElementById('modalEditText').value.trim();
  if (!text) return;

  if (lang === 'en') {
    // Translate Chinese text to English, then send
    sendToBg('send_translated', { chatId: state.activeChat, text });
  } else {
    sendToBg('send_message', { chatId: state.activeChat, text });
  }

  closeReplyModal();
}

// ============================================================
// UI Toggles
// ============================================================

function toggleGroupFilter() {
  state.showGroups = !state.showGroups;
  document.getElementById('toggleGroups').classList.toggle('on', state.showGroups);
  renderChatList();
}

function toggleTheme() {
  state.isDark = !state.isDark;
  document.documentElement.classList.toggle('light', !state.isDark);
  document.getElementById('toggleTheme').textContent = state.isDark ? '🌙' : '☀️';
}

// ============================================================
// Status Bar
// ============================================================

function updateStatus(status, text) {
  const $dot = document.querySelector('#statusBar .dot');
  const $text = document.querySelector('#statusBar .status-text');
  if ($dot) {
    $dot.className = 'dot ' + status;
  }
  if ($text) {
    $text.textContent = text;
  }
}

// ============================================================
// Textarea Auto-Resize
// ============================================================

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

// ============================================================
// Event Listeners
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Connect to background
  connectBackground();

  // Search
  document.getElementById('searchInput').addEventListener('input', () => {
    renderChatList();
  });

  // Reply input
  const $replyInput = document.getElementById('replyInput');
  $replyInput.addEventListener('input', () => autoResizeTextarea($replyInput));
  $replyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendReply();
    }
  });

  // AI popup prompt
  document.getElementById('aiPrompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      generateAI();
    }
  });

  // Close modals on backdrop click
  document.getElementById('aiPopup').addEventListener('click', (e) => {
    if (e.target === document.getElementById('aiPopup')) closeAIPopup();
  });
  document.getElementById('replyModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('replyModal')) closeReplyModal();
  });

  // ── Button event bindings (Manifest V3 CSP blocks inline onclick) ──
  document.getElementById('toggleGroups').addEventListener('click', toggleGroupFilter);
  document.getElementById('toggleTheme').addEventListener('click', toggleTheme);
  document.getElementById('backBtn').addEventListener('click', goBack);
  document.getElementById('aiPopupBtn').addEventListener('click', openAIPopup);
  document.getElementById('sendReplyBtn').addEventListener('click', sendReply);
  document.getElementById('aiCancelBtn').addEventListener('click', closeAIPopup);
  document.getElementById('aiGenBtn').addEventListener('click', generateAI);
  document.getElementById('aiTransBtn').addEventListener('click', translateAIResult);
  document.getElementById('aiSendZhBtn').addEventListener('click', () => sendAIResult('zh'));
  document.getElementById('aiSendEnBtn').addEventListener('click', () => sendAIResult('en'));
  document.getElementById('aiDiscardBtn').addEventListener('click', closeAIPopup);
  document.getElementById('modalToggleSuggestions').addEventListener('click', toggleModalSuggestions);
  document.getElementById('modalTransBtn').addEventListener('click', translateModalText);
  document.getElementById('modalRetryBtn').addEventListener('click', retryModalSuggestions);
  document.getElementById('modalCancelBtn').addEventListener('click', closeReplyModal);
  document.getElementById('modalSendZhBtn').addEventListener('click', () => sendModalReply('zh'));
  document.getElementById('modalSendEnBtn').addEventListener('click', () => sendModalReply('en'));

  // ── Event delegation for dynamically generated elements ──

  // Chat list clicks
  document.getElementById('chatList').addEventListener('click', (e) => {
    const item = e.target.closest('.item');
    if (item && item.dataset.chatid) {
      selectChat(item.dataset.chatid);
    }
  });

  // Messages area clicks (suggestions toggle, sug items, reply buttons)
  document.getElementById('messages').addEventListener('click', (e) => {
    // Toggle suggestions
    const toggleBtn = e.target.closest('.toggle-btn');
    if (toggleBtn && toggleBtn.dataset.msgid) {
      const el = document.getElementById('sug-' + toggleBtn.dataset.msgid);
      if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none';
      return;
    }
    // Suggestion item click
    const sugItem = e.target.closest('.sug-item');
    if (sugItem && sugItem.dataset.msgid) {
      openReplyModal(sugItem.dataset.msgid, parseInt(sugItem.dataset.idx, 10));
      return;
    }
    // Reply to message button
    const replyBtn = e.target.closest('.reply-to-msg-btn');
    if (replyBtn && replyBtn.dataset.msgid) {
      openReplyModal(replyBtn.dataset.msgid);
      return;
    }
    // Transcribe button
    const transcribeBtn = e.target.closest('.transcribe-btn');
    if (transcribeBtn && transcribeBtn.dataset.msgid) {
      requestTranscription(transcribeBtn.dataset.msgid);
      return;
    }
    // Upgrade to Pro button
    const upgradeBtn = e.target.closest('.upgrade-btn');
    if (upgradeBtn) {
      chrome.tabs.create({ url: 'https://github.com/zhinno-robotics/whatsapp-sales-assistant#pro' });
      return;
    }
  });

  // Initial status
  updateStatus('connecting', 'Connecting to WhatsApp...');
});
