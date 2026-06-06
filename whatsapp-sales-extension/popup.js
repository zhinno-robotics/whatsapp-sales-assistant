/**
 * popup.js — Settings popup logic
 */
console.log('[popup] Script loaded');

var DEFAULT_CONFIG = {
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

function mergeConfig(config) {
  config = config || {};
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
  var result = await chrome.storage.local.get('config');
  var config = mergeConfig(result.config);
  setVal('llmBaseURL', config.llm.baseURL);
  setVal('llmApiKey', config.llm.apiKey);
  setVal('llmModel', config.llm.model);
  setVal('userNativeLang', config.userNativeLang);
  setVal('customerLang', config.customerLang);
  setVal('contextWindow', config.contextWindow);
  setVal('autoOpenSidePanel', config.autoOpenSidePanel);
  setVal('licenseKey', config.licenseKey || '');
  setVal('licenseEmail', config.licenseEmail || '');
  await updateLicenseStatus();
}

function setVal(id, val) {
  var el = document.getElementById(id);
  if (!el) return;
  if (el.type === 'checkbox') el.checked = !!val;
  else el.value = val;
}

function collectSettings() {
  return {
    llm: {
      baseURL: getVal('llmBaseURL'),
      apiKey: getVal('llmApiKey'),
      model: getVal('llmModel'),
    },
    userNativeLang: getVal('userNativeLang'),
    customerLang: getVal('customerLang'),
    contextWindow: parseInt(getVal('contextWindow'), 10) || 10,
    autoOpenSidePanel: getVal('autoOpenSidePanel'),
    licenseKey: getVal('licenseKey'),
    licenseEmail: getVal('licenseEmail'),
  };
}

function getVal(id) {
  var el = document.getElementById(id);
  if (!el) return '';
  if (el.type === 'checkbox') return el.checked;
  return el.value.trim();
}

async function saveSettings() {
  console.log('[popup] saveSettings');
  var btn = document.getElementById('saveBtn');
  var orig = btn.textContent;
  btn.textContent = 'Saving...';
  btn.disabled = true;
  try {
    var config = collectSettings();
    await chrome.storage.local.set({ config: config });
    showStatus('Settings saved.', 'success');
    await updateLicenseStatus();
  } catch (e) {
    showStatus('Save failed: ' + e.message, 'error');
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
}

async function updateLicenseStatus() {
  var result = await chrome.storage.local.get('config');
  var config = mergeConfig(result.config);
  var statusEl = document.getElementById('licenseStatus');
  var quotaEl = document.getElementById('licenseQuota');
  var msgEl = document.getElementById('licenseMsg');
  if (!statusEl) return;

  var usageResult = await chrome.storage.local.get('dailyUsage');
  var usage = usageResult.dailyUsage || { date: '', count: 0 };
  var today = new Date().toISOString().split('T')[0];
  var todayCount = usage.date === today ? usage.count : 0;

  if (config.licenseKey && config.licenseEmail) {
    statusEl.innerHTML = '<span style="color:var(--accent);font-weight:600;">Pro Active</span> &mdash; ' + config.licenseEmail;
    statusEl.style.borderColor = 'var(--accent)';
    if (quotaEl) quotaEl.textContent = '(unlimited)';
    if (msgEl) { msgEl.textContent = ''; msgEl.style.color = 'var(--muted)'; }
  } else {
    statusEl.innerHTML = '<span style="color:var(--muted);">Free Tier</span> &mdash; 25 AI ops/day';
    statusEl.style.borderColor = 'var(--line)';
    if (quotaEl) quotaEl.textContent = '(' + todayCount + '/25 today)';
    if (msgEl) { msgEl.textContent = ''; msgEl.style.color = 'var(--muted)'; }
  }
}

async function activateLicense() {
  console.log('[popup] activateLicense clicked');
  var licenseKey = getVal('licenseKey');
  var email = getVal('licenseEmail');
  var msgEl = document.getElementById('licenseMsg');

  if (!licenseKey || !email) {
    if (msgEl) { msgEl.textContent = 'Please enter both email and license key.'; msgEl.style.color = 'var(--danger)'; }
    return;
  }

  if (msgEl) { msgEl.textContent = 'Validating...'; msgEl.style.color = 'var(--muted)'; }

  // Try background validation, fallback to direct save
  var valid = false;
  var reason = '';
  try {
    var bgResponse = await chrome.runtime.sendMessage({
      source: 'popup',
      action: 'validate_license',
      params: { licenseKey: licenseKey, email: email },
    });
    console.log('[popup] BG response:', JSON.stringify(bgResponse));
    if (bgResponse && bgResponse.valid) {
      valid = true;
    } else {
      reason = (bgResponse && bgResponse.reason) || 'Invalid license key.';
    }
  } catch (err) {
    console.log('[popup] BG message failed, saving directly:', err.message);
    // Background may be asleep — save directly and let background validate on next quota check
    valid = true; // accept optimistically, background will enforce
    reason = '';
  }

  if (valid) {
	    var result = await chrome.storage.local.get('config');
	    var config = mergeConfig(result.config);
	    config.licenseKey = licenseKey;
	    config.licenseEmail = email;
	    await chrome.storage.local.set({ config: config });

	    // Button turns green briefly
	    var activateBtn = document.getElementById('activateBtn');
	    if (activateBtn) {
	      activateBtn.textContent = '✓ Activated!';
	      activateBtn.style.background = '#00a884';
	      activateBtn.style.color = '#111b21';
	      setTimeout(function() {
	        activateBtn.textContent = 'Activate Pro';
	        activateBtn.style.background = '';
	        activateBtn.style.color = '';
	      }, 3000);
	    }

	    // Flash status box
	    var statusEl = document.getElementById('licenseStatus');
	    if (statusEl) { statusEl.style.background = 'rgba(0,168,132,.15)'; }

	    if (msgEl) {
	      msgEl.textContent = '✅ Pro activated! Unlimited AI.';
	      msgEl.style.color = 'var(--accent)';
	      msgEl.style.fontWeight = '700';
	    }
	    await updateLicenseStatus();
	  } else {
	    if (msgEl) {
	      msgEl.textContent = '❌ ' + reason;
	      msgEl.style.color = 'var(--danger)';
	    }
	  }

}
async function deactivateLicense() {
  var result = await chrome.storage.local.get('config');
  var config = mergeConfig(result.config);
  config.licenseKey = '';
  config.licenseEmail = '';
  await chrome.storage.local.set({ config: config });
  setVal('licenseKey', '');
  setVal('licenseEmail', '');
  var msgEl = document.getElementById('licenseMsg');
  if (msgEl) { msgEl.textContent = 'Deactivated. Back to Free tier.'; msgEl.style.color = 'var(--muted)'; }
  await updateLicenseStatus();
}

async function testLLM() {
  var apiKey = getVal('llmApiKey');
  var baseURL = getVal('llmBaseURL');
  var model = getVal('llmModel');
  if (!apiKey) { showStatus('Enter an API key first.', 'error'); focusSection('ai'); return; }
  showStatus('Testing...', '');

  try {
    var resp = await fetch(baseURL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ model: model || 'deepseek-chat', messages: [{ role: 'user', content: 'Reply "OK".' }], max_tokens: 10 }),
    });
    if (!resp.ok) { var txt = await resp.text(); showStatus('Failed: ' + resp.status + ' ' + txt.substring(0, 80), 'error'); return; }
    var data = await resp.json();
    showStatus('OK — ' + data.choices[0].message.content, 'success');
  } catch (e) {
    showStatus('Connection failed: ' + e.message, 'error');
  }
}

