import { Worker } from "node:worker_threads";
import os from "node:os";
import path from "node:path";
import { normalizeReport } from "../core/economy.mjs";
export function defaultCodexHome() {
  return process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), ".codex");
}
export function readUsage({
  codexHome = defaultCodexHome(),
  cacheDirectory,
  now = Date.now(),
}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./usage/worker.mjs", import.meta.url), {
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 192 },
      workerData: { codexHome, cacheDirectory, now },
    });
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      void worker.terminate();
      error ? reject(error) : resolve(value);
    };
    const timeout = setTimeout(
      () =>
        finish(
          new Error("本地扫描超过 60 秒，请稍后刷新；已有宠物币不受影响。"),
        ),
      60000,
    );
    worker.once("message", (message) => {
      if (!message.ok) {
        finish(new Error(message.error));
        return;
      }
      try {
        finish(null, normalizeReport(message.report, Date.now()));
      } catch (error) {
        finish(error);
      }
    });
    worker.once("error", () =>
      finish(new Error("本地读取器暂时无法启动，请重启爪印后重试。")),
    );
    worker.once("exit", (code) => {
      if (!finished)
        finish(new Error(`本地读取器提前退出（${code}），请重新刷新。`));
    });
  });
}
