import { parentPort, workerData } from "node:worker_threads";
import { scanQuota } from "./scan.mjs";
try { parentPort.postMessage({ ok: true, data: await scanQuota(workerData) }); }
catch { parentPort.postMessage({ ok: false }); }
