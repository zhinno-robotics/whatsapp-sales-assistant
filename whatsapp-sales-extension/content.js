/**
 * content.js — ISOLATED world content script
 * Injects page-script.js into the page (MAIN world).
 * Bridges communication between page-script.js and background.js.
 */
(function () {
  'use strict';

  if (window.__WASAP_CONTENT_LOADED) return;
  window.__WASAP_CONTENT_LOADED = true;

  const EVENT_FROM_PAGE = 'wasap:page:event';
  const EVENT_TO_PAGE = 'wasap:page:command';
  let bgUnreachable = false;

  // Inject page-script.js into MAIN world
  function injectPageScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page-script.js');
    script.onload = () => { script.remove(); };
    (document.head || document.documentElement).appendChild(script);
  }

  injectPageScript();

  // Forward events from page-script.js → background.js (with retry)
  function forwardToBg(type, data, attempt = 0) {
    chrome.runtime.sendMessage({ source: 'page-script', type, data })
      .catch(() => {
        if (attempt < 3) {
          setTimeout(() => forwardToBg(type, data, attempt + 1), 500 * (attempt + 1));
        }
        bgUnreachable = true;
      });
  }

  window.addEventListener(EVENT_FROM_PAGE, (e) => {
    const { type, data } = e.detail;
    forwardToBg(type, data);
  });

  // Receive commands from background.js → forward to page-script.js
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.source === 'background' && message.action) {
      window.dispatchEvent(new CustomEvent(EVENT_TO_PAGE, {
        detail: { action: message.action, params: message.params || {} }
      }));
    }
    sendResponse({ ok: true });
    return false;
  });

  // Notify background — may fail silently if SW not yet ready
  forwardToBg('content_ready', {});
})();
