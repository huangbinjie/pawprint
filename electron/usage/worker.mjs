import { parentPort, workerData } from "node:worker_threads";
import { scanUsage } from "./scanner.mjs";
import { loadCatalog } from "./catalog.mjs";
import {readTurnRoutes} from '../codex-route-evidence.mjs';
try {
  parentPort.postMessage({ ok: true, report: await scanUsage({ ...workerData, turnRoutes:await readTurnRoutes(workerData.routeDirectory), days: 30, ...await loadCatalog(workerData) }) });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error.message || "本地用量读取失败，请检查记录目录。",
  });
}
