/**
 * AI service orchestrator — coordinates translation and suggestion generation
 */
const { detectLanguage, translate } = require('./translator');
const { generateSuggestions, generateCustomReply } = require('./suggester');

/**
 * Process an incoming customer message:
 * 1. Detect language
 * 2. Translate to user's native language if needed
 * 3. Generate 3 reply suggestions
 *
 * @param {object} msg - { chatId, body, contactName, contactNumber }
 * @param {Array} history - recent conversation history
 * @returns {Promise<{translation: string, suggestions: string[]}>}
 */
async function processIncoming(msg, history) {
  // Translate to user's native language (always, for understanding)
  const translationPromise = translate(msg.body, 'to_user');

  // Generate suggestions in parallel
  const suggestionsPromise = generateSuggestions(history, msg.contactName);

  const [translation, suggestions] = await Promise.all([
    translationPromise,
    suggestionsPromise,
  ]);

  return { translation, suggestions };
}

/**
 * Generate a custom reply based on user's instruction
 * @param {string} userPrompt - user's instruction/prompt
 * @param {Array} history - conversation history
 * @param {string} customerName - optional customer name
 * @returns {Promise<{en: string, zh: string}>}
 */
async function processCustomReply(userPrompt, history, customerName = '') {
  return generateCustomReply(userPrompt, history, customerName);
}

/**
 * Translate user's draft reply to customer-facing language
 * @param {string} text - user's draft (likely Chinese)
 * @returns {Promise<string>} translated text
 */
async function translateReply(text) {
  return translate(text, 'to_customer');
}

module.exports = {
  processIncoming,
  processHistoricalMessage: processIncoming, // alias — same logic
  processCustomReply,
  translateReply,
};
