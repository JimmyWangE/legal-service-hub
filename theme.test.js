import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const theme = read("./theme.css");
const sheets = ["styles.css", "model-consultation.css", "remote.css", "platform.css"].map((file) => [file, read(`./${file}`)]);
const block = (selector) => theme.slice(theme.indexOf(`${selector} {`), theme.indexOf("}", theme.indexOf(`${selector} {`)));
const tokens = (css) => new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));

test("组件样式只引用色彩变量，不再写死十六进制颜色", () => {
  for (const [file, css] of sheets) assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-fA-F]{3,8}\b/, file);
});

test("样式表引用的变量都有定义", () => {
  const defined = new Set([theme, ...sheets.map(([, css]) => css)].flatMap((css) => [...tokens(css)]));
  for (const [file, css] of [["theme.css", theme], ...sheets]) {
    for (const [, name] of css.matchAll(/var\((--[\w-]+)/g)) assert.ok(defined.has(name), `${file} 使用了未定义的 ${name}`);
  }
});

test("深色主题覆盖了浅色主题的全部色彩变量", () => {
  const light = tokens(block(":root"));
  const dark = tokens(block(':root[data-theme="dark"]'));
  assert.ok(light.size > 40);
  assert.deepEqual([...light].filter((name) => !dark.has(name)), []);
});

test("默认浅色主题，首屏先确定主题再加载样式，顶栏提供切换按钮", () => {
  const html = read("./index.html");
  assert.doesNotMatch(read("./theme.js"), /prefers-color-scheme/);
  assert.match(read("./theme.js"), /: "light"/);
  assert.ok(html.indexOf("theme.js") < html.indexOf("theme.css"));
  assert.ok(html.indexOf("theme.css") < html.indexOf("styles.css"));
  assert.match(read("./app.js"), /data-action="toggle-theme"[\s\S]*action === "toggle-theme"/);
});
