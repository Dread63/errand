// Keeps a hidden frame in the page and re-adds it whenever it disappears, like real extensions do.
function ensureFrame() {
  if (document.getElementById('injector-frame')) return;
  const f = document.createElement('iframe');
  f.id = 'injector-frame';
  f.src = chrome.runtime.getURL('frame.html');
  f.style.cssText = 'width:1px;height:1px;border:0;position:absolute;left:-9999px';
  document.documentElement.appendChild(f);
}
ensureFrame();
setInterval(ensureFrame, 50);
