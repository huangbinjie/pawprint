import { expect } from "@playwright/test";
export async function openHome(app, section = "home") {
  const existing = app
    .windows()
    .find((w) =>
      /#(home|usage|collection|breed|settings|genes|garden|nearby|talents|work|play|codex)$/.test(
        w.url(),
      ),
    );
  if (existing) {
    await existing.evaluate(
      (section) => window.pawprint.showHome(section),
      section,
    );
    return existing;
  }
  // Choose a trusted Home/floating owner, never a mini panel or pet-control window.
  await app.firstWindow();
  await expect.poll(()=>app.windows().some(w=>/#(floating|home|usage|collection|breed|settings|genes|garden|nearby|talents|work|play|codex)$/.test(w.url()))).toBe(true);
  const first=app.windows().find(w=>w.url().endsWith('#floating')) || app.windows().find(w=>/#(home|usage|collection|breed|settings|genes|garden|nearby|talents|work|play|codex)$/.test(w.url()));
  await first.waitForFunction(() => window.pawprint);
  await first.evaluate(section => window.pawprint.showHome(section), section);
  await expect.poll(()=>app.windows().some(w=>/#(home|usage|collection|breed|settings|genes|garden|nearby|talents|work|play|codex)$/.test(w.url()))).toBe(true);
  const home=app.windows().find(w=>/#(home|usage|collection|breed|settings|genes|garden|nearby|talents|work|play|codex)$/.test(w.url()));
  await home.waitForFunction(() => window.pawprint);
  return home;
}

export async function revealPetControls(app){
  const floating=app.windows().find(w=>w.url().endsWith('#floating'));
  await floating.locator('.float-cat-button').hover();
  await expect.poll(async()=>(await floating.evaluate(()=>window.pawprint.getState())).data.controlsRevealed).toBe(true);
}
export async function petControls(app,{reveal=true}={}){
  await expect.poll(()=>app.windows().some(w=>w.url().endsWith('#petcontrols'))).toBe(true);
  const page=app.windows().find(w=>w.url().endsWith('#petcontrols'));
  await expect(page.locator('.pet-control-dock')).toBeVisible();if(reveal)await revealPetControls(app);return page;
}

export async function openCodex(app,section='connections'){
 const home=await openHome(app,'codex');
 const labels={connections:/^(连接与 Provider|Connections & providers)$/,sessions:/^(会话与提醒|Chats & reminders)$/,usage:/^(用量与额度|Usage & limits)$/,advanced:/^(高级设置|Advanced settings)$/};
 await home.locator('.codex-tabs').getByRole('button',{name:labels[section]}).click();return home;
}

export async function openWorkPanelFromMenu(app) {
  await app.evaluate(({Menu})=>{
    if(globalThis.workMenuCaptureInstalled)return;
    globalThis.workMenuCaptureInstalled=true;
    const original=Menu.buildFromTemplate.bind(Menu);
    Menu.buildFromTemplate=items=>{const menu=original(items);if(items.some(i=>['工作会话与便签','Work chats & bookmarks'].includes(i.label)))globalThis.workTestNativeMenu=menu;return menu;};
  });
  const floating=app.windows().find(w=>w.url().endsWith('#floating'));
  await floating.evaluate(()=>window.pawprint.showMenu());
  await app.evaluate(()=>{const m=globalThis.workTestNativeMenu;if(!m)throw Error('Work menu not built');m.closePopup();m.items.find(i=>['工作会话与便签','Work chats & bookmarks'].includes(i.label)).click();});
  await expect.poll(()=>app.windows().some(w=>w.url().endsWith('#workmini'))).toBe(true);
  return app.windows().find(w=>w.url().endsWith('#workmini'));
}
