/**
 * JSON file-based conversation store (no native dependencies)
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const DB_PATH = path.join(config.dataPath, 'store.json');

// In-memory data
let data = {
  conversations: {},  // chatId -> { chat_id, contact_name, contact_number, last_activity }
  messages: {},       // chatId -> [ { message_id, sender, body, translation, timestamp } ]
};

/**
 * Load data from disk
 */
function load() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      data.conversations = parsed.conversations || {};
      data.messages = parsed.messages || {};
    }
  } catch (err) {
    console.error('[store] Failed to load data:', err.message);
    // Start fresh
    data = { conversations: {}, messages: {} };
  }
}

/**
 * Persist data to disk (throttled/debounced in practice, but simple for now)
 */
function save() {
  try {
    fs.mkdirSync(config.dataPath, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[store] Failed to save data:', err.message);
  }
}

/**
 * Save an incoming message
 */
function saveMessage(chatId, messageId, sender, body, timestamp) {
  // Initialize chat if needed
  if (!data.conversations[chatId]) {
    data.conversations[chatId] = {
      chat_id: chatId,
      contact_name: '',
      contact_number: '',
      last_activity: 0,
    };
  }

  // Update last activity
  if (timestamp > data.conversations[chatId].last_activity) {
    data.conversations[chatId].last_activity = timestamp;
  }

  // Initialize message array for chat
  if (!data.messages[chatId]) {
    data.messages[chatId] = [];
  }

  // Check for duplicate
  const existingIdx = data.messages[chatId].findIndex(m => m.message_id === messageId);
  if (existingIdx >= 0) {
    data.messages[chatId][existingIdx] = { message_id: messageId, sender, body, translation: null, timestamp };
  } else {
    data.messages[chatId].push({ message_id: messageId, sender, body, translation: null, timestamp });
  }

  // Sort by timestamp
  data.messages[chatId].sort((a, b) => a.timestamp - b.timestamp);

  // Trim old messages (keep config.contextWindow * 20 per chat for history)
  if (data.messages[chatId].length > config.contextWindow * 20) {
    data.messages[chatId] = data.messages[chatId].slice(-config.contextWindow * 20);
  }

  save();
}

/**
 * Get recent conversation history
 */
function getHistory(chatId, limit = 100) {
  const msgs = data.messages[chatId] || [];
  return msgs.slice(-limit);
}

/**
 * Find a message by its ID
 */
function getMessage(messageId) {
  for (const chatId of Object.keys(data.messages)) {
    const msg = data.messages[chatId].find(m => m.message_id === messageId);
    if (msg) return msg;
  }
  return null;
}

/**
 * Get history context up to and including a specific message
 * (for regenerating suggestions on old messages)
 */
function getHistoryBefore(chatId, messageId, limit = 20) {
  const msgs = data.messages[chatId] || [];
  const idx = msgs.findIndex(m => m.message_id === messageId);
  if (idx < 0) return [];
  // Return messages up to and including this one
  const end = idx + 1;
  const start = Math.max(0, end - limit);
  return msgs.slice(start, end);
}

/**
 * Save translation for a message
 */
function saveTranslation(messageId, translation) {
  for (const chatId of Object.keys(data.messages)) {
    const msg = data.messages[chatId].find(m => m.message_id === messageId);
    if (msg) {
      msg.translation = translation;
      save();
      return;
    }
  }
}

/**
 * Get conversation meta
 */
function getConversation(chatId) {
  return data.conversations[chatId] || null;
}

/**
 * Update contact info
 */
function updateContact(chatId, name, number) {
  if (!data.conversations[chatId]) {
    data.conversations[chatId] = {
      chat_id: chatId,
      contact_name: '',
      contact_number: '',
      last_activity: 0,
    };
  }
  if (name) data.conversations[chatId].contact_name = name;
  if (number) data.conversations[chatId].contact_number = number;
  save();
}

/**
 * Get active chats sorted by last activity
 */
function getActiveChats(limit = 20) {
  return Object.values(data.conversations)
    .filter(c => c.chat_id && !/@newsletter|@broadcast|status@/.test(c.chat_id))
    .sort((a, b) => (b.last_activity || 0) - (a.last_activity || 0))
    .slice(0, limit);
}

// Initialize: load from disk
load();

module.exports = {
  saveMessage,
  getHistory,
  getMessage,
  getHistoryBefore,
  saveTranslation,
  getConversation,
  updateContact,
  getActiveChats,
};
