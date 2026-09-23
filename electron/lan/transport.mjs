import https from "node:https";
import tls from "node:tls";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
export const fingerprint = (raw) =>
  createHash("sha256").update(raw).digest("hex");
export function localAddress(ip) {
  if (isIP(ip) !== 4) return false;
  const a = ip.split(".").map(Number);
  return (
    a[0] === 10 ||
    a[0] === 127 ||
    (a[0] === 192 && a[1] === 168) ||
    (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
    (a[0] === 169 && a[1] === 254)
  );
}
export function endpoint(value) {
  if (
    !value ||
    !localAddress(value.host) ||
    !Number.isInteger(value.port) ||
    value.port < 1024 ||
    value.port > 65535 ||
    !/^[a-f0-9]{64}$/.test(value.fp)
  )
    throw new Error("连接码中的局域网地址无效。");
  return { host: value.host, port: value.port, fp: value.fp };
}
export function rpc(target, route, body = {}, token) {
  const dest = endpoint(target);
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ keepAlive: false });
    agent.createConnection = (options, callback) => {
      let settled = false;
      const done = (error, socket) => {
        if (settled) return;
        settled = true;
        callback(error, socket);
      };
      const socket = tls.connect(
        { ...options, rejectUnauthorized: false },
        () => {
          try {
            const raw = socket.getPeerCertificate().raw;
            if (!raw || fingerprint(raw) !== dest.fp)
              throw new Error("同事设备身份不匹配，请重新交换连接码。");
            done(null, socket);
          } catch (error) {
            socket.destroy();
            done(error);
          }
        },
      );
      socket.once("error", (error) => done(error));
    };
    const data = Buffer.from(JSON.stringify(body));
    if (data.length > 64000) {
      reject(new Error("请求过大。"));
      return;
    }
    const req = https.request(
      {
        host: dest.host,
        port: dest.port,
        path: route,
        method: "POST",
        agent,
        headers: {
          "content-type": "application/json",
          "content-length": data.length,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 64000) req.destroy(new Error("响应过大。"));
          else chunks.push(chunk);
        });
        res.on("error", (error) => {
          agent.destroy();
          reject(new Error("连接中断，请重连后继续。"));
        });
        res.on("end", () => {
          agent.destroy();
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString());
            if (!value.ok)
              throw new Error(value.error || "对方暂时无法处理请求。");
            resolve(value.data);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.setTimeout(5000, () =>
      req.destroy(new Error("同事暂时离线或网络无法互通。")),
    );
    req.once("error", (error) => {
      agent.destroy();
      reject(error.code ? new Error("同事暂时离线或网络无法互通。") : error);
    });
    req.end(data);
  });
}
