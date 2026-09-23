import { expect } from "@playwright/test";
export async function openHome(app, section = "home") {
  const existing = app
    .windows()
    .find((w) =>
      /#(home|usage|collection|breed|settings|genes|garden|nearby|talents|talents|nearby)$/.test(
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
  const floating = await app.firstWindow();
  await expect(floating.locator(".float-cat-button")).toBeVisible();
  const ready = app.waitForEvent("window");
  await floating.locator(".float-cat-button").dblclick();
  const home = await ready;
  await expect(
    home.getByRole("heading", { name: /^(我的小屋|My Home)$/ }),
  ).toBeVisible();
  if (section !== "home")
    await home.evaluate(
      (section) => window.pawprint.showHome(section),
      section,
    );
  return home;
}
