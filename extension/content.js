/**
 * Content script — just a floating button to open the side panel.
 */
(function(){
  var id = '__wa_asst_btn';
  if (document.getElementById(id)) return;
  var btn = document.createElement('div');
  btn.id = id;
  btn.title = 'Sales Assistant';
  btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="12" y1="7" x2="12" y2="13"/></svg>';
  btn.style.cssText = 'position:fixed;bottom:20px;right:20px;width:44px;height:44px;border-radius:50%;background:#00a884;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
  btn.onmouseenter = function(){btn.style.transform='scale(1.1)';};
  btn.onmouseleave = function(){btn.style.transform='scale(1)';};
  btn.onclick = function(){try{chrome.runtime.sendMessage({action:'openSidePanel'});}catch(e){}};
  document.body.appendChild(btn);
})();
