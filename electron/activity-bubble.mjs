import { BrowserWindow, screen } from 'electron';
import { bubblePosition } from '../core/desktop.mjs';

const WIDTH = 210;
const HEIGHT = 82;
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function documentFor(label, subtitle) {
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;background:transparent;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif}.bubble{height:100%;background:#fffffff5;border:1px solid #dfe8d5;border-radius:14px;box-shadow:0 3px 10px #3c4a2e12;color:#4e6242;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 10px;line-height:1.4;font-size:14px}.bubble small{font-size:11px;color:#77876c;margin-top:3px}</style></head><body><div class="bubble" role="status"><span>${escape(label)}</span>${subtitle ? `<small>${escape(subtitle)}</small>` : ''}</div></body></html>`;
}
export class ActivityBubble {
  constructor() { this.window = null; this.key = null; }
  hide() { if (this.window && !this.window.isDestroyed()) this.window.hide(); this.key = null; }
  update({ pet, event, subtitle, now = Date.now() }) {
    if (!pet || !event || now - event.at >= 8000) { this.hide(); return; }
    const area = screen.getDisplayMatching(pet).workArea;
    const pos = bubblePosition(pet, area, { width: WIDTH, height: HEIGHT });
    if (!this.window || this.window.isDestroyed()) {
      this.window = new BrowserWindow({ ...pos, width: WIDTH, height: HEIGHT,
        frame: false, title: 'Pawprint Activity Bubble', transparent: true, backgroundColor: '#00000000',
        resizable: false, movable: false, focusable: false, alwaysOnTop: true,
        skipTaskbar: true, hasShadow: false, show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
      this.window.setIgnoreMouseEvents(true);
      this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    } else this.window.setPosition(pos.x, pos.y, false);
    const key = `${event.at}:${event.text}:${subtitle || ''}`;
    if (this.key !== key) {
      this.key = key;
      this.window.webContents.once('did-finish-load', () => { if (this.key === key && !this.window.isDestroyed()) this.window.showInactive(); });
      void this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(documentFor(event.text, subtitle))}`);
    } else if (!this.window.isVisible()) this.window.showInactive();
  }
  close() { if (this.window && !this.window.isDestroyed()) this.window.destroy(); this.window = null; this.key = null; }
}
