/**
 * Translation service — detects language and translates messages
 */
const config = require('../config');
const { PROMPTS } = require('./prompts');

/**
 * Call the LLM API (OpenAI-compatible chat completions)
 */
async function chatCompletion(messages, temperature = 0.3, maxTokens = 1000) {
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
}

/**
 * Detect whether text is Chinese or English
 */
async function detectLanguage(text) {
  // Quick heuristic: if mostly CJK characters, it's Chinese
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  if (cjkCount > text.length * 0.3) return 'chinese';

  const result = await chatCompletion([
    { role: 'system', content: PROMPTS.DETECT_LANGUAGE + text },
  ], 0, 10);

  if (result.toLowerCase().includes('chinese')) return 'chinese';
  if (result.toLowerCase().includes('english')) return 'english';
  return 'other';
}

/**
 * Translate text to the target language
 * @param {string} text - source text
 * @param {'to_user'|'to_customer'} direction - translation direction
 * @returns {Promise<string>} translated text
 */
async function translate(text, direction = 'to_user') {
  if (!text || text.trim().length === 0) return text;

  // Skip translation for very short non-text messages
  if (text.length < 2) return text;

  const systemPrompt = direction === 'to_user'
    ? PROMPTS.TRANSLATE_TO_USER
    : PROMPTS.TRANSLATE_TO_CUSTOMER;

  try {
    const result = await chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ], 0.2, 800);

    // If result is suspiciously same as input (already in target language), fine
    return result;
  } catch (err) {
    console.error(`[translator] ${direction} failed:`, err.message);
    // Fallback: return original text on failure
    return `[Translation failed: ${err.message}]`;
  }
}

module.exports = { chatCompletion, detectLanguage, translate };
