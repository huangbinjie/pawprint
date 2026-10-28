import {app,BrowserWindow} from 'electron';

app.setPath('userData',process.env.PAWPRINT_BACKGROUND_TEST_PROFILE);
app.whenReady().then(async()=>{
const window=new BrowserWindow({width:900,height:650,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
await window.loadURL('data:text/html,'+encodeURIComponent(`<!doctype html><html data-theme="light"><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; media-src blob: data:; style-src 'unsafe-inline'">
<style>
html[data-theme=light]{--color-text-primary:#1a1c1f}html[data-theme=dark]{--color-text-primary:#fff}
html,body{margin:0;height:100%;background:#181818;color:var(--color-text-primary);font:16px sans-serif}
#root{height:100%;background:#222}.shell{height:100%;display:flex;background:#181818}
aside{width:180px;background:#252525;padding:20px}main{flex:1;display:flex;flex-direction:column;background:#202020;padding:20px}
header{height:40px;background:#303030}.spacer{flex:1}
[data-composer-surface-variant]{padding:15px;background:#333}textarea{width:85%;height:70px}button{padding:10px}
</style></head><body><div id="root"><div class="shell"><aside class="app-shell-left-panel">Chats</aside>
<main data-app-shell-main-surface="default"><header data-app-shell-header-edge-scroll>Codex background fixture</header>
<div data-markdown-text-style="assistant-message"><p>Readable text over bright artwork.</p></div>
<div id="fixture-nested-markdown" data-markdown-text-style="assistant-message"><div data-markdown-text-style="assistant-message"><p>Nested markdown</p></div></div>
<div class="messaging-root" data-theme="light"><div class="messaging-root"><div class="thread-pane" style="background:white"><div class="message-bubble" style="background:#b2d800;color:black">Dot message</div></div></div></div>
<div id="fixture-settings" class="_MainContentFrame_fixture" style="margin-top:46px"><div class="electron:bg-surface"><div data-density="default">Settings</div><div class="draggable electron:h-toolbar" style="height:46px"></div></div></div>
<div class="_background_fixture _fade_fixture" style="position:absolute;bottom:120px;width:100%;height:40px;background:linear-gradient(to top,#181818,transparent)"></div>
<div class="spacer"></div><div data-thread-scroll-footer style="position:relative"><div class="_background_fixture _surface_fixture" style="position:absolute;inset:0;background:#181818"></div><section data-composer-surface-variant="default" style="position:relative"><textarea aria-label="Message"></textarea><button id="send">Send</button></section></div>
</main></div></div></body></html>`));
});
app.on('window-all-closed',()=>app.quit());
