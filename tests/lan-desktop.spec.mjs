import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { seedMatureCompanion } from "./fixtures/game.mjs";
import { openHome } from "./helpers.mjs";
async function start(dir) {
  return electron.launch({
    args: ["."],
    env: {
      ...process.env,
      PAWPRINT_TEST_MODE: "1",
      PAWPRINT_TEST_DATA: dir,
      PAWPRINT_TEST_LAN: "1",
      PAWPRINT_TEST_REPORT: "",
      PAWPRINT_TEST_CODEX_HOME: "",
    },
  });
}
test("talent performance and paid practice have real visible effects", async ({}, info) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pawprint-talent-ui-"));
  await seedMatureCompanion(dir);
  const app = await start(dir);
  try {
    const home = await openHome(app, "talents");
    await expect(
      home.getByRole("heading", { name: "才艺小剧场", exact: true }),
    ).toBeVisible();
    const before = (await home.evaluate(() => window.pawprint.getState())).data;
    await home.getByRole("button", { name: "表演一下", exact: true }).click();
    await expect(home.locator(".talent-stage .cat.perform")).toBeVisible();
    const anim = await home
      .locator(".talent-stage .cat-body")
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).toBe("talent-wave");
    await home.getByRole("button", { name: "练习课程 · 120 币" }).click();
    await expect(home.getByText("Lv.2 · 熟练")).toBeVisible();
    await home.getByRole("button", { name: "表演一下", exact: true }).click();
    await expect(home.locator(".talent-stage .talent-sparkles")).toBeVisible();
    const after = (await home.evaluate(() => window.pawprint.getState())).data;
    expect(after.balance).toBe(before.balance - 120);
    expect(after.pets[0].genome).toEqual(before.pets[0].genome);
    expect(after.pets[0].talent.id).toBe(before.pets[0].talent.id);
    await home.screenshot({ path: info.outputPath("talent-stage.png") });
  } finally {
    await app.close();
  }
});
test("two desktop clients pair, approve a visit, settle breeding and persist exactly once", async ({}, info) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pawprint-two-client-"));
  const aDir = path.join(root, "a"),
    bDir = path.join(root, "b");
  await seedMatureCompanion(aDir);
  await seedMatureCompanion(bDir);
  let a = await start(aDir),
    b = await start(bDir);
  try {
    let pa = await openHome(a, "nearby"),
      pb = await openHome(b, "nearby");
    const errors = [];
    pa.on("pageerror", (e) => errors.push(e.message));
    pb.on("pageerror", (e) => errors.push(e.message));
    for (const [page, name] of [
      [pa, "阿青的小屋"],
      [pb, "小周的小屋"],
    ]) {
      await page.getByRole("button", { name: "开启局域网小屋" }).click();
      await page.getByRole("button", { name: "同意并开启局域网" }).click();
      await page.getByLabel("局域网小屋名字").fill(name);
      await page.getByRole("button", { name: "保存名字" }).click();
    }
    const code = (await pb.evaluate(() => window.pawprint.getState())).data.lan
      .inviteCode;
    await pa.getByLabel("同事的连接码").fill(code);
    await pa.getByRole("button", { name: "申请连接", exact: true }).click();
    await pb.getByRole("button", { name: "接受连接" }).click();
    await expect(pa.locator(".neighbor")).toContainText("小周的小屋");
    await expect(
      pa.getByRole("button", { name: "申请串门", exact: true }),
    ).toBeEnabled({ timeout: 15000 });
    await pa.getByRole("button", { name: "申请串门", exact: true }).click();
    await expect(pb.getByRole("button", { name: "欢迎来玩" })).toBeVisible();
    expect(b.windows()).toHaveLength(2);
    await pb.getByRole("button", { name: "欢迎来玩" }).click();
    await expect.poll(() => b.windows().length).toBe(3);
    const guest = b.windows().find((w) => w.url().includes("#guest:"));
    await expect(guest.getByRole("button", { name: "来访宠物" })).toBeVisible();
    await guest.getByRole("button", { name: "来访宠物" }).click();
    await expect(guest.locator(".cat.perform")).toBeVisible();
    await guest.screenshot({
      path: info.outputPath("visitor.png"),
      omitBackground: true,
    });
    await pb.screenshot({ path: info.outputPath("visit-approved.png") });
    await pb.getByRole("button", { name: "送它回家", exact: true }).click();
    await expect.poll(() => b.windows().length).toBe(2);
    await pa.getByRole("button", { name: "申请配种 · 240 币" }).click();
    await expect(
      pa.getByRole("dialog", { name: "确认局域网配种" }),
    ).toBeVisible();
    await pa.getByRole("button", { name: "确认申请并预留 240 币" }).click();
    await expect
      .poll(
        async () =>
          (await pa.evaluate(() => window.pawprint.getState())).data.heldCoins,
      )
      .toBe(240);
    await pb.getByRole("button", { name: "查看并确认" }).click();
    await pb.getByRole("button", { name: "确认接受配种" }).click();
    await expect
      .poll(
        async () =>
          (await pa.evaluate(() => window.pawprint.getState())).data.eggs
            .length,
        { timeout: 15000 },
      )
      .toBe(1);
    let sa = (await pa.evaluate(() => window.pawprint.getState())).data,
      sb = (await pb.evaluate(() => window.pawprint.getState())).data;
    expect(sa.balance).toBe(0);
    expect(sb.balance).toBe(300);
    expect(sa.heldCoins).toBe(0);
    expect(sa.pets[0].breedCount).toBe(1);
    expect(sb.pets[0].breedCount).toBe(1);
    await pa.screenshot({ path: info.outputPath("breeding-complete.png") });
    await pa.evaluate(() => window.pawprint.lan({ type: "refresh" }));
    expect(
      (await pa.evaluate(() => window.pawprint.getState())).data.eggs.length,
    ).toBe(1);
    await a.close();
    a = await start(aDir);
    pa = await openHome(a, "nearby");
    sa = (await pa.evaluate(() => window.pawprint.getState())).data;
    expect(sa.balance).toBe(0);
    expect(sa.eggs.length).toBe(1);
    expect(sa.lan.enabled).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});
