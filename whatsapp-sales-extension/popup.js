/**
 * popup.js - Settings popup logic
 * AI + Language + Behavior + Pro License tabs
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
  licenseKey: '',
  licenseEmail: '',
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
  document.getElementById('licenseKey').value = config.licenseKey || '';
  document.getElementById('licenseEmail').value = config.licenseEmail || '';

  // Load Pro status & quota
  await updateLicenseStatus();
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
    licenseKey: document.getElementById('licenseKey').value.trim(),
    licenseEmail: document.getElementById('licenseEmail').value.trim(),
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
    console.log('[popup] Saving config:', JSON.stringify({ ...config, llm: { ...config.llm, apiKey: '***' }, licenseKey: '***' }, null, 2));

    await chrome.storage.local.set({ config });

    showStatus('Settings saved successfully.', 'success');
    await updateLicenseStatus();
  } catch (e) {
    console.error('[popup] Save error:', e);
    showStatus('Save failed: ' + e.message, 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function updateLicenseStatus() {
  const result = await chrome.storage.local.get('config');
  const config = mergeConfig(result.config);
  const statusEl = document.getElementById('licenseStatus');
  const quotaEl = document.getElementById('licenseQuota');
  const msgEl = document.getElementById('licenseMsg');

  if (!statusEl) return;

  // Get daily usage
  const usageResult = await chrome.storage.local.get('dailyUsage');
  const usage = usageResult.dailyUsage || { date: '', count: 0 };
  const today = new Date().toISOString().split('T')[0];
  const todayCount = usage.date === today ? usage.count : 0;

  if (config.licenseKey && config.licenseEmail) {
    statusEl.innerHTML = '<span style="color:var(--accent);font-weight:600;">Pro Active</span> &mdash; ' + config.licenseEmail;
    statusEl.style.borderColor = 'var(--accent)';
    if (quotaEl) quotaEl.textContent = 'Unlimited AI operations';
    if (msgEl) msgEl.textContent = '';
  } else {
    statusEl.innerHTML = '<span style="color:var(--muted);">Free Tier</span> &mdash; 25 AI ops/day';
    statusEl.style.borderColor = 'var(--line)';
    if (quotaEl) quotaEl.textContent = `Used today: ${todayCount} / 25`;
    if (msgEl) msgEl.textContent = '';
  }
}

async function activateLicense() {
  const licenseKey = document.getElementById('licenseKey').value.trim();
  const email = document.getElementById('licenseEmail').value.trim();
  const msgEl = document.getElementById('licenseMsg');

  if (!licenseKey || !email) {
    msgEl.textContent = 'Please enter both email and license key.';
    msgEl.style.color = 'var(--danger)';
    return;
  }

  msgEl.textContent = 'Validating...';
  msgEl.style.color = 'var(--muted)';

  try {
    const bgResponse = await chrome.runtime.sendMessage({
      source: 'popup',
      action: 'validate_license',
      params: { licenseKey, email },
    });

    if (bgResponse && bgResponse.valid) {
      msgEl.textContent = 'Pro activated! Expires: ' + bgResponse.expiryDate;
      msgEl.style.color = 'var(--accent)';
      // Save to config
      const result = await chrome.storage.local.get('config');
      const config = mergeConfig(result.config);
      config.licenseKey = licenseKey;
      config.licenseEmail = email;
      await chrome.storage.local.set({ config });
      await updateLicenseStatus();
    } else {
      msgEl.textContent = (bgResponse && bgResponse.reason) || 'Invalid license key.';
      msgEl.style.color = 'var(--danger)';
    }
  } catch (e) {
    // Fallback: direct storage save
    const result = await chrome.storage.local.get('config');
    const config = mergeConfig(result.config);
    config.licenseKey = licenseKey;
    config.licenseEmail = email;
    await chrome.storage.local.set({ config });
    msgEl.textContent = 'License saved. Restart side panel to apply.';
    msgEl.style.color = 'var(--accent)';
    await updateLicenseStatus();
  }
}

async function deactivateLicense() {
  const result = await chrome.storage.local.get('config');
  const config = mergeConfig(result.config);
  config.licenseKey = '';
  config.licenseEmail = '';
  await chrome.storage.local.set({ config });
  document.getElementById('licenseKey').value = '';
  document.getElementById('licenseEmail').value = '';
  document.getElementById('licenseMsg').textContent = 'Pro deactivated. Back to Free tier.';
  document.getElementById('licenseMsg').style.color = 'var(--muted)';
  await updateLicenseStatus();
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
    tab.addEventListener('click', async () => {
      focusSection(tab.id.replace('tab-', ''));
      showStatus('', '');
      if (tab.id === 'tab-license') await updateLicenseStatus();
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

  // License buttons
  const activateBtn = document.getElementById('activateBtn');
  const deactivateBtn = document.getElementById('deactivateBtn');
  if (activateBtn) activateBtn.addEventListener('click', activateLicense);
  if (deactivateBtn) deactivateBtn.addEventListener('click', deactivateLicense);
});
