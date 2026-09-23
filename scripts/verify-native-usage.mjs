import { writeFile, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readUsage } from "../electron/local-usage.mjs";
const cacheDirectory = await mkdtemp(
  path.join(os.tmpdir(), "pawprint-native-live-"),
);
const first = await readUsage({ cacheDirectory });
const second = await readUsage({ cacheDirectory });
if (!first.complete || !second.complete)
  throw new Error(
    "Native scan incomplete: " + JSON.stringify(second.diagnostics),
  );
const result = {
  checkedAt: new Date().toISOString(),
  source: second.source,
  pricingVersion: second.pricingVersion,
  complete: second.complete,
  unpriced: second.unpriced,
  cold: first.diagnostics,
  warm: second.diagnostics,
  today: second.days.at(-1),
};
await mkdir("work/native-usage", { recursive: true });
await writeFile(
  "work/native-usage/live-result.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
