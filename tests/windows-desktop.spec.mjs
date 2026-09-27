import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';

test('packaged Windows app opens home, creates tray and preserves preferences', async () => {
  test.skip(process.platform !== 'win32' || !process.env.CI, 'Runs on an isolated Windows CI runner');
  const executablePath = path.resolve('release/win-unpacked/Pawprint.exe');
  let desktop = await electron.launch({ executablePath });
  try {
    let page = await desktop.firstWindow();
    await page.waitForFunction(() => window.pawprint);
    await page.evaluate(() => window.pawprint.showHome('settings'));
    await expect.poll(() => desktop.windows().some(w => !w.url().endsWith('#floating') && w.url().includes('index.html#'))).toBe(true);
    page = desktop.windows().find(w => !w.url().endsWith('#floating') && w.url().includes('index.html#'));
    await page.waitForFunction(() => window.pawprint);
    const result = await page.evaluate(() => window.pawprint.getState());
    expect(result.ok).toBe(true);
    expect(result.data.platform).toBe('win32');
    expect(result.data.trayStatus.created).toBe(true);
    const language = result.data.settings.language === 'en' ? 'zh' : 'en';
    expect((await page.evaluate(value => window.pawprint.command({type:'language', value}), language)).ok).toBe(true);
    await desktop.close();
    desktop = await electron.launch({ executablePath });
    page = await desktop.firstWindow();
    await page.waitForFunction(() => window.pawprint);
    expect((await page.evaluate(() => window.pawprint.getState())).data.settings.language).toBe(language);
  } finally { await desktop.close(); }
});
