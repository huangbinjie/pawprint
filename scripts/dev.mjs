import { spawn } from "node:child_process";
import electron from "electron";
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
  stdio: "inherit",
});
let desktop;
const stop = () => {
  desktop?.kill();
  vite.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (let attempt = 0; attempt < 100; attempt++) {
  try {
    await fetch("http://127.0.0.1:5173");
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}
desktop = spawn(electron, [".", "--dev"], {
  stdio: "inherit",
  env: process.env,
});
desktop.on("exit", (code) => {
  vite.kill();
  process.exit(code || 0);
});
