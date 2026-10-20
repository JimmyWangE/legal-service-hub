import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { publicFiles } from "./static-manifest.mjs";

test("静态白名单阻止源码泄露，同源代理保留认证与原始请求体", async () => {
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.writeHead(200, { "Content-Type": "application/json", "X-Request-Id": "proxy-test" });
    response.end(JSON.stringify({ body: Buffer.concat(chunks).toString(), authorization: request.headers.authorization, forwarded: request.headers["x-forwarded-for"], url: request.url }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ["server.mjs"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", API_UPSTREAM: `http://127.0.0.1:${upstream.address().port}` }, stdio: "ignore" });
  try {
    const base = `http://127.0.0.1:${port}`;
    let started = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await fetch(base)).ok) { started = true; break; } } catch {}
      await sleep(50);
    }
    assert.equal(started, true);
    for (const endpoint of ["/backend/app/main.py", "/backend/data/legal_service.db", "/README.md", "/business.js", "/package.json"]) assert.equal((await fetch(base + endpoint)).status, 404);
    for (const file of publicFiles) assert.equal((await fetch(`${base}/${file}`)).status, 200, file);
    const raw = '{ "原始": "通知字节", "amount": "19.90" }';
    const response = await fetch(base + "/api/v1/payments/webhooks/test?query=1", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer proxy-token", "X-Forwarded-For": "1.2.3.4" }, body: raw });
    const result = await response.json();
    assert.equal(result.body, raw);
    assert.equal(result.authorization, "Bearer proxy-token");
    assert.notEqual(result.forwarded, "1.2.3.4");
    assert.equal(response.headers.get("X-Request-Id"), "proxy-test");
    assert.equal(result.url, "/api/v1/payments/webhooks/test?query=1");
  } finally {
    child.kill("SIGTERM");
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
