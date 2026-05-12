/**
 * Reply suggestion generator — creates multiple reply options (EN + ZH)
 */
const { chatCompletion, translate } = require('./translator');
const { PROMPTS, formatMessagesForPrompt } = require('./prompts');

/**
 * Strip placeholder patterns like [Name], [Customer Name], [anything]
 * and clean up leftover artifacts
 */
function cleanPlaceholders(text) {
  return text
    .replace(/\[.*?\]/g, '')           // Remove [...] placeholders
    .replace(/\s{2,}/g, ' ')            // Collapse multiple spaces
    .replace(/,\s*,/g, ',')             // Double commas
    .replace(/\.\s*\./g, '.')           // Double periods
    .replace(/^\s*,/, '')               // Leading comma
    .replace(/,\s*$/, '')               // Trailing comma
    .replace(/Hi\s+,/g, 'Hi,')          // "Hi ," → "Hi,"
    .replace(/Hello\s+,/g, 'Hello,')    // "Hello ," → "Hello,"
    .replace(/Dear\s+,/g, 'Dear,')      // "Dear ," → "Dear,"
    .replace(/,\s*,/g, ',')             // Again after cleanup
    .trim();
}

/**
 * Parse the LLM's 3-option response into an array
 * Expected format:
 * ---OPTION_1---
 * text...
 * ---OPTION_2---
 * text...
 * ---OPTION_3---
 * text...
 */
function parseSuggestions(raw) {
  const options = [];
  const matches = raw.match(/---OPTION_(\d)---\s*([\s\S]*?)(?=---OPTION_\d---|$)/g);

  if (matches) {
    for (const match of matches) {
      const text = match.replace(/---OPTION_\d---\s*/, '').trim();
      if (text) options.push(text);
    }
  }

  // Fallback: split by double newlines if parsing failed
  if (options.length === 0) {
    const parts = raw.split(/\n\n+/).filter(p => p.trim().length > 0);
    return parts.slice(0, 5);
  }

  return options.slice(0, 5);
}

/**
 * Generate 3 reply suggestions based on conversation context
 * @param {Array} history - array of { sender, body } objects
 * @param {string} customerName - optional customer name
 * @returns {Promise<Array<{en: string, zh: string}>>} 3 bilingual suggestion objects
 */
async function generateSuggestions(history, customerName = '') {
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

  try {
    const result = await chatCompletion([
      { role: 'system', content: PROMPTS.GENERATE_SUGGESTIONS(context, customerName) },
      { role: 'user', content: 'Generate 3 reply options for the latest customer message above.' },
    ], 0.7, 1200);

    const enSuggestions = parseSuggestions(result).map(cleanPlaceholders);

    // Pad to 5 if needed
    while (enSuggestions.length < 5) {
      enSuggestions.push('Thank you for your message. I will get back to you shortly.');
    }

    // Translate all 3 to Chinese in parallel
    const zhTranslations = await Promise.all(
      enSuggestions.map(en => translate(en, 'to_user').catch(() => '[翻译失败]'))
    );

    return enSuggestions.map((en, i) => ({ en, zh: zhTranslations[i] }));
  } catch (err) {
    console.error('[suggester] Failed:', err.message);
    return [
      { en: `[Error: ${err.message}]`, zh: `[错误: ${err.message}]` },
      { en: 'I will get back to you on this shortly.', zh: '我很快回复您。' },
      { en: 'Let me check and revert to you as soon as possible.', zh: '我确认后尽快回复。' },
      { en: 'Thanks for your patience. I will follow up soon.', zh: '感谢您的耐心，我很快跟进。' },
      { en: 'Got it. I will reply shortly.', zh: '收到，马上回复。' },
    ];
  }
}

/**
 * Generate a single custom reply based on user's instruction
 * @param {string} userPrompt - user's instruction in their native language
 * @param {Array} history - conversation history
 * @param {string} customerName - optional customer name
 * @returns {Promise<{en: string, zh: string}>} bilingual reply
 */
async function generateCustomReply(userPrompt, history, customerName = '') {
  if (!userPrompt || userPrompt.trim().length === 0) {
    return { en: '', zh: '' };
  }

  const context = formatMessagesForPrompt(history);

  try {
    const enResult = await chatCompletion([
      { role: 'system', content: PROMPTS.GENERATE_CUSTOM(userPrompt, context, customerName) },
      { role: 'user', content: 'Generate a reply based on the instruction above.' },
    ], 0.7, 800);

    const en = cleanPlaceholders(enResult.trim());
    const zh = await translate(en, 'to_user').catch(() => '[翻译失败]');

    return { en, zh };
  } catch (err) {
    console.error('[suggester] Custom reply failed:', err.message);
    return { en: `[Error: ${err.message}]`, zh: `[错误: ${err.message}]` };
  }
}

module.exports = { generateSuggestions, generateCustomReply };
