import { mkdir, writeFile, utimes } from "node:fs/promises";
import path from "node:path";
export function tokens(
  input = 1000,
  output = 100,
  cached = 0,
  write = 0,
  reasoning = 0,
) {
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    cache_write_input_tokens: write,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: input + output,
  };
}
export const meta = (id, time, extras = {}) => ({
  timestamp: new Date(time).toISOString(),
  type: "session_meta",
  payload: {
    id,
    session_id: id,
    timestamp: new Date(time).toISOString(),
    model_provider: "openai",
    ...extras,
  },
});
export const context = (
  time,
  model = "gpt-6-astra",
  turn = "turn-1",
  service_tier = null,
) => ({
  timestamp: new Date(time).toISOString(),
  type: "turn_context",
  payload: { model, turn_id: turn, service_tier },
});
export const meter = (time, total, last = total) => ({
  timestamp: new Date(time).toISOString(),
  type: "event_msg",
  payload: {
    type: "token_count",
    info: { total_token_usage: total, last_token_usage: last },
  },
});
export async function logFile(root, name, records, mtime = Date.now()) {
  const file = path.join(root, "sessions", name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    records
      .map((r) => (typeof r === "string" ? r : JSON.stringify(r)))
      .join("\n") + "\n",
  );
  await utimes(file, new Date(mtime), new Date(mtime));
  return file;
}
export async function desktopUsageFixture(root, now = Date.now()) {
  const start = now - 6 * 86400000;
  const records = [meta("desktop-fixture", start), context(start)];
  let input = 0,
    output = 0;
  for (let i = 0; i < 7; i++) {
    const time = start + i * 86400000;
    const req = tokens(
      i === 6 ? 500000 : 10000 * (i + 1),
      i === 6 ? 100000 : 100 * (i + 1),
    );
    input += req.input_tokens;
    output += req.output_tokens;
    records.push(
      context(time, "gpt-6-astra", `turn-${i}`),
      meter(time, tokens(input, output), req),
    );
  }
  await logFile(root, "fixture.jsonl", records, now);
  return root;
}
