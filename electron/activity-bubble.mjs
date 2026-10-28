import { BrowserWindow, screen } from 'electron';
import { bubblePosition } from '../core/desktop.mjs';

const textWidth = text => [...String(text || '')].reduce((width, char) => width + (/[^\x00-\xff]/.test(char) ? 13 : 7.2), 0);
function bubbleSize(text, subtitle) {
  const width = Math.min(210, Math.max(96, Math.ceil(Math.max(textWidth(text), textWidth(subtitle)) + 22)));
  const lines = Math.min(2, Math.max(1, Math.ceil(textWidth(text) / (width - 22))));
  return { width, height: 14 + lines * 18 + (subtitle ? 16 : 0) };
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function documentFor(label, subtitle, threadId) {
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;background:transparent;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif}.bubble{height:100%;background:#fffffff5;border:1px solid #dfe8d5;border-radius:10px;box-shadow:0 3px 10px #3c4a2e12;color:#4e6242;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6px 10px;line-height:18px;font-size:13px}.bubble>span{max-width:100%;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.bubble small{max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;line-height:14px;color:#77876c;margin-top:2px}</style></head><body><a class="bubble" style="text-decoration:none" ${threadId ? `href="pawprint-work:${encodeURIComponent(threadId)}" aria-label="打开对应会话"` : 'role="status"'}><span>${escape(label)}</span><small${subtitle ? '' : ' hidden'}>${escape(subtitle || '')}</small></a></body></html>`;
}
export class ActivityBubble {
  constructor({ onOpen } = {}) { this.window = null; this.key = null; this.onOpen = onOpen; }
  hide() { if (this.key === null) return; this.key = null; if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide(); }
  update({ pet, event, subtitle, now = Date.now(), expiresAt }) {
    if (!pet || !event || now >= (expiresAt ?? event.at + 8000)) { this.hide(); return; }
    const target = this.onOpen ? event.threadId : null;
    const area = screen.getDisplayMatching(pet).workArea;
    const size = bubbleSize(event.text, subtitle);
    const pos = bubblePosition({ ...pet, y: pet.y + Math.round(pet.height * .2), height: Math.round(pet.height * .8) }, area, size);
    if (!this.window || this.window.isDestroyed()) {
      this.window = new BrowserWindow({ ...pos, ...size,
        frame: false, title: 'Pawprint Activity Bubble', transparent: true, backgroundColor: '#00000000',
        resizable: false, movable: false, focusable: false, alwaysOnTop: true,
        skipTaskbar: true, hasShadow: false, acceptFirstMouse: true, show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
      this.window.webContents.on("will-navigate", (e, url) => { e.preventDefault(); if (url.startsWith("pawprint-work:") && this.onOpen) this.onOpen(decodeURIComponent(url.slice(14))); });
      this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    } else this.window.setBounds({ ...pos, ...size }, false);
    this.window.setIgnoreMouseEvents(!target);
    const key = `${event.at}:${event.text}:${subtitle || ''}`;
    if (this.key !== key) {
      this.key = key;
      const window=this.window,payload=JSON.stringify({label:event.text,subtitle:subtitle || '',target});
      // Only serialized text reaches this owned document. Update the countdown
      // in place so each tick does not navigate/reload the bubble.
      const render=()=>{
        if(this.key!==key||this.window!==window||window.isDestroyed())return;
        void window.webContents.executeJavaScript(`(()=>{const p=${payload},root=document.querySelector('.bubble'),small=root.querySelector('small');root.querySelector('span').textContent=p.label;small.textContent=p.subtitle;small.hidden=!p.subtitle;if(p.target){root.setAttribute('href','pawprint-work:'+encodeURIComponent(p.target));root.setAttribute('aria-label','打开对应会话');root.removeAttribute('role');}else{root.removeAttribute('href');root.removeAttribute('aria-label');root.setAttribute('role','status');}})()`)
          .then(()=>{if(this.key===key&&!window.isDestroyed())window.showInactive();}).catch(()=>{if(this.key===key)this.hide();});
      };
      if(!window.webContents.getURL().startsWith('data:text/html')){
        window.webContents.once('did-finish-load',render);
        void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(documentFor(event.text, subtitle, target))}`).catch(()=>{if(this.key===key)this.hide();});
      }else if(window.webContents.isLoading())window.webContents.once('did-finish-load',render);
      else render();
    } else if (!this.window.isVisible()&&!this.window.webContents.isLoading()) this.window.showInactive();
  }
  close() { if (this.window && !this.window.isDestroyed()) this.window.destroy(); this.window = null; this.key = null; }
}
