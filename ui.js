export const esc = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const money = (value) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
export const date = (value) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "—";
export const dateOnly = (value) =>
  value ? new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "—";
// 相对时间：一天内显示“x分钟前/x小时前”，否则显示日期
export const ago = (value) => {
  if (!value) return "—";
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}小时前`;
  return dateOnly(value);
};
export const status = (text, tone = "warning") => `<span class="status ${tone}">${esc(text)}</span>`;
export const shortId = (id = "") => String(id).replace(/-/g, "").slice(-8).toUpperCase();
export const stars = (rating, count) =>
  rating === null || rating === undefined
    ? '<span class="rating none">暂无评价</span>'
    : `<span class="rating" aria-label="评分${rating}分"><b>★</b> ${Number(rating).toFixed(1)}${count !== undefined ? `<small>（${count}条）</small>` : ""}</span>`;
const paths = {
  spark:
    '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  magic: '<path d="m4 19 12-12 3 3L7 22ZM14 9l3 3M6 3v6M3 6h6M19 2v5M17 4h5"/>',
  attach:
    '<path d="m14 8-7 7a3 3 0 0 0 4 4l8-8a5 5 0 0 0-7-7l-9 9a6 6 0 0 0 8 8l8-8"/>',
  send: '<path d="m3 10 18-7-7 18-3-7Zm8 4L21 3"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v7M12 6v1"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  thumb: '<path d="M3 10h4v11H3ZM7 10l5-8 2 1-1 7h7v11H7"/>',
  home: '<path d="m3 10 9-7 9 7v11H3ZM9 21v-8h6v8"/>',
  chat: '<path d="M3 4h18v13h-6l-3 4-3-4H3ZM7 9h10M7 13h6"/>',
  request:
    '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7h8M8 12h8M8 17h5"/>',
  lawyer:
    '<circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3M12 16v6"/>',
  order: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2ZM8 8h8M8 12h8"/>',
  doc: '<path d="M5 3h10l4 4v14H5ZM15 3v5h4M8 12h8M8 16h5"/>',
  account:
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="9" r="3"/><path d="M6 19a6 6 0 0 1 12 0"/>',
  review: '<path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6ZM8 12l3 3 6-6"/>',
  audit:
    '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h5M8 16h8"/>',
  settings: '<path d="M3 7h18M3 17h18M8 3v8M16 13v8"/>',
  finance:
    '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M6 15h5"/>',
  bell: '<path d="M5 17h14l-2-4V8a5 5 0 0 0-10 0v5ZM9 21h6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4Z"/><circle cx="12" cy="13" r="4"/>',
  logout: '<path d="M10 4H4v16h6M15 8l4 4-4 4M19 12H9"/>',
  shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z"/>',
  message: '<path d="M4 5h16v11H9l-5 4Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  scale: '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0Zm14 0-3 6a3 3 0 0 0 6 0Z"/>',
  alert: '<path d="M12 3 2 20h20ZM12 10v4M12 17v.5"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9Z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2M7 6V4h10v2"/>',
  map: '<path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M3 12h18"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
};
export const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.doc}</svg>`;
export const link = (url, label, primary = false) =>
  `<a class="${primary ? "btn primary" : "btn"}" href="#/${url}">${label}</a>`;
// variant 可为 true（主按钮）或 "accent" / "danger" / "ghost" / "sm" 等组合类名
export const button = (action, label, attrs = "", variant = false) =>
  `<button type="button" class="btn ${variant === true ? "primary" : variant || ""}" data-action="${action}" ${attrs}>${label}</button>`;
export const empty = (text = "暂无记录", action = "", hint = "", glyph = "doc") =>
  `<div class="empty">${icon(glyph)}<h3>${text}</h3>${hint ? `<p>${hint}</p>` : ""}${action}</div>`;
export const field = (label, name, value = "", opts = {}) =>
  `<label class="field ${opts.wide ? "wide" : ""}"><span>${label}${opts.required ? " <b>*</b>" : ""}</span>${opts.options ? `<select name="${name}" ${opts.required ? "required" : ""}>${opts.placeholder ? `<option value="">${esc(opts.placeholder)}</option>` : ""}${opts.options.map((v) => { const [optionValue, optionLabel] = Array.isArray(v) ? v : [v, v]; return `<option value="${esc(optionValue)}" ${String(value) === String(optionValue) ? "selected" : ""}>${esc(optionLabel)}</option>`; }).join("")}</select>` : opts.textarea ? `<textarea name="${name}" rows="${opts.rows || 4}" ${opts.required ? "required" : ""} placeholder="${esc(opts.placeholder || "")}">${esc(value)}</textarea>` : `<input name="${name}" type="${opts.type || "text"}" ${opts.type === "number" ? `step="${esc(opts.step ?? "any")}"` : ""} value="${esc(value)}" ${opts.required ? "required" : ""} ${opts.min !== undefined ? `min="${opts.min}"` : ""} ${opts.max !== undefined ? `max="${opts.max}"` : ""} ${opts.maxlength ? `maxlength="${opts.maxlength}"` : ""} placeholder="${esc(opts.placeholder || "")}">`}${opts.hint ? `<small>${opts.hint}</small>` : ""}</label>`;
export const formData = (form) => Object.fromEntries(new FormData(form));
export const initials = (name = "") => (String(name).trim()[0] || "用").toUpperCase();
export const avatar = (person = {}, size = "") =>
  `<span class="avatar ${size}" aria-hidden="true">${person?.avatar && /^data:image\/(png|jpeg|webp);base64,/.test(person.avatar) ? `<img src="${esc(person.avatar)}" alt="">` : esc(initials(person?.name))}</span>`;
