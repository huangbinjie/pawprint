import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/desktop.spec.mjs", "**/lan-desktop.spec.mjs", "**/activity-desktop.spec.mjs", "**/idle-desktop.spec.mjs", "**/skills-desktop.spec.mjs", "**/quota-desktop.spec.mjs", "**/locale-desktop.spec.mjs", "**/gentle-desktop.spec.mjs"],
  timeout: 150000,
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
