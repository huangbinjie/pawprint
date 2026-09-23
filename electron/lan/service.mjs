import https from "node:https";
import os from "node:os";
import path from "node:path";
import { readFile, writeFile, mkdir, rename, copyFile } from "node:fs/promises";
import {
  randomBytes,
  randomUUID,
  X509Certificate,
  timingSafeEqual,
} from "node:crypto";
import selfsigned from "selfsigned";
import { Bonjour } from "bonjour-service";
import { endpoint, rpc, localAddress, fingerprint } from "./transport.mjs";
import { CATALOG_VERSION, GENE_COUNT } from "../../core/genetics.mjs";
import {
  cleanPet,
  publicPet,
  txKey,
  LAN_PROTOCOL,
} from "../../core/multiplayer.mjs";
import { housePets, pendingOutgoing } from "../../core/economy.mjs";
const secret = () => randomBytes(32).toString("base64url");
const equals = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const safeName = (v) =>
  String(v ?? "同事的小屋")
    .replace(/[\u0000-\u001f]/g, "")
    .slice(0, 30) || "同事的小屋";
const safeId = (v) => typeof v === "string" && /^[a-f0-9-]{20,80}$/i.test(v);
export class LanService {
  constructor({
    directory,
    getGame,
    command,
    onChange = () => {},
    testHost = null,
    discovery = true,
    now = () => Date.now(),
  }) {
    Object.assign(this, {
      directory,
      getGame,
      command,
      onChange,
      testHost,
      discovery,
      now,
    });
    this.file = path.join(directory, "lan-private-v1.json");
    this.enabled = false;
    this.pendingPairs = new Map();
    this.remotePair = null;
    this.nearby = new Map();
    this.profiles = new Map();
    this.visits = new Map();
    this.outVisits = new Map();
    this.rates = new Map();
    this.polling = false;
    this.authQueue = Promise.resolve();
    this.error = null;
  }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      this.auth = JSON.parse(await readFile(this.file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error("局域网身份文件损坏，请保留文件并联系开发者。");
      const p = await selfsigned.generate(
        [{ name: "commonName", value: "Pawprint Local Companion" }],
        {
          keyType: "ec",
          curve: "P-256",
          algorithm: "sha256",
          notAfterDate: new Date(this.now() + 5 * 365 * 86400000),
        },
      );
      this.auth = {
        cert: p.cert,
        key: p.private,
        id: fingerprint(new X509Certificate(p.cert).raw),
        name: "我的小屋",
        enabled: false,
        peers: {},
      };
      await this.saveAuth();
    }
    if (this.auth.enabled) await this.enable();
    return this;
  }
  saveAuth() {
    const data = JSON.stringify(this.auth);
    const task = this.authQueue.then(async () => {
      await writeFile(`${this.file}.tmp`, data, { mode: 0o600, flush: true });
      try {
        await copyFile(this.file, `${this.file}.bak`);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      await rename(`${this.file}.tmp`, this.file);
    });
    this.authQueue = task.catch(() => {});
    return task;
  }
  changed() {
    this.onChange();
  }
  addresses() {
    return this.testHost
      ? [this.testHost]
      : [
          ...new Set(
            Object.values(os.networkInterfaces())
              .flat()
              .filter(
                (a) =>
                  a &&
                  a.family === "IPv4" &&
                  !a.internal &&
                  localAddress(a.address),
              )
              .map((a) => a.address),
          ),
        ];
  }
  target() {
    const hosts = this.addresses();
    return hosts.length && this.server
      ? { host: hosts[0], port: this.server.address().port, fp: this.auth.id }
      : null;
  }
  inviteCode(address) {
    const dest = this.target();
    if (address) {
      if (!this.addresses().includes(address))
        throw new Error("请选择本机当前可用的局域网地址。");
      if (dest) dest.host = address;
    }
    return dest
      ? `pawprint1:${Buffer.from(JSON.stringify({ ...dest, join: this.joinSecret, name: this.auth.name })).toString("base64url")}`
      : "";
  }
  async enable() {
    if (this.enabled) return this.snapshot();
    this.joinSecret = secret();
    this.error = null;
    this.server = https.createServer(
      { key: this.auth.key, cert: this.auth.cert },
      (req, res) => this.handle(req, res),
    );
    this.server.headersTimeout = 5000;
    this.server.requestTimeout = 7000;
    this.server.maxConnections = 32;
    this.server.on("tlsClientError", () => {});
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, this.testHost || "0.0.0.0", resolve);
    });
    this.enabled = true;
    this.auth.enabled = true;
    await this.saveAuth();
    if (this.discovery) {
      try {
        this.bonjour = new Bonjour({}, () => {
          this.error = "自动发现暂不可用，仍可交换连接码。";
          this.changed();
        });
        this.advert = this.bonjour.publish({
          name: `爪印-${this.auth.name}-${this.auth.id.slice(0, 6)}`,
          host: `pawprint-${this.auth.id.slice(0, 12)}.local`,
          type: "pawprint",
          port: this.server.address().port,
          txt: { id: this.auth.id, protocol: "1", catalog: CATALOG_VERSION },
          disableIPv6: true,
        });
        this.browser = this.bonjour.find({ type: "pawprint" }, (service) => {
          const id = service.txt?.id,
            host = service.addresses?.find(localAddress);
          if (!/^[a-f0-9]{64}$/.test(id) || id === this.auth.id || !host)
            return;
          for (const [key, value] of this.nearby)
            if (this.now() - value.seenAt > 120000) this.nearby.delete(key);
          if (!this.nearby.has(id) && this.nearby.size >= 64) return;
          this.nearby.set(id, {
            id,
            name: safeName(
              service.name.replace(/^爪印-/, "").replace(/-[a-f0-9]{6}$/, ""),
            ),
            host,
            port: service.port,
            seenAt: this.now(),
          });
          const peer = this.auth.peers[id];
          if (peer) {
            peer.endpoint = { host, port: service.port, fp: id };
            void this.saveAuth();
          }
          this.changed();
        });
      } catch {
        this.error = "自动发现暂不可用，仍可交换连接码。";
      }
    }
    this.timer = setInterval(
      () =>
        void this.poll().catch((error) => {
          this.error = error.message || "刷新暂时失败";
          this.changed();
        }),
      3000,
    );
    this.timer.unref();
    this.changed();
    void this.poll().catch(() => {});
    return this.snapshot();
  }
  async disable({ persist = true } = {}) {
    clearInterval(this.timer);
    this.timer = null;
    this.enabled = false;
    this.bonjour?.destroy();
    this.bonjour = null;
    this.browser = null;
    this.nearby.clear();
    for (const v of this.visits.values()) v.status = "ended";
    this.remotePair = null;
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise((r) => this.server.close(r));
      this.server = null;
    }
    await this.pollPromise?.catch(() => {});
    if (persist) {
      this.auth.enabled = false;
      await this.saveAuth();
    }
    this.changed();
    return this.snapshot();
  }
  async close() {
    await this.disable({ persist: false });
    await this.authQueue;
  }
  profile() {
    const s = this.getGame();
    return {
      id: this.auth.id,
      name: this.auth.name,
      protocol: LAN_PROTOCOL,
      catalog: CATALOG_VERSION,
      geneCount: GENE_COUNT,
      pets: housePets(s).map((p) => publicPet(p, s, this.now())),
    };
  }
  snapshot() {
    const s = this.getGame(),
      now = this.now();
    return {
      enabled: this.enabled,
      name: this.auth?.name ?? "我的小屋",
      inviteCode: this.enabled ? this.inviteCode() : "",
      addresses: this.enabled ? this.addresses() : [],
      error: this.error,
      nearby: [...this.nearby.values()].filter((x) => now - x.seenAt < 120000),
      pairRequests: [...this.pendingPairs.values()]
        .filter((x) => x.status === "pending" && x.expiresAt > now)
        .map((x) => ({ id: x.id, name: x.name })),
      pairing: this.remotePair
        ? { name: this.remotePair.name, status: this.remotePair.status }
        : null,
      peers: Object.entries(this.auth?.peers ?? {}).map(([id, p]) => ({
        id,
        name: p.name,
        profile: this.profiles.get(id)?.data ?? null,
        online: now - (this.profiles.get(id)?.at ?? 0) < 15000,
        error: this.profiles.get(id)?.error ?? null,
      })),
      visitors: [...this.visits.values()]
        .filter((v) => v.status === "accepted" && v.expiresAt > now)
        .map((v) => ({
          id: v.id,
          peerId: v.peerId,
          peerName: v.peerName,
          pet: v.pet,
          expiresAt: v.expiresAt,
        })),
      visitRequests: [...this.visits.values()]
        .filter((v) => v.status === "pending" && v.expiresAt > now)
        .map((v) => ({ id: v.id, peerName: v.peerName, pet: v.pet })),
      outVisits: [...this.outVisits.values()].map((v) => ({
        id: v.id,
        peerName: v.peerName,
        status: v.status,
      })),
      breeding: Object.values(s.lanTransactions ?? {}).map((t) => ({
        id: t.id,
        peerId: t.peerId,
        peerName: t.peerName,
        direction: t.direction,
        status: t.status,
        petId: t.petId,
        aPet: t.aPet,
        bPet: t.bPet,
        expiresAt: t.expiresAt,
        fee: t.fee,
        error:
          t.direction === "out" ? this.profiles.get(t.peerId)?.error : null,
      })),
    };
  }
  async setName(name) {
    this.auth.name = safeName(name);
    await this.saveAuth();
    this.changed();
  }
  async pair(code) {
    if (!this.enabled) throw new Error("请先开启局域网小屋。");
    if (
      typeof code !== "string" ||
      code.length > 1800 ||
      !code.startsWith("pawprint1:")
    )
      throw new Error("请粘贴同事分享的完整连接码。");
    let data;
    try {
      data = JSON.parse(Buffer.from(code.slice(10), "base64url").toString());
    } catch {
      throw new Error("连接码格式不正确。");
    }
    const dest = endpoint(data);
    if (dest.fp === this.auth.id) throw new Error("这是自己的连接码。");
    if (typeof data.join !== "string" || data.join.length !== 43)
      throw new Error("连接码已损坏。");
    if (this.auth.peers[dest.fp]) {
      try {
        const profile = await rpc(
          dest,
          "/profile",
          {},
          this.auth.peers[dest.fp].token,
        );
        this.validateProfile(profile, dest.fp);
        this.auth.peers[dest.fp].endpoint = dest;
        await this.saveAuth();
        await this.poll();
        return;
      } catch {
        /* Re-pair after the other device resets its connection permissions. */
      }
    }
    const self = this.target();
    if (!self) throw new Error("没有可互通的局域网地址。");
    const returnToken = secret();
    const result = await rpc(dest, "/pair/request", {
      join: data.join,
      endpoint: self,
      name: this.auth.name,
      returnToken,
      protocol: LAN_PROTOCOL,
      catalog: CATALOG_VERSION,
      geneCount: GENE_COUNT,
    });
    this.remotePair = {
      ...dest,
      id: result.id,
      key: result.key,
      returnToken,
      name: safeName(data.name),
      status: "pending",
      createdAt: this.now(),
    };
    this.changed();
  }
  async answerPair(id, accept) {
    const p = this.pendingPairs.get(id);
    if (!p || p.status !== "pending" || this.now() > p.expiresAt)
      throw new Error("配对邀请已过期。");
    if (accept) {
      p.status = "accepting";
      try {
        const proof = await rpc(p.endpoint, "/pair/proof", {
          id: p.id,
          key: p.key,
        });
        if (!equals(proof.proof, p.key) || !this.enabled)
          throw new Error("无法核实同事的设备身份。");
        this.auth.peers[p.endpoint.fp] = {
          name: p.name,
          endpoint: p.endpoint,
          token: p.returnToken,
          inboundToken: p.accessToken,
        };
        await this.saveAuth();
        p.status = "accepted";
      } catch (error) {
        p.status = "pending";
        throw error;
      }
    } else p.status = "rejected";
    this.changed();
  }
  async send(peerId, route, body) {
    const p = this.auth.peers[peerId];
    if (!this.enabled || !p) throw new Error("请先连接这位同事。");
    return rpc(p.endpoint, route, body, p.token);
  }
  async requestVisit(peerId, petId) {
    const pet = housePets(this.getGame()).find((p) => p.id === petId);
    if (!pet) throw new Error("请选择小屋中的宠物。");
    const id = randomUUID();
    await this.send(peerId, "/visit/request", { id, pet: cleanPet(pet) });
    this.outVisits.set(id, {
      id,
      peerId,
      peerName: this.auth.peers[peerId].name,
      status: "pending",
      createdAt: this.now(),
    });
    this.changed();
  }
  answerVisit(id, accept) {
    const v = this.visits.get(id);
    if (!v || v.status !== "pending" || v.expiresAt <= this.now())
      throw new Error("串门邀请已过期。");
    if (accept && this.snapshot().visitors.length >= 2)
      throw new Error("最多同时接待两位访客。");
    v.status = accept ? "accepted" : "ended";
    v.expiresAt = this.now() + 10 * 60000;
    this.changed();
  }
  dismissVisitor(id) {
    const v = this.visits.get(id);
    if (v) v.status = "ended";
    this.changed();
  }
  async returnVisit(id) {
    const v = this.outVisits.get(id);
    if (!v) return;
    await this.send(v.peerId, "/visit/end", { id });
    v.status = "ended";
    this.changed();
  }
  async requestBreed(peerId, petId, mateId) {
    const peer = this.auth.peers[peerId];
    const profile = await this.send(peerId, "/profile", {});
    this.validateProfile(profile, peerId);
    const mate = profile.pets.find((p) => p.id === mateId);
    if (!mate || !mate.canBreed)
      throw new Error(mate?.breedReason ?? "对方暂时不能繁育。");
    const id = randomUUID();
    await this.command({
      type: "_lan-reserve",
      id,
      peerId,
      peerName: peer.name,
      petId,
      mate,
    });
    try {
      const t = this.getGame().lanTransactions[id];
      await this.send(peerId, "/breed/request", {
        id,
        petId: mateId,
        aPet: t.aPet,
      });
    } catch (error) {
      await this.command({ type: "_lan-cancel-request", id, peerId });
      void this.reconcile(this.getGame().lanTransactions[id]);
      throw new Error("请求未确认，已安排取消；若断线，重连后会释放预留。");
    }
    this.changed();
    return id;
  }
  async answerBreed(peerId, id, accept) {
    await this.command({
      type: accept ? "_lan-accept" : "_lan-cancel",
      id,
      peerId,
    });
    this.changed();
  }
  async cancelBreed(id) {
    const t = this.getGame().lanTransactions?.[id];
    if (!t || t.direction !== "out") throw new Error("请求不存在。");
    await this.command({ type: "_lan-cancel-request", id, peerId: t.peerId });
    await this.reconcile(this.getGame().lanTransactions[id]);
    this.changed();
  }
  async reconcile(t) {
    try {
      const cancel =
        t.status === "cancel-requested" || this.now() > t.expiresAt;
      const reply = await this.send(
        t.peerId,
        cancel ? "/breed/cancel" : "/breed/status",
        { id: t.id },
      );
      if (reply.status === "committed")
        await this.command({
          type: "_lan-finalize",
          id: t.id,
          peerId: t.peerId,
          receipt: reply.receipt,
        });
      else if (reply.status === "cancelled")
        await this.command({
          type: "_lan-confirm-cancel",
          id: t.id,
          peerId: t.peerId,
        });
      else if (reply.status === "missing") {
        await this.send(t.peerId, "/breed/request", {
          id: t.id,
          petId: t.bPet.id,
          aPet: t.aPet,
        });
      }
    } catch (error) {
      const old = this.profiles.get(t.peerId);
      this.profiles.set(t.peerId, {
        ...old,
        error: error.message || String(error),
      });
    }
  }
  validateProfile(p, id) {
    if (
      !p ||
      p.id !== id ||
      p.protocol !== LAN_PROTOCOL ||
      p.catalog !== CATALOG_VERSION ||
      p.geneCount !== GENE_COUNT ||
      !Array.isArray(p.pets) ||
      p.pets.length > 12
    )
      throw new Error("双方版本不兼容，请更新爪印。");
    p.name = safeName(p.name);
    p.pets = p.pets.map((p) => ({
      ...cleanPet(p),
      canBreed: p.canBreed === true,
      breedReason: String(p.breedReason ?? "").slice(0, 100),
    }));
  }
  poll() {
    if (!this.enabled) return Promise.resolve();
    if (this.pollPromise) return this.pollPromise;
    this.pollPromise = this.pollOnce().finally(() => {
      this.pollPromise = null;
    });
    return this.pollPromise;
  }
  async pollOnce() {
    this.polling = true;
    try {
      if (this.remotePair?.status === "pending") {
        const p = this.remotePair;
        try {
          const r = await rpc(p, "/pair/status", { id: p.id, key: p.key });
          if (r.status === "accepted") {
            this.auth.peers[p.fp] = {
              name: safeName(r.name),
              endpoint: endpoint(p),
              token: r.token,
              inboundToken: p.returnToken,
            };
            await this.saveAuth();
            p.status = "accepted";
          } else if (r.status === "rejected" || r.status === "expired")
            p.status = r.status;
        } catch {
          if (this.now() - p.createdAt > 5 * 60000) p.status = "expired";
        }
      }
      await Promise.all(
        Object.entries(this.auth.peers).map(async ([id, p]) => {
          try {
            const data = await this.send(id, "/profile", {});
            this.validateProfile(data, id);
            this.profiles.set(id, { data, at: this.now(), error: null });
          } catch (error) {
            this.profiles.set(id, {
              ...this.profiles.get(id),
              at: 0,
              error: error.message || String(error),
            });
          }
        }),
      );
      for (const t of pendingOutgoing(this.getGame()))
        // Existing receipts/cancellations remain recoverable during a staggered upgrade.
        if (this.auth.peers[t.peerId]) await this.reconcile(t);
      for (const v of this.outVisits.values())
        if (["pending", "accepted"].includes(v.status)) {
          try {
            const r = await this.send(v.peerId, "/visit/status", { id: v.id });
            v.status = r.status;
          } catch {
            if (this.now() - v.createdAt > 10 * 60000) v.status = "ended";
          }
        }
      for (const [id, v] of this.visits) {
        if (v.expiresAt <= this.now() || this.profiles.get(v.peerId)?.at === 0)
          v.status = "ended";
        if (v.expiresAt + 60000 < this.now()) this.visits.delete(id);
      }
      for (const [id, p] of this.pendingPairs)
        if (p.expiresAt + 5 * 60000 < this.now()) this.pendingPairs.delete(id);
      for (const [id, v] of this.outVisits)
        if (v.status === "ended" && this.now() - v.createdAt > 15 * 60000)
          this.outVisits.delete(id);
    } finally {
      this.polling = false;
      this.changed();
    }
  }
  async handle(req, res) {
    const respond = (status, obj) => {
      if (!res.headersSent) {
        res.writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify(obj));
      }
    };
    try {
      if (req.method !== "POST" || req.headers.origin)
        throw new Error("不支持的请求。");
      const ip = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
      if (!localAddress(ip)) throw new Error("仅支持局域网连接。");
      const minute = Math.floor(this.now() / 60000),
        rateKey = `${ip}:${minute}`,
        count = (this.rates.get(rateKey) || 0) + 1;
      this.rates.set(rateKey, count);
      for (const k of this.rates.keys())
        if (!k.endsWith(`:${minute}`)) this.rates.delete(k);
      if (count > 180) throw new Error("请求过于频繁。");
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 64000) throw new Error("请求过大。");
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      let data;
      if (req.url === "/pair/request") {
        if (
          !equals(body.join, this.joinSecret) ||
          body.protocol !== LAN_PROTOCOL ||
          body.catalog !== CATALOG_VERSION ||
          body.geneCount !== GENE_COUNT
        )
          throw new Error("连接码已失效，或双方版本不兼容。");
        const dest = endpoint(body.endpoint);
        if (
          dest.fp === this.auth.id ||
          typeof body.returnToken !== "string" ||
          body.returnToken.length !== 43
        )
          throw new Error("配对来源不一致。");
        if (
          [...this.pendingPairs.values()].filter(
            (p) => p.expiresAt > this.now() && p.status === "pending",
          ).length >= 8 ||
          (Object.keys(this.auth.peers).length >= 12 &&
            !this.auth.peers[dest.fp])
        )
          throw new Error("当前配对数量已达上限。");
        dest.host = ip;
        const id = randomUUID(),
          key = secret();
        this.pendingPairs.set(id, {
          id,
          key,
          endpoint: dest,
          name: safeName(body.name),
          returnToken: body.returnToken,
          accessToken: secret(),
          status: "pending",
          expiresAt: this.now() + 5 * 60000,
        });
        data = { id, key };
        this.changed();
      } else if (req.url === "/pair/proof") {
        const p = this.remotePair;
        if (!p || p.id !== body.id || !equals(p.key, body.key))
          throw new Error("设备核验请求无效。");
        data = { proof: p.key };
      } else if (req.url === "/pair/status") {
        const p = this.pendingPairs.get(body.id);
        if (!p || !equals(body.key, p.key)) throw new Error("配对请求不存在。");
        data = {
          status:
            p.status === "pending" && p.expiresAt < this.now()
              ? "expired"
              : p.status,
          ...(p.status === "accepted"
            ? { token: p.accessToken, name: this.auth.name }
            : {}),
        };
      } else {
        const token = req.headers.authorization?.replace(/^Bearer /, "");
        const pair = Object.entries(this.auth.peers).find(([, p]) =>
          equals(token, p.inboundToken),
        );
        if (!pair) throw new Error("请先通过连接码完成配对。");
        const [peerId, peer] = pair;
        if (req.url === "/profile") data = this.profile();
        else if (req.url === "/visit/request") {
          if (!safeId(body.id) || this.visits.size > 500)
            throw new Error("访问请求无效或过多。");
          const key = body.id;
          const old = this.visits.get(key);
          if (old && old.peerId !== peerId) throw new Error("访问标识冲突。");
          if (!old) {
            const pet = cleanPet(body.pet);
            if (
              [...this.visits.values()].some(
                (v) =>
                  v.peerId === peerId &&
                  v.pet.id === pet.id &&
                  ["pending", "accepted"].includes(v.status) &&
                  v.expiresAt > this.now(),
              )
            )
              throw new Error("这位伙伴已经在做客或等待邀请了。");
            this.visits.set(key, {
              id: key,
              peerId,
              peerName: peer.name,
              pet,
              status: "pending",
              expiresAt: this.now() + 5 * 60000,
            });
          }
          data = { status: this.visits.get(key).status };
          this.changed();
        } else if (req.url === "/visit/status" || req.url === "/visit/end") {
          const v = this.visits.get(body.id);
          if (v && v.peerId !== peerId) throw new Error("访问标识不匹配。");
          if (v && (req.url === "/visit/end" || v.expiresAt < this.now()))
            v.status = "ended";
          data = { status: v?.status ?? "ended" };
          this.changed();
        } else if (req.url === "/breed/request") {
          await this.command({
            type: "_lan-receive",
            id: body.id,
            peerId,
            peerName: peer.name,
            petId: body.petId,
            aPet: body.aPet,
          });
          data = {
            status:
              this.getGame().lanTransactions[txKey(peerId, body.id)].status,
          };
        } else if (req.url === "/breed/status" || req.url === "/breed/cancel") {
          if (!safeId(body.id)) throw new Error("请求编号无效。");
          if (req.url === "/breed/cancel")
            await this.command({ type: "_lan-cancel", id: body.id, peerId });
          const t = this.getGame().lanTransactions?.[txKey(peerId, body.id)];
          data = t
            ? {
                status: t.status,
                receipt: t.status === "committed" ? t.receipt : undefined,
              }
            : { status: "missing" };
        } else throw new Error("未知操作。");
      }
      respond(200, { ok: true, data });
    } catch (error) {
      respond(400, { ok: false, error: error.message || "请求无法处理。" });
    }
  }
}
