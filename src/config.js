const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

module.exports = {
  // AI API
  llm: {
    baseURL: process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'deepseek-chat',
  },

  // Language settings
  userNativeLang: process.env.USER_NATIVE_LANG || 'zh',
  customerLang: process.env.CUSTOMER_LANG || 'en',

  // Context
  contextWindow: parseInt(process.env.CONTEXT_WINDOW, 10) || 10,

  // Paths
  dataPath: path.resolve(process.env.DATA_PATH || './data'),

  // WhatsApp
  whatsappPhone: process.env.WHATSAPP_PHONE_NUMBER || '',
};
