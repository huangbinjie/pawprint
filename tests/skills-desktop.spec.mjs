import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { seedMatureCompanion } from "./fixtures/game.mjs";
import { Store } from "../core/store.mjs";
import { IDLE_SKILLS, SOCIAL_SKILLS } from "../core/skills.mjs";
import { openHome } from "./helpers.mjs";
async function fixture(dir, many = false) {
  const s = await seedMatureCompanion(dir);
  if (many) {
    s.capacity = 4;
    s.pets = IDLE_SKILLS.map((skill, i) => ({ ...structuredClone(s.pets[0]), id: `skill-pet-${i}`, name: ["小米", "小麦", "小豆", "小星"][i], skills: { idle: skill.id, social: SOCIAL_SKILLS[i].id } }));
    s.activePetId = s.pets[0].id;
  }
  const store = new Store(dir); await store.load(); await store.save(s);
}
const start = dir => electron.launch({ args: ["."], env: { ...process.env, PAWPRINT_TEST_MODE: "1", PAWPRINT_TEST_DATA: dir, PAWPRINT_TEST_LAN: "1" } });
const floatBounds = app => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("#floating")).getBounds());

test("gift and four owned idle skills render, size previews resize only pets and survive restart", async ({}, info) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pawprint-skills-ui-"));
  await fixture(dir, true);
  let app = await start(dir);
  try {
    const home = await openHome(app, "talents");
    const before = (await home.evaluate(() => window.pawprint.getState())).data;
    for (let i = 0; i < IDLE_SKILLS.length; i++) {
      const s = IDLE_SKILLS[i];
      await home.getByLabel("选择才艺伙伴").selectOption(`skill-pet-${i}`);
      await home.getByRole("button", { name: `试试${s.name}`, exact: true }).click();
      await expect(home.locator(`.talent-stage .skill-${s.id}`)).toBeVisible();
      await home.locator(".talent-stage").screenshot({ path: info.outputPath(`skill-${s.id}.png`) });
    }
    await home.getByRole("button", { name: "试试拨弄玩具球", exact: true }).click();
    await expect(home.locator(".skill-ball-object")).toBeVisible();
    const forged = await home.evaluate(() => window.pawprint.performSkill("skill-pet-3", "groom"));
    expect(forged.ok).toBe(false);
    await home.evaluate(() => window.pawprint.showHome("settings"));
    const homeWidth = await home.evaluate(() => innerWidth);
    const slider = home.getByRole("slider", { name: "桌面宠物尺寸", exact: true });
    await slider.focus(); await slider.press("Home");
    for (let i = 0; i < 4; i++) await slider.press("ArrowRight");
    await expect.poll(async () => (await floatBounds(app)).width).toBe(154);
    await expect.poll(async () => (await home.evaluate(() => window.pawprint.getState())).data.settings.petScale).toBe(.7);
    expect((await floatBounds(app)).height).toBe(169);
    expect(await home.evaluate(() => innerWidth)).toBe(homeWidth);
    const floating = app.windows().find(w => w.url().endsWith("#floating"));
    await floating.screenshot({ path: info.outputPath("pet-70-percent.png"), omitBackground: true });
    await slider.scrollIntoViewIfNeeded();
    await home.screenshot({ path: info.outputPath("size-settings.png") });
    const after = (await home.evaluate(() => window.pawprint.getState())).data;
    expect(after.balance).toBe(before.balance);
    expect(after.pets.map(p => [p.genome, p.skills, p.talent])).toEqual(before.pets.map(p => [p.genome, p.skills, p.talent]));
    await app.close(); app = await start(dir);
    await app.firstWindow();
    await expect.poll(async () => (await floatBounds(app)).width).toBe(154);
  } finally { await app.close(); }
});

test("paired visitors perform four owned social skills and restore windows on completion or departure", async ({}, info) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pawprint-social-ui-"));
  await fixture(path.join(dir, "a")); await fixture(path.join(dir, "b"), true);
  const a = await start(path.join(dir, "a")), b = await start(path.join(dir, "b"));
  try {
    const pa = await openHome(a, "nearby"), pb = await openHome(b, "nearby");
    for (const page of [pa, pb]) {
      await page.getByRole("button", { name: "开启局域网小屋" }).click();
      await page.getByRole("button", { name: "同意并开启局域网" }).click();
    }
    const code = (await pb.evaluate(() => window.pawprint.getState())).data.lan.inviteCode;
    await pa.getByLabel("同事的连接码").fill(code);
    await pa.getByRole("button", { name: "申请连接", exact: true }).click();
    await pb.getByRole("button", { name: "接受连接" }).click();
    await expect(pa.getByRole("button", { name: "申请串门", exact: true }).first()).toBeEnabled({ timeout: 15000 });
    await pa.getByRole("button", { name: "申请串门", exact: true }).first().click();
    const denied = await pb.evaluate(() => window.pawprint.lan({ type: "social", visitId: "not-accepted", petId: "skill-pet-0", leader: "host", skillId: "highfive" }));
    expect(denied.ok).toBe(false);
    await pb.getByRole("button", { name: "欢迎来玩" }).click();
    await expect.poll(() => b.windows().some(w => w.url().includes("#guest:"))).toBe(true);
    const guest = b.windows().find(w => w.url().includes("#guest:"));
    const before = (await pb.evaluate(() => window.pawprint.getState())).data;
    const guestBounds = () => b.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes("#guest:")).getBounds());
    for (let i = 0; i < SOCIAL_SKILLS.length; i++) {
      const s = SOCIAL_SKILLS[i];
      await pb.getByLabel("派出的伙伴").selectOption(`skill-pet-${i}`);
      await pb.getByRole("button", { name: new RegExp(`带领：${s.name}`) }).first().click();
      await expect(guest.locator(`.social-${s.id} .cat`)).toHaveCount(2);
      expect((await guestBounds()).width).toBe(420);
      if (i === 3) {
        await pb.evaluate(() => window.pawprint.command({ type: "pet-scale", percent: 70 }));
        await expect.poll(async () => (await guestBounds()).width).toBe(294);
        expect((await floatBounds(b)).width).toBe(154);
      }
      await guest.screenshot({ path: info.outputPath(`social-${s.id}.png`), omitBackground: true });
      await guest.getByRole("button", { name: "结束合演" }).click();
      await expect(guest.getByRole("button", { name: "来访宠物" })).toBeVisible();
      expect((await guestBounds()).width).toBe(i === 3 ? 154 : 220);
      expect(await b.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("#floating")).isVisible())).toBe(true);
    }
    const after = (await pb.evaluate(() => window.pawprint.getState())).data;
    expect(after.balance).toBe(before.balance); expect(after.ledger).toEqual(before.ledger);
    // End a visit during a show: both the scene and hidden resident must recover.
    await pb.getByRole("button", { name: /小星带领：星光合奏/ }).click();
    await pb.getByRole("button", { name: "送它回家", exact: true }).click();
    await expect.poll(() => b.windows().some(w => w.url().includes("#guest:"))).toBe(false);
    expect(await b.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("#floating")).isVisible())).toBe(true);
  } finally { await a.close(); await b.close(); }
});
