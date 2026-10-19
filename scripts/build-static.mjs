import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPublicFile, publicFiles } from "../static-manifest.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const target = path.resolve(process.argv[2] || path.join(root, "dist"));
if (target === path.parse(target).root || target === root) throw new Error("Unsafe static output directory");
await mkdir(path.join(target, "assets"), { recursive: true });
for (const relative of [...publicFiles, ...(await readdir(path.join(root, "assets"))).map((name) => `assets/${name}`)]) {
  if (isPublicFile(relative)) await cp(path.join(root, relative), path.join(target, relative));
}
await writeFile(path.join(target, "release.json"), JSON.stringify({ built_at: new Date().toISOString(), source: "legal-service-hub" }));
console.log(`公开资源已发布到 ${target}`);
