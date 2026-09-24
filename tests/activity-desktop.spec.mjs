import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { seedMatureCompanion } from "./fixtures/game.mjs";
import { openHome } from "./helpers.mjs";

test("Codex lifecycle drives transient pet feedback without spending or replaying history", async ({}, info) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pawprint-activity-ui-"));
  const profile = path.join(root, "profile"), codex = path.join(root, "codex");
  await seedMatureCompanion(profile);
  const date = new Date();
  const folder = path.join(codex, "sessions", String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0"));
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, "session.jsonl");
  const row = (type, extra = {}) => JSON.stringify({ timestamp: new Date().toISOString(), type: "event_msg", payload: { type, turn_id: "ui-turn", ...extra } }) + "\n";
  await writeFile(file, row("task_started") + row("task_complete"));
  const app = await electron.launch({ args: ["."], env: { ...process.env, PAWPRINT_TEST_MODE: "1", PAWPRINT_TEST_DATA: profile, PAWPRINT_TEST_CODEX_HOME: codex, PAWPRINT_TEST_LAN: "1" } });
  try {
    const floating = await app.firstWindow();
    const home = await openHome(app, "settings");
    const before = (await home.evaluate(() => window.pawprint.getState())).data;
    const petBounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')).getBounds());
    await app.evaluate(({BrowserWindow})=>{
      const original=BrowserWindow.prototype.setIgnoreMouseEvents;
      BrowserWindow.prototype.setIgnoreMouseEvents=function(ignore,...rest){if(this.getTitle()==='Pawprint Activity Bubble')globalThis.pawBubbleIgnoresMouse=ignore;return original.call(this,ignore,...rest)};
      const originalHide=BrowserWindow.prototype.hide;
      globalThis.pawBubbleHideCalls=0;
      BrowserWindow.prototype.hide=function(...args){if(this.getTitle()==='Pawprint Activity Bubble')globalThis.pawBubbleHideCalls++;return originalHide.apply(this,args)};
    });
    await home.getByRole("switch", { name: "Codex 会话联动", exact: true }).click();
    await home.getByRole("switch", { name: "显示大致主题", exact: true }).click();
    await expect(home.getByTestId("activity-status")).toContainText("等待新一轮会话");
    expect(app.windows().some(w=>w.url().startsWith("data:text/html"))).toBe(false);
    await appendFile(file, row("task_started") + row("item_completed", { item: { type: "UserMessage", content: [{ type: "Text", text: "帮我修复 SECRET 的错误" }] } }));
    await expect.poll(()=>app.windows().some(w=>w.url().startsWith("data:text/html")),{timeout:10000}).toBe(true);
    const bubble=app.windows().find(w=>w.url().startsWith("data:text/html"));
    await expect(bubble.locator('.bubble')).toContainText('陪你排查问题');
    expect(await app.evaluate(()=>globalThis.pawBubbleIgnoresMouse)).toBe(true);
    const placement=await app.evaluate(({BrowserWindow})=>{
      const pet=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating'));
      const bubble=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Pawprint Activity Bubble');
      return {pet:pet.getBounds(),bubble:bubble.getBounds()};
    });
    expect(placement.pet).toEqual(petBounds);
    expect(placement.bubble.y+placement.bubble.height).toBeLessThanOrEqual(placement.pet.y-8);
    await bubble.screenshot({path:info.outputPath('codex-bubble.png'),omitBackground:true});
    await expect(floating.locator(".cat.working")).toBeVisible();
    expect(await floating.locator(".cat-body").evaluate(el => getComputedStyle(el).animationName)).toBe("companion-work");
    await floating.screenshot({ path: info.outputPath("codex-working.png"), omitBackground: true });
    await home.screenshot({ path: info.outputPath("activity-settings.png") });
    await appendFile(file, row("task_complete", { last_agent_message: "PRIVATE final content" }));
    await expect(bubble.locator(".bubble")).toContainText("本轮回复结束啦", { timeout: 10000 });
    await expect(floating.locator(".cat.perform")).toBeVisible();
    await expect(floating.locator(".cat.working")).toHaveCount(0);
    await floating.screenshot({ path: info.outputPath("codex-completed.png"), omitBackground: true });
    const after = (await home.evaluate(() => window.pawprint.getState())).data;
    expect(after.balance).toBe(before.balance);
    expect(after.ledger).toEqual(before.ledger);
    expect(after.pets[0].genome).toEqual(before.pets[0].genome);
    expect(JSON.stringify(after.activity)).not.toMatch(/SECRET|PRIVATE/);
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>{
      const b=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='Pawprint Activity Bubble');return b?.isVisible() ?? false;
    }),{timeout:12000}).toBe(false);
    const hiddenCalls=await app.evaluate(()=>globalThis.pawBubbleHideCalls);
    await floating.waitForTimeout(650);
    expect(await app.evaluate(()=>globalThis.pawBubbleHideCalls)).toBe(hiddenCalls);
    await appendFile(file, row("task_complete"));
    await expect.poll(async () => (await home.evaluate(() => window.pawprint.getState())).data.activity.event).toBeNull();
    await home.getByRole("switch", { name: "Codex 会话联动", exact: true }).click();
    await expect(home.getByTestId("activity-status")).toContainText("已关闭");
  } catch(error) {
    const info=await app.evaluate(({BrowserWindow})=>({windows:BrowserWindow.getAllWindows().map(w=>({title:w.getTitle(),url:w.webContents.getURL().slice(0,55),visible:w.isVisible()})),activity:globalThis.pawLastActivity||null}));
    console.log('Bubble diagnostic:',JSON.stringify(info));
    throw error;
  } finally { await app.close(); }
});
