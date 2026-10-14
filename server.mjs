import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};
const server = http.createServer(async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405);
    res.end();
    return;
  }
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const segments = pathname.split("/");
    if (segments.some((s) => s.startsWith(".") || s.includes("\\"))) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    let file = path.join(root, pathname === "/" ? "index.html" : pathname);
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    try {
      if ((await stat(file)).isDirectory())
        file = path.join(file, "index.html");
    } catch {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Alpha AI 本地复现已启动：http://127.0.0.1:${port}`),
);
server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `端口 ${port} 已被占用，可运行 PORT=4174 npm start`
      : error.message,
  );
  process.exitCode = 1;
});
