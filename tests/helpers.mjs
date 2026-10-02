import { expect } from "@playwright/test";
export async function openHome(app, section = "home") {
  const existing = app
    .windows()
    .find((w) =>
      /#(home|usage|collection|breed|settings|genes|garden|nearby|talents|work|play)$/.test(
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
  await floating.locator(".float-cat-button").dblclick();
  await expect.poll(()=>app.windows().some(w=>w.url().endsWith("#home"))).toBe(true);
  const home=app.windows().find(w=>w.url().endsWith("#home"));
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
