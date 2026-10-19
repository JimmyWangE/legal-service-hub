import http from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPublicFile } from "./static-manifest.mjs";

const root = await realpath(process.env.STATIC_DIR || fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const upstream = new URL(process.env.API_UPSTREAM || "http://127.0.0.1:8000");
if (upstream.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(upstream.hostname)) throw new Error("API_UPSTREAM must be a loopback HTTP endpoint");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const agent = new http.Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 16 });
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
};

function proxyApi(request, response) {
  if (Number(request.headers["content-length"] || 0) > 55 * 1024 * 1024) { response.writeHead(413); response.end(); return; }
  const headers = { ...request.headers, host: upstream.host, "x-forwarded-for": request.socket.remoteAddress, "x-forwarded-proto": "http" };
  for (const header of ["connection", "proxy-authorization", "proxy-authenticate", "forwarded", "x-real-ip", "keep-alive", "upgrade", "trailer", "te"]) delete headers[header];
  const remote = http.request({ hostname: upstream.hostname, port: upstream.port, path: request.url, method: request.method, headers, agent, timeout: 210000 }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode, { ...upstreamResponse.headers, ...securityHeaders, "Cache-Control": "no-store" });
    upstreamResponse.pipe(response);
  });
  remote.on("timeout", () => remote.destroy());
  remote.on("error", () => {
    if (!response.headersSent) response.writeHead(502, { ...securityHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ error: { code: "gateway_unavailable", message: "后端服务暂不可用，请稍后重试" } }));
  });
  let bytes = 0;
  request.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > 55 * 1024 * 1024) {
      request.unpipe(remote);
      if (!response.headersSent) response.writeHead(413, securityHeaders);
      response.end();
      remote.destroy();
    }
  });
  request.on("aborted", () => remote.destroy());
  request.pipe(remote);
}

export const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname.split("/").some((segment) => segment.startsWith(".") || segment.includes("\\") || segment.includes("\0"))) { response.writeHead(403, securityHeaders); response.end(); return; }
    if (pathname.startsWith("/api/v1/")) return proxyApi(request, response);
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405, securityHeaders); response.end(); return; }
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!isPublicFile(relative)) { response.writeHead(404, securityHeaders); response.end("Not found"); return; }
    const file = await realpath(path.join(root, relative));
    if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) { response.writeHead(403, securityHeaders); response.end(); return; }
    const data = await readFile(file);
    response.writeHead(200, { ...securityHeaders, "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 400, securityHeaders);
    response.end("Not found");
  }
});
server.requestTimeout = 215000;
server.headersTimeout = 10000;
server.maxHeadersCount = 100;
server.listen(port, host, () => console.log(`法律服务平台已启动：http://${host}:${port}`));
server.on("error", (error) => { console.error(`服务启动失败：${error.code || "unknown"}`); process.exitCode = 1; });
