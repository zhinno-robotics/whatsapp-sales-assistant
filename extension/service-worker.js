/**
 * Service Worker — programmatic content script injection + side panel control.
 */
const WA_URL = 'https://web.whatsapp.com/';

// Inject content.js when WhatsApp Web loads
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !tab.url.startsWith(WA_URL)) return;

  chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] }).catch(() => {});
  chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'], world: 'ISOLATED' }).catch(() => {});

  const { autoOpen } = await chrome.storage.local.get({ autoOpen: true });
  if (autoOpen) await chrome.sidePanel.open({ windowId: tab.windowId });
});

// Icon click → open side panel
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openSidePanel') {
    if (sender.tab?.windowId) chrome.sidePanel.open({ windowId: sender.tab.windowId });
    sendResponse({ ok: true });
    return;
  }
  if (message.action === 'getAutoOpen') {
    chrome.storage.local.get({ autoOpen: true }).then(sendResponse);
    return true;
  }
  if (message.action === 'setAutoOpen') {
    chrome.storage.local.set({ autoOpen: message.value }).then(() => sendResponse({ ok: true }));
    return true;
  }
});
