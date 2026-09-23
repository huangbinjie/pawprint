import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { openHome } from "./helpers.mjs";
import { dayKey } from "../core/economy.mjs";
import { seedMatureCompanion } from "./fixtures/game.mjs";
import { desktopUsageFixture } from "./fixtures/codex.mjs";
import {
  TRAITS,
  GENE_KEYS,
  LABELS,
  GENE_COUNT,
  geneOdds,
  formatChance,
} from "../core/genetics.mjs";

test("gene catalog exposes every obtainable allele, honest odds and appearance variants", async ({}, testInfo) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pawprint-catalog-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, PAWPRINT_TEST_MODE: "1", PAWPRINT_TEST_DATA: dir },
  });
  try {
    const home = await openHome(app, "genes");
    const errors = [];
    home.on("pageerror", (e) => errors.push(e.message));
    await expect(
      home.getByRole("heading", { name: "基因图鉴", exact: true }),
    ).toBeVisible();
    await expect(home.locator(".catalog-count strong")).toHaveText(
      String(GENE_COUNT),
    );
    await home.getByRole("button", { name: "看看组合效果" }).click();
    await expect(home.locator(".combo-card")).toHaveCount(4);
    await home.screenshot({
      path: testInfo.outputPath("catalog-combinations.png"),
    });
    await home.getByRole("button", { name: "收起组合预览" }).click();
    let count = 0;
    for (const key of GENE_KEYS) {
      await home
        .getByRole("tab", { name: new RegExp(`^${LABELS[key]}(?:\\s|$)`) })
        .click();
      await expect(home.locator(".gene-option")).toHaveCount(
        TRAITS[key].length,
      );
      for (let index = 0; index < TRAITS[key].length; index++) {
        const card = home.locator(`[data-gene-id="${key}:${index}"]`);
        await expect(card.locator("h3")).toHaveText(TRAITS[key][index].name);
        await expect(card.locator(".gene-prob strong")).toHaveText(
          formatChance(geneOdds(key, index).visible),
        );
        const p = JSON.parse(
          await card.locator("svg.cat").getAttribute("data-phenotype"),
        );
        expect(p[key]).toBe(index);
        count++;
      }
      if (
        ["coat", "body", "face", "expression", "fur", "eyeSpacing"].includes(
          key,
        )
      ) {
        await home.locator(".workspace").evaluate((el) => (el.scrollTop = 0));
        await home.screenshot({
          path: testInfo.outputPath(`catalog-${key}.png`),
        });
      }
    }
    expect(count).toBe(171);
    await home.getByRole("tab", { name: /^毛色/ }).click();
    await home.getByRole("button", { name: "传说", exact: true }).click();
    const expected = TRAITS.coat.filter(
      (_, i) => geneOdds("coat", i).rarity.id === "legendary",
    ).length;
    await expect(home.locator(".gene-option")).toHaveCount(expected);
    await home.getByRole("button", { name: "全部稀有度" }).click();
    await home.getByLabel("搜索当前类别基因").fill("泥灰");
    await expect(home.locator(".gene-option")).toHaveCount(1);
    await home.getByLabel("搜索当前类别基因").fill("不存在的基因");
    await expect(home.locator(".catalog-empty")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("minimal floating lifecycle, double-click routes, background residency and position restore", async ({}, testInfo) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pawprint-shell-"));
  const env = {
    ...process.env,
    PAWPRINT_TEST_MODE: "1",
    PAWPRINT_TEST_DATA: dir,
  };
  let app = await electron.launch({ args: ["."], env });
  try {
    let floating = await app.firstWindow();
    await expect(floating.locator(".float-cat-button")).toBeVisible();
    await expect(
      floating.getByRole("button", { name: "桌面宠物蛋" }),
    ).toBeVisible();
    expect(app.windows()).toHaveLength(1);
    const beforeDrag = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds(),
    );
    await floating.mouse.move(110, 120);
    await floating.mouse.down();
    await floating.mouse.move(80, 90, { steps: 4 });
    await floating.mouse.up();
    await expect
      .poll(async () => {
        const b = await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].getBounds(),
        );
        return b.x < beforeDrag.x && b.y < beforeDrag.y;
      })
      .toBe(true);
    await expect(floating.getByRole("toolbar")).toHaveCount(0);
    await expect(
      floating.locator(".floating-header,.float-status"),
    ).toHaveCount(0);
    await floating.screenshot({
      path: testInfo.outputPath("floating-first-egg.png"),
      omitBackground: true,
    });
    let home = await openHome(app, "usage");
    await expect(
      home.getByRole("heading", { name: "用量与钱包", exact: true }),
    ).toBeVisible();
    await home.close();
    expect(app.windows()).toHaveLength(1);
    home = await openHome(app);
    await expect(
      home.getByRole("heading", { name: "我的小屋", exact: true }),
    ).toBeVisible();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith("#floating"))
        .setPosition(80, 80),
    );
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(path.join(dir, "save-v1.json"), "utf8"))
            .settings.floatingPosition,
      )
      .toEqual({ x: 80, y: 80 });
    await home.getByRole("button", { name: "收起桌面宠物" }).click();
    await expect.poll(() => app.windows().length).toBe(1);
    await home.close();
    expect(app.windows()).toHaveLength(0);
    // Even with no windows, the menu-bar app remains alive; Dock activation recovers its UI.
    const homeReady = app.waitForEvent("window");
    await app.evaluate(({ app }) => app.emit("activate"));
    home = await homeReady;
    await home.getByRole("button", { name: "放到桌面" }).click();
    await expect.poll(() => app.windows().length).toBe(2);
    await app.close();
    app = await electron.launch({ args: ["."], env });
    floating = await app.firstWindow();
    await expect(floating.locator(".float-cat-button")).toBeVisible();
    const bounds = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds(),
    );
    expect({ x: bounds.x, y: bounds.y }).toEqual({ x: 80, y: 80 });
    expect(app.windows()).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test("real desktop: hatch, connect, claim, breed, float, and persist", async ({}, testInfo) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pawprint-desktop-"));
  const fixture = path.join(dir, "codex-home");
  await desktopUsageFixture(fixture);
  await seedMatureCompanion(dir);
  const env = {
    ...process.env,
    PAWPRINT_TEST_MODE: "1",
    PAWPRINT_TEST_DATA: dir,
    PAWPRINT_TEST_CODEX_HOME: fixture,
    PAWPRINT_TEST_REPORT: "",
    PATH: "/pawprint-no-external-executables",
  };
  let app = await electron.launch({ args: ["."], env });
  const errors = [];
  try {
    let page = await openHome(app);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await expect(
      page.getByRole("heading", { name: "我的小屋", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("01-welcome.png") });
    await expect(page.locator(".identity-name")).toContainText("松露");
    await expect(page.locator(".growth-note").first()).toHaveText("已成年");
    await page
      .getByRole("button", { name: "连接本地用量", exact: true })
      .click();
    await page.getByRole("button", { name: "同意并连接本地用量" }).click();
    await page
      .getByRole("button", { name: "领取 120 宠物币", exact: true })
      .click();
    await expect(page.locator(".wallet-pill strong")).toHaveText("360");
    await page.getByRole("button", { name: "查看基因" }).click();
    await expect(
      page.getByRole("heading", { name: "松露的基因档案" }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("02-genetics.png") });
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    await page.screenshot({ path: testInfo.outputPath("03-home.png") });
    await page.getByRole("button", { name: "繁育计划", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("04-breeding.png") });
    await page.getByRole("button", { name: "开始繁育" }).click();
    await expect(page.locator(".wallet-pill strong")).toHaveText("180");
    await expect(
      page.getByRole("button", { name: "立即孵化", exact: true }),
    ).toBeEnabled({ timeout: 25000 });
    await page.getByRole("button", { name: "立即孵化", exact: true }).click();
    await page.getByLabel("它的名字").fill("松露二代");
    await page.getByRole("button", { name: "一起回小屋" }).click();
    await page.getByRole("button", { name: "宠物图鉴" }).click();
    await expect(page.locator(".pet-card")).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath("05-collection.png") });
    await page.getByRole("button", { name: "用量与钱包", exact: true }).click();
    await page.getByRole("button", { name: "刷新用量", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "今日奖励已领取" }),
    ).toBeDisabled();
    await expect(page.locator(".wallet-card h2")).toHaveText("180");
    await expect(page.locator(".source-label")).toContainText("内置读取器");
    await expect(page.getByText("CodexBar", { exact: false })).toHaveCount(0);
    const usageState = (await page.evaluate(() => window.pawprint.getState()))
      .data;
    expect(usageState.usage.report.source).toBe("builtin-codex-v1");
    expect(usageState.usage.report.diagnostics.files).toBe(1);
    await page.screenshot({ path: testInfo.outputPath("06-wallet.png") });
    await page.getByRole("button", { name: "我的小屋", exact: true }).click();
    await page.getByRole("button", { name: "收起桌面宠物" }).click();
    await expect.poll(() => app.windows().length).toBe(1);
    await page.getByRole("button", { name: "放到桌面" }).click();
    await expect.poll(() => app.windows().length).toBe(2);
    const floating = app.windows().find((w) => w !== page);
    await expect(floating.locator(".floating-pet")).toBeVisible();
    await floating.screenshot({
      path: testInfo.outputPath("07-floating.png"),
      omitBackground: true,
    });
    await page.getByRole("button", { name: "收起桌面宠物" }).click();
    await expect.poll(() => app.windows().length).toBe(1);
    await page.getByRole("button", { name: "放到桌面" }).click();
    // The renderer cannot inject usage observations or issue arbitrary currency.
    const denied = await page.evaluate(() =>
      window.pawprint.command({ type: "observe", report: {} }),
    );
    expect(denied.ok).toBe(false);
    await app.close();
    const saved = JSON.parse(
      await readFile(path.join(dir, "save-v1.json"), "utf8"),
    );
    expect(saved.balance).toBe(180);
    expect(saved.pets).toHaveLength(2);
    expect(saved.pets[1].parents[0].name).toBe("松露");
    app = await electron.launch({ args: ["."], env });
    page = await openHome(app);
    await expect(page.locator(".wallet-pill strong")).toHaveText("180");
    await expect(page.locator(".identity-name")).toContainText("松露二代");
    await expect(
      page.getByRole("button", { name: "免费领取初遇蛋" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "偏好设置", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("08-settings.png") });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("free first companion, new prices, juvenile gate and reversible garden placement", async ({}, testInfo) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pawprint-garden-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, PAWPRINT_TEST_MODE: "1", PAWPRINT_TEST_DATA: dir },
  });
  try {
    const home = await openHome(app);
    const errors = [];
    home.on("pageerror", (e) => errors.push(e.message));
    await home.getByRole("button", { name: "免费领取初遇蛋" }).click();
    await home.getByRole("button", { name: "迎接小家伙", exact: true }).click();
    await home.getByLabel("它的名字").fill("布丁");
    await home.getByRole("button", { name: "一起回小屋" }).click();
    await expect(
      home.getByRole("button", { name: "领养探索蛋 240" }),
    ).toBeDisabled();
    await expect(
      home.getByRole("button", { name: "扩建位置 600" }),
    ).toBeDisabled();
    await home.getByRole("button", { name: "繁育计划", exact: true }).click();
    await expect(
      home.getByRole("button", { name: "开始繁育 180" }),
    ).toBeDisabled();
    await expect(
      home.getByText("还在长大 · 陪伴 1/3 个活跃日", { exact: true }),
    ).toBeVisible();
    await home.getByRole("button", { name: "宠物图鉴" }).click();
    const before = (await home.evaluate(() => window.pawprint.getState())).data;
    await home
      .getByRole("button", { name: "去后花园生活", exact: true })
      .click();
    await expect(home.getByRole("dialog")).toContainText("不返币");
    await home.getByRole("button", { name: "继续留在小屋" }).click();
    await expect(home.locator(".pet-card")).toHaveCount(1);
    await home
      .getByRole("button", { name: "去后花园生活", exact: true })
      .click();
    await home.getByRole("button", { name: "安排去后花园" }).click();
    await expect(home.locator(".garden-pet")).toHaveCount(1);
    await expect.poll(() => app.windows().length).toBe(1);
    await home.screenshot({ path: testInfo.outputPath("garden-resting.png") });
    await home.getByRole("button", { name: "我的小屋", exact: true }).click();
    await expect(
      home.getByRole("heading", { name: "留一片阳光，等伙伴回来" }),
    ).toBeVisible();
    await expect(home.locator(".stage-egg .egg")).toHaveCount(0);
    await home.getByRole("button", { name: "后花园", exact: true }).click();
    await home.getByRole("button", { name: "接回小屋", exact: true }).click();
    await expect(home.locator(".garden-pet")).toHaveCount(0);
    await expect.poll(() => app.windows().length).toBe(2);
    const after = (await home.evaluate(() => window.pawprint.getState())).data;
    expect(after.balance).toBe(before.balance);
    expect(after.ledger).toEqual(before.ledger);
    expect(after.pets[0].genome).toEqual(before.pets[0].genome);
    expect(after.pets[0].activeDays).toEqual(before.pets[0].activeDays);
    await home.getByRole("button", { name: "用量与钱包", exact: true }).click();
    await expect(home.locator(".circulation-card")).toContainText(
      "已用于系统服务",
    );
    await home.screenshot({
      path: testInfo.outputPath("economy-v2-wallet.png"),
    });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
