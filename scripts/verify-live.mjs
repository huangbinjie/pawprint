import { openHome } from "../tests/helpers.mjs";
import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const dir = await mkdtemp(path.join(os.tmpdir(), "pawprint-live-"));
await mkdir("work/live-qa", { recursive: true });
const app = await electron.launch({
  args: ["."],
  env: {
    ...process.env,
    PAWPRINT_TEST_MODE: "1",
    PAWPRINT_TEST_DATA: dir,
    PAWPRINT_TEST_REPORT: "",
  },
});
try {
  const page = await openHome(app);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "免费领取初遇蛋" }).click();
  await page.getByRole("button", { name: "迎接小家伙", exact: true }).click();
  await page.getByLabel("它的名字").fill("团团");
  await page.getByRole("button", { name: "一起回小屋" }).click();
  await page.getByRole("button", { name: "连接本地用量", exact: true }).click();
  await page.getByRole("button", { name: "同意并连接本地用量" }).click();
  await expect
    .poll(
      async () => {
        const r = await page.evaluate(() => window.pawprint.getState());
        return r.data.usage.report !== null || r.data.usage.lastError !== null;
      },
      { timeout: 70000, intervals: [500, 1000] },
    )
    .toBe(true);
  let state = (await page.evaluate(() => window.pawprint.getState())).data;
  if (state.usage.lastError) throw new Error(state.usage.lastError);
  if (!state.usage.report.complete)
    throw new Error("Live report coverage is incomplete");
  const available = state.availableReward;
  if (available > 0) {
    await page
      .getByRole("button", { name: `领取 ${available} 宠物币`, exact: true })
      .click();
    await expect(page.locator(".wallet-pill strong")).toHaveText(
      String(available),
    );
  }
  await page.screenshot({ path: "work/live-qa/home.png" });
  await page.getByRole("button", { name: "用量与钱包", exact: true }).click();
  await page.getByRole("button", { name: "刷新用量", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "刷新用量", exact: true }),
  ).toBeEnabled({ timeout: 70000 });
  state = (await page.evaluate(() => window.pawprint.getState())).data;
  if (state.balance !== available)
    throw new Error("Duplicate currency issued on repeat scan");
  await page.screenshot({ path: "work/live-qa/usage.png" });
  const today = state.usage.report.days.find((d) => d.date === state.today);
  const result = {
    checkedAt: new Date().toISOString(),
    source: state.usage.report.source,
    complete: state.usage.report.complete,
    unpriced: state.usage.report.unpriced,
    todayTokens: today?.tokens,
    todayEstimatedUSD: today?.usd,
    claimedInIsolatedSave: state.balance,
    repeatScanDidNotDuplicate: true,
    rendererErrors: errors,
  };
  if (errors.length) throw new Error(errors.join("; "));
  await writeFile("work/live-qa/result.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await app.close();
}
