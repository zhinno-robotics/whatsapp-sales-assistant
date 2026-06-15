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

/**
 * Translate reply draft referencing history context
 */
async function translateWithContext(text, history) {
  if (!text || text.trim().length === 0) return text;

  if (!history || history.length === 0) {
    console.log('[translator] History is empty, falling back to direct translation.');
    return await translate(text, 'to_customer');
  }

  const { formatMessagesForPrompt } = require('./prompts');
  const context = formatMessagesForPrompt(history);

  let result = text;
  try {
    result = await chatCompletion([
      { role: 'system', content: PROMPTS.TRANSLATE_WITH_CONTEXT_SYSTEM },
      { role: 'user', content: PROMPTS.TRANSLATE_WITH_CONTEXT_USER(context, text.trim()) },
    ], 0.2, 800);
  } catch (err) {
    console.error(`[translator] translateWithContext LLM call failed:`, err.message);
  }

  // 双保险检查：如果返回的结果里中文比例仍然很高，或者和原输入完全一致，或者含有“Translate this”，说明大模型没有正常完成翻译
  const resultCjkCount = (result.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  if (resultCjkCount > result.length * 0.3 || result.trim() === text.trim() || result.toLowerCase().includes('translate this')) {
    console.log('[translator] translateWithContext returned Chinese or invalid text. Fallback to standard translate.');
    try {
      return await translate(text, 'to_customer');
    } catch (err) {
      console.error(`[translator] fallback translate failed:`, err.message);
      return text;
    }
  }

  return result;
}

module.exports = { chatCompletion, detectLanguage, translate, translateWithContext };
