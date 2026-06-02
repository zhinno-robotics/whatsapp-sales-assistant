/**
 * popup.js — Settings popup logic
 */

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

async function loadSettings() {
  const result = await chrome.storage.local.get('config');
  const config = { ...DEFAULT_CONFIG, ...result.config };

  document.getElementById('llmBaseURL').value = config.llm.baseURL;
  document.getElementById('llmApiKey').value = config.llm.apiKey;
  document.getElementById('llmModel').value = config.llm.model;
  document.getElementById('userNativeLang').value = config.userNativeLang;
  document.getElementById('customerLang').value = config.customerLang;
  document.getElementById('contextWindow').value = config.contextWindow;
  document.getElementById('autoOpenSidePanel').checked = config.autoOpenSidePanel;
}

async function saveSettings() {
  console.log('[popup] saveSettings() called');
  const btn = document.querySelector('.btn-primary');
  const originalText = btn.textContent;

  try {
    btn.textContent = 'Saving...';
    btn.disabled = true;
    btn.style.opacity = '0.6';

    const config = {
      llm: {
        baseURL: document.getElementById('llmBaseURL').value.trim(),
        apiKey: document.getElementById('llmApiKey').value.trim(),
        model: document.getElementById('llmModel').value.trim(),
      },
      userNativeLang: document.getElementById('userNativeLang').value,
      customerLang: document.getElementById('customerLang').value,
      contextWindow: parseInt(document.getElementById('contextWindow').value, 10) || 10,
      autoOpenSidePanel: document.getElementById('autoOpenSidePanel').checked,
    };

    console.log('[popup] Saving config:', JSON.stringify(config, null, 2));

    await chrome.storage.local.set({ config });

    // Verify it was saved
    const verify = await chrome.storage.local.get('config');
    console.log('[popup] Verified saved config:', JSON.stringify(verify.config, null, 2));

    showStatus('✅ Settings saved successfully!', 'success');
  } catch (e) {
    console.error('[popup] Save error:', e);
    showStatus('❌ Save failed: ' + e.message, 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

async function testLLM() {
  const apiKey = document.getElementById('llmApiKey').value.trim();
  const baseURL = document.getElementById('llmBaseURL').value.trim();
  const model = document.getElementById('llmModel').value.trim();

  if (!apiKey) {
    showStatus('Please enter an API key first', 'error');
    return;
  }

  showStatus('Testing LLM connection...', '');

  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'deepseek-chat',
        messages: [{ role: 'user', content: 'Reply with just "OK".' }],
        max_tokens: 10,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      showStatus(`Failed: ${response.status} — ${err.substring(0, 100)}`, 'error');
      return;
    }

    const data = await response.json();
    showStatus(`OK! Reply: ${data.choices[0].message.content}`, 'success');
  } catch (e) {
    showStatus(`Connection failed: ${e.message}`, 'error');
  }
}

function showStatus(text, type) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.className = type;
}

console.log('[popup] popup.js loaded');

document.addEventListener('DOMContentLoaded', () => {
  console.log('[popup] DOMContentLoaded, loading settings...');
  loadSettings();

  // Bind button events (Manifest V3 CSP blocks inline onclick)
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('testBtn').addEventListener('click', testLLM);

  // Open side panel (popup click counts as user gesture)
  document.getElementById('openPanelBtn').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.url.startsWith('https://web.whatsapp.com')) {
        await chrome.sidePanel.open({ tabId: tab.id });
        window.close(); // Close popup after opening side panel
      } else {
        showStatus('⚠️ Please open WhatsApp Web first', 'error');
      }
    } catch (e) {
      showStatus('❌ Failed: ' + e.message, 'error');
    }
  });
});
