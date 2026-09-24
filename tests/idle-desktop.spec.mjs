import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { seedMatureCompanion } from "./fixtures/game.mjs";
import { openHome } from "./helpers.mjs";

test("idle ball, real window roaming, hover stop, edge patrol and reduced motion", async ({}, info) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pawprint-idle-ui-"));
  await seedMatureCompanion(dir);
  const codex = path.join(dir, "codex");
  const folder = path.join(codex, "sessions", new Date().toISOString().slice(0, 10).replaceAll("-", "/"));
  await mkdir(folder, { recursive: true });
  const log = path.join(folder, "idle-activity.jsonl");
  await writeFile(log, "");
  const app = await electron.launch({ args: ["."], env: { ...process.env, PAWPRINT_TEST_MODE: "1", PAWPRINT_TEST_DATA: dir, PAWPRINT_TEST_LAN: "1", PAWPRINT_TEST_CODEX_HOME: codex } });
  const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("#floating")).getBounds());
  try {
    // CDP mouse events do not reliably move the macOS global cursor. Control that
    // input explicitly so the user's real mouse cannot make this test flaky.
    await app.evaluate(({ screen, app }) => {
      globalThis.pawTestCursor = { x: -100000, y: -100000 };
      screen.getCursorScreenPoint = () => globalThis.pawTestCursor;
      const path = process.getBuiltinModule("path");
      const req = process.getBuiltinModule("module").createRequire(path.join(app.getAppPath(), "package.json"));
      const { IdleDirector } = req("./core/idle.mjs");
      const original = IdleDirector.prototype.step;
      IdleDirector.prototype.step = function(input) {
        const result = original.call(this, input);
        globalThis.pawIdleDiagnostic = { enabled: input.enabled, blocked: input.blocked, position: input.position, visual: result.visual, waitMs: this.nextAt - input.now };
        return result;
      };
    });
    const floating = await app.firstWindow();
    const home = await openHome(app, "settings");
    const before = (await home.evaluate(() => window.pawprint.getState())).data;
    await home.getByRole("button", { name: "拿出玩具球", exact: true }).click();
    await home.mouse.move(20, 80);
    await expect(floating.getByRole("img", { name: "宠物玩具球" })).toBeVisible({ timeout: 10000 });
    expect(await floating.locator(".toy-ball").evaluate(el => getComputedStyle(el).animationName)).toBe("idle-ball-roll");
    await floating.screenshot({ path: info.outputPath("playing-ball.png"), omitBackground: true });
    await home.getByRole("switch", { name: "待机散步与玩耍", exact: true }).click();
    await expect(home.getByRole("switch", { name: "待机散步与玩耍", exact: true })).toHaveAttribute("aria-checked", "true");
    await home.mouse.move(20, 80);
    const start = await bounds();
    await expect(floating.locator(".idle-pose-walk")).toBeVisible({ timeout: 16000 });
    await expect.poll(async () => Math.abs((await bounds()).x - start.x)).toBeGreaterThan(10);
    expect((await bounds()).y).toBe(start.y);
    await floating.screenshot({ path: info.outputPath("walking.png"), omitBackground: true });
    await floating.mouse.move(110, 130);
    await app.evaluate(({ BrowserWindow }) => {
      const b = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("#floating")).getBounds();
      globalThis.pawTestCursor = { x: b.x + 110, y: b.y + 130 };
    });
    await expect(floating.locator("[data-idle-mode=rest]")).toBeVisible();
    const paused = await bounds();
    await floating.waitForTimeout(600);
    expect(await bounds()).toEqual(paused);
    // A drag changes the route origin; it does not get pulled back by the director.
    await floating.mouse.down();
    await floating.mouse.move(80, 100, { steps: 5 });
    await floating.mouse.up();
    const dragged = await bounds();
    expect(dragged.x).toBeLessThan(paused.x);
    expect(dragged.y).toBeLessThan(paused.y);
    await expect.poll(async () => JSON.parse(await readFile(path.join(dir, "save-v1.json"), "utf8")).settings.floatingPosition).toEqual({ x: dragged.x, y: dragged.y });
    // Patrol resumes along the display perimeter and rotates without shrinking.
    await app.evaluate(({BrowserWindow,screen}) => {
      globalThis.pawTestCursor = { x: -100000, y: -100000 };
      const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating'));
      const a=screen.getDisplayMatching(w.getBounds()).workArea;
      w.setPosition(a.x+a.width-w.getBounds().width,a.y+30);
    });
    await home.getByLabel("散步范围", { exact: true }).selectOption("edges");
    const edgeStart = await bounds();
    await expect(floating.locator(".idle-pose-walk")).toBeVisible({ timeout: 20000 });
    await expect(floating.locator(".idle-actor.edge-right")).toBeVisible();
    await expect.poll(async () => (await bounds()).y).toBeGreaterThan(edgeStart.y + 8);
    const scales=await floating.locator(".idle-actor").evaluate(el=>{const m=new DOMMatrix(getComputedStyle(el).transform);return [Math.hypot(m.a,m.b),Math.hypot(m.c,m.d)]});
    for(const scale of scales)expect(scale).toBeCloseTo(1,2);
    await floating.screenshot({ path: info.outputPath("edge-patrol.png"), omitBackground: true });
    await app.evaluate(({powerMonitor})=>powerMonitor.emit('lock-screen'));
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')).isVisible())).toBe(false);
    const locked=await bounds();
    await floating.waitForTimeout(500);
    expect(await bounds()).toEqual(locked);
    await app.evaluate(({powerMonitor})=>powerMonitor.emit('unlock-screen'));
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')).isVisible())).toBe(true);
    await app.evaluate(({powerMonitor})=>powerMonitor.emit('suspend'));
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')).isVisible())).toBe(false);
    await app.evaluate(({powerMonitor})=>powerMonitor.emit('resume'));
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#floating')).isVisible())).toBe(true);
    await app.evaluate(({ systemPreferences }) => {
      globalThis.pawOriginalMotion = systemPreferences.getAnimationSettings;
      systemPreferences.getAnimationSettings = () => ({ prefersReducedMotion: true });
    });
    await expect(floating.locator("[data-idle-mode=rest]")).toBeVisible();
    const reduced = await bounds();
    await floating.waitForTimeout(500);
    expect(await bounds()).toEqual(reduced);
    await expect(home.getByText("系统已开启“减少动态效果”，散步与玩球暂时休息。")).toBeVisible();
    await home.screenshot({ path: info.outputPath("idle-settings.png") });
    await app.evaluate(({ systemPreferences }) => { systemPreferences.getAnimationSettings = globalThis.pawOriginalMotion; });
    await home.evaluate(() => window.pawprint.command({ type: "activity", enabled: true, topics: false }));
    const row = type => JSON.stringify({ type: "event_msg", timestamp: new Date().toISOString(), payload: { type, turn_id: "idle-work" } }) + "\n";
    await appendFile(log, row("task_started"));
    await expect(floating.locator(".cat.working")).toBeVisible({ timeout: 10000 });
    const working = await bounds();
    await floating.waitForTimeout(6500);
    expect(await bounds()).toEqual(working);
    await appendFile(log, row("task_complete"));
    await expect(floating.locator(".cat.perform")).toBeVisible({ timeout: 10000 });
    expect(await bounds()).toEqual(working);
    await home.getByRole("switch", { name: "待机散步与玩耍", exact: true }).click();
    const after = (await home.evaluate(() => window.pawprint.getState())).data;
    expect(after.balance).toBe(before.balance);
    expect(after.ledger).toEqual(before.ledger);
    expect(after.pets[0].genome).toEqual(before.pets[0].genome);
  } catch (error) {
    console.log("Idle diagnostics:", await app.evaluate(() => globalThis.pawIdleDiagnostic));
    throw error;
  } finally { await app.close(); }
});
