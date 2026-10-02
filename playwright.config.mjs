import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/client-helper-desktop.spec.mjs","**/assistant-retired-desktop.spec.mjs","**/work-mini-desktop.spec.mjs","**/work-play-desktop.spec.mjs","**/pet-card-desktop.spec.mjs", "**/windows-desktop.spec.mjs", "**/desktop.spec.mjs", "**/lan-desktop.spec.mjs", "**/activity-desktop.spec.mjs", "**/idle-desktop.spec.mjs", "**/skills-desktop.spec.mjs", "**/quota-desktop.spec.mjs", "**/locale-desktop.spec.mjs", "**/gentle-desktop.spec.mjs"],
  timeout: 150000,
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
