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
    maximumFractionDigits: 0,
  }).format(value || 0);
export const date = (value) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "—";
export const status = (text) =>
  `<span class="status ${["已完成", "已确认", "已认证", "已退款"].includes(text) ? "green" : ["退款中", "争议中", "已退回", "已冻结", "需补件"].includes(text) ? "red" : "orange"}">${esc(text)}</span>`;
const paths = {
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
};
export const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.doc}</svg>`;
export const link = (url, label, primary = false) =>
  `<a class="${primary ? "btn primary" : "btn"}" href="#/${url}">${label}</a>`;
export const button = (action, label, attrs = "", primary = false) =>
  `<button class="btn ${primary ? "primary" : ""}" data-action="${action}" ${attrs}>${label}</button>`;
export const empty = (text = "暂无记录", action = "") =>
  `<div class="empty">${icon("doc")}<h3>${text}</h3><p>相关服务记录将在此统一展示。</p>${action}</div>`;
export const field = (label, name, value = "", opts = {}) =>
  `<label class="field ${opts.wide ? "wide" : ""}"><span>${label}${opts.required ? " <b>*</b>" : ""}</span>${opts.options ? `<select name="${name}" ${opts.required ? "required" : ""}>${opts.options.map((v) => `<option value="${esc(v)}" ${value === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>` : opts.textarea ? `<textarea name="${name}" rows="${opts.rows || 4}" ${opts.required ? "required" : ""} placeholder="${esc(opts.placeholder || "")}">${esc(value)}</textarea>` : `<input name="${name}" type="${opts.type || "text"}" value="${esc(value)}" ${opts.required ? "required" : ""} ${opts.min !== undefined ? `min="${opts.min}"` : ""} ${opts.max !== undefined ? `max="${opts.max}"` : ""} placeholder="${esc(opts.placeholder || "")}">`}${opts.hint ? `<small>${opts.hint}</small>` : ""}</label>`;
export const formData = (form) => Object.fromEntries(new FormData(form));
