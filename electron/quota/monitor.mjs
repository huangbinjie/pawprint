import { Worker } from "node:worker_threads";
export class QuotaMonitor {
  constructor({ onChange = () => {} } = {}) {
    this.onChange = onChange;
    this.value = { enabled: false, loading: false, data: null, error: null };
    this.generation = 0;
  }
  snapshot() { return this.value; }
  publish(patch) { this.value = { ...this.value, ...patch }; this.onChange(); }
  async configure({ directory, enabled }) {
    const signature = JSON.stringify([directory, !!enabled]);
    if (signature === this.signature) return;
    this.signature = signature;
    const generation = ++this.generation; clearInterval(this.timer);
    await this.worker?.terminate(); await this.pending;
    if (generation !== this.generation) return;
    this.directory = directory;
    this.publish({ enabled: !!enabled, loading: false, data: null, error: null });
    if (!enabled) return;
    await this.refresh();
    if (generation !== this.generation) return;
    this.timer = setInterval(() => void this.refresh(), 15000);
    this.timer.unref?.();
  }
  refresh() {
    if (!this.value.enabled) return Promise.resolve();
    if (this.pending) return this.pending;
    const generation = this.generation;
    this.publish({ loading: true });
    this.pending = new Promise(resolve => {
      const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
        execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 96 },
        workerData: { directory: this.directory, now: Date.now() },
      });
      this.worker = worker;
      let finished = false;
      const finish = message => {
        if (finished) return; finished = true;
        clearTimeout(timeout); void worker.terminate();
        if (generation === this.generation) this.publish(message?.ok
          ? { loading: false, data: message.data, error: message.data?.ambiguous ? "发现同时间的冲突额度快照，等待 Codex 更新。" : null }
          : { loading: false, error: "无法读取最新额度，检查记录目录后重试。" });
        resolve();
      };
      const timeout = setTimeout(() => finish(null), 15000);
      worker.once("message", finish); worker.once("error", () => finish(null)); worker.once("exit", () => finish(null));
    }).catch(() => {
      if (generation === this.generation) this.publish({ loading: false, error: "额度读取器暂时不可用，请稍后重试。" });
    }).finally(() => { this.pending = null; this.worker = null; });
    return this.pending;
  }
  async close() { ++this.generation; clearInterval(this.timer); await this.worker?.terminate(); await this.pending; }
}