function showStatus(text, type) {
  var el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.className = type || '';
}

function focusSection(name) {
  Array.from(document.querySelectorAll('.tab')).forEach(function(t) {
    t.setAttribute('aria-selected', t.id === 'tab-' + name ? 'true' : 'false');
  });
  Array.from(document.querySelectorAll('.section')).forEach(function(p) {
    var active = p.id === 'section-' + name;
    p.classList.toggle('active', active);
    p.hidden = !active;
  });
}

function bindTabs() {
  document.querySelectorAll('.tab').forEach(function(t) {
    t.addEventListener('click', function() {
      var name = t.id.replace('tab-', '');
      focusSection(name);
      showStatus('', '');
      if (name === 'license') updateLicenseStatus();
    });
  });
}

async function openSidePanel() {
  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tab = tabs[0];
    if (tab && tab.url && tab.url.indexOf('web.whatsapp.com') >= 0) {
      await chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    } else {
      showStatus('Open WhatsApp Web first.', 'error');
    }
  } catch (e) {
    showStatus('Failed: ' + e.message, 'error');
  }
}

// =========== Init ===========
console.log('[popup] Waiting for DOMContentLoaded');

document.addEventListener('DOMContentLoaded', function() {
  console.log('[popup] DOM ready, binding...');
  loadSettings();
  bindTabs();

  var saveBtn = document.getElementById('saveBtn');
  var testBtn = document.getElementById('testBtn');
  var openBtn = document.getElementById('openPanelBtn');
  var activateBtn = document.getElementById('activateBtn');
  var deactivateBtn = document.getElementById('deactivateBtn');

  console.log('[popup] Elements found — saveBtn:', !!saveBtn, 'testBtn:', !!testBtn, 'activateBtn:', !!activateBtn);

  if (saveBtn) saveBtn.addEventListener('click', saveSettings);
  if (testBtn) testBtn.addEventListener('click', testLLM);
  if (openBtn) openBtn.addEventListener('click', openSidePanel);
  if (activateBtn) {
    activateBtn.addEventListener('click', function() {
      console.log('[popup] Activate button CLICKED');
      activateLicense();
    });
  } else {
    console.log('[popup] WARNING: activateBtn not found!');
  }
  if (deactivateBtn) {
    deactivateBtn.addEventListener('click', deactivateLicense);
  }

  console.log('[popup] Init done');
});
