/**
 * popup.js - Settings popup logic
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

function mergeConfig(config = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    llm: {
      ...DEFAULT_CONFIG.llm,
      ...(config.llm || {}),
    },
  };
}

async function loadSettings() {
  const result = await chrome.storage.local.get('config');
  const config = mergeConfig(result.config);

  document.getElementById('llmBaseURL').value = config.llm.baseURL;
  document.getElementById('llmApiKey').value = config.llm.apiKey;
  document.getElementById('llmModel').value = config.llm.model;
  document.getElementById('userNativeLang').value = config.userNativeLang;
  document.getElementById('customerLang').value = config.customerLang;
  document.getElementById('contextWindow').value = config.contextWindow;
  document.getElementById('autoOpenSidePanel').checked = config.autoOpenSidePanel;
}

function collectSettings() {
  return {
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
}

async function saveSettings() {
  console.log('[popup] saveSettings() called');
  const btn = document.getElementById('saveBtn');
  const originalText = btn.textContent;

  try {
    btn.textContent = 'Saving...';
    btn.disabled = true;

    const config = collectSettings();
    console.log('[popup] Saving config:', JSON.stringify({ ...config, llm: { ...config.llm, apiKey: '***' } }, null, 2));

    await chrome.storage.local.set({ config });

    const verify = await chrome.storage.local.get('config');
    console.log('[popup] Verified saved config:', JSON.stringify({
      ...verify.config,
      llm: { ...(verify.config?.llm || {}), apiKey: '***' },
    }, null, 2));

    showStatus('Settings saved successfully.', 'success');
  } catch (e) {
    console.error('[popup] Save error:', e);
    showStatus('Save failed: ' + e.message, 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function testLLM() {
  const apiKey = document.getElementById('llmApiKey').value.trim();
  const baseURL = document.getElementById('llmBaseURL').value.trim();
  const model = document.getElementById('llmModel').value.trim();

  if (!apiKey) {
    showStatus('Please enter an API key first.', 'error');
    focusSection('ai');
    document.getElementById('llmApiKey').focus();
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
      showStatus(`Failed: ${response.status} - ${err.substring(0, 100)}`, 'error');
      return;
    }

    const data = await response.json();
    showStatus(`OK. Reply: ${data.choices[0].message.content}`, 'success');
  } catch (e) {
    showStatus(`Connection failed: ${e.message}`, 'error');
  }
}

function showStatus(text, type) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.className = type;
}

function focusSection(sectionName) {
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = Array.from(document.querySelectorAll('.section'));

  tabs.forEach((tab) => {
    const isActive = tab.id === `tab-${sectionName}`;
    tab.setAttribute('aria-selected', String(isActive));
  });

  panels.forEach((panel) => {
    const isActive = panel.id === `section-${sectionName}`;
    panel.classList.toggle('active', isActive);
    panel.hidden = !isActive;
  });
}

function bindTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      focusSection(tab.id.replace('tab-', ''));
      showStatus('', '');
    });
  });
}

async function openSidePanel() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.startsWith('https://web.whatsapp.com')) {
      await chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    } else {
      showStatus('Please open WhatsApp Web first.', 'error');
    }
  } catch (e) {
    showStatus('Failed: ' + e.message, 'error');
  }
}

console.log('[popup] popup.js loaded');

document.addEventListener('DOMContentLoaded', () => {
  console.log('[popup] DOMContentLoaded, loading settings...');
  loadSettings();
  bindTabs();

  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('testBtn').addEventListener('click', testLLM);
  document.getElementById('openPanelBtn').addEventListener('click', openSidePanel);
});
