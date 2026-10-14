import {
  actors,
  roles,
  fields,
  serviceTypes,
  seed,
  dispatch,
  visibleRequests,
  canOrder,
  canDoc,
  evidence,
} from "./business.js";
import {
  esc,
  money,
  date,
  status,
  icon,
  field,
  formData,
  button,
  empty,
} from "./ui.js";
import { draftingTemplates } from "./data.js";
import { createModelConsultation } from "./model-consultation.js";

const app = document.querySelector("#app");
const DB_KEY = "legal-platform-demo-db-v2";
const ROLE_KEY = "legal-platform-demo-role-v2";
const db = loadDb();
let actor = actors[localStorage.getItem(ROLE_KEY) || "client"] || actors.client;
let route = parseRoute();
let toastTimer;
const modelConsultation = createModelConsultation({
  getDb: () => db,
  getActor: () => actor,
  refresh: render,
  navigate,
  notify,
  modal,
  closeModal,
  download,
  commit: (name, payload) => {
    const result = dispatch(db, actor, name, payload);
    saveDb();
    return result;
  },
  createRequest: (chatId) => {
    const summary = run(
      "model-summary",
      { id: chatId },
      "已整理当前咨询的提问摘要",
    );
    if (summary) requestModal(summary.id);
  },
});

function loadDb() {
  try {
    const value = JSON.parse(localStorage.getItem(DB_KEY));
    return value?.schema === 1
      ? {
          ...value,
          modelChats: Array.isArray(value.modelChats) ? value.modelChats : [],
        }
      : seed();
  } catch {
    return seed();
  }
}
function saveDb() {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}
function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  return {
    page: parts[0] || "home",
    id: parts[1] || "",
    sub: parts[2] || "",
    q: new URLSearchParams(query),
  };
}
function href(page, id = "", params = {}) {
  const query = new URLSearchParams(params).toString();
  return `#/${page}${id ? `/${id}` : ""}${query ? `?${query}` : ""}`;
}
function navigate(page, id = "", params = {}) {
  location.hash = href(page, id, params);
}
function notify(message) {
  const el = document.querySelector("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
function run(action, payload = {}, success = "已保存") {
  try {
    const result = dispatch(db, actor, action, payload);
    saveDb();
    render();
    notify(success);
    return result;
  } catch (error) {
    notify(error.message || "操作未完成");
    return null;
  }
}
function titleForPage() {
  return (
    {
      home: "工作台",
      chat: "法律问答",
      "model-chat": "法律模型咨询",
      requests: "服务需求",
      lawyers: "找律师",
      orders: "我的订单",
      docs: "文书中心",
      order: "订单详情",
      doc: "文书详情",
      lawyer: "需求线索",
      lawyerOrders: "律师订单",
      workspace: "文书工作区",
      profile: "资质与账户",
      reviewLawyers: "律师审核",
      adminOrders: "订单监管",
      cases: "售后与争议",
      audit: "审计与存证",
      settings: "服务配置",
      finance: "收款与结算",
    }[route.page] || "法律服务平台"
  );
}

function render() {
  route = parseRoute();
  document.title = `${titleForPage()} · 法律服务平台`;
  app.innerHTML = `<div class="platform-shell">${sidebar()}<main class="platform-main"><header class="platform-topbar">${topbar()}</header><section class="page-body ${route.page === "model-chat" ? "model-page-body" : ""}">${page()}</section></main></div><div id="toast" role="status" aria-live="polite"></div>`;
  enhancePage();
  bind();
  if (route.page === "model-chat") modelConsultation.bind(app);
}
function sidebar() {
  const menus =
    actor.role === "client"
      ? [
          ["home", "工作台", "home"],
          ["chat", "法律问答", "chat"],
          ["model-chat", "法律模型咨询", "spark"],
          ["requests", "服务需求", "request"],
          ["lawyers", "找律师", "lawyer"],
          ["orders", "我的订单", "order"],
          ["docs", "文书中心", "doc"],
          ["profile", "账户与安全", "account"],
        ]
      : actor.role === "lawyer"
        ? [
            ["home", "工作台", "home"],
            ["lawyer", "需求线索", "request"],
            ["lawyerOrders", "我的订单", "order"],
            ["workspace", "文书工作区", "doc"],
            ["finance", "收款与结算", "finance"],
            ["profile", "资质与账户", "account"],
          ]
        : [
            ["home", "运营工作台", "home"],
            ["reviewLawyers", "律师审核", "lawyer"],
            ["adminOrders", "订单监管", "order"],
            ["cases", "售后与争议", "review"],
            ["audit", "审计与存证", "audit"],
            ["settings", "服务配置", "settings"],
          ];
  return `<aside class="platform-sidebar"><a class="platform-brand" href="${href("home")}"><span class="brand-mark">α</span><span><b>律服协作</b><small>Legal Service Hub</small></span></a><div class="role-card"><span class="role-dot ${actor.role}"></span><div><small>当前演示视角</small><strong>${roles[actor.role]}</strong></div><select id="role-switch" aria-label="切换演示视角">${Object.entries(
    roles,
  )
    .map(
      ([key, value]) =>
        `<option value="${key}" ${key === actor.role ? "selected" : ""}>${value}</option>`,
    )
    .join(
      "",
    )}</select></div><nav class="platform-nav">${menus.map(([page, label, ico]) => `<a href="${href(page)}" class="${route.page === page ? "active" : ""}">${icon(ico)}<span>${label}</span></a>`).join("")}</nav><div class="sidebar-note"><b>首期服务闭环</b><span>问答 → 需求 → 报价 → 订单 → 履约</span></div><button class="reset-demo" data-action="reset">重置本地演示数据</button></aside>`;
}
function topbar() {
  const unread = db.notifications.filter(
    (n) => n.user === actor.id && !n.read,
  ).length;
  return `<div class="crumb"><span>法律服务平台</span><b>/</b><strong>${titleForPage()}</strong></div><div class="top-actions"><span class="demo-label">本地前端演示</span><button class="notification" data-action="notifications" aria-label="通知">${icon("bell")}${unread ? `<i>${unread}</i>` : ""}</button><a class="account-mini" href="${href("profile")}"><span>${actor.name.slice(0, 1)}</span><b>${actor.name.replace(/^.*·/, "").trim()}</b></a></div>`;
}
function page() {
  const allowed =
    actor.role === "client"
      ? [
          "home",
          "chat",
          "model-chat",
          "requests",
          "lawyers",
          "orders",
          "order",
          "docs",
          "doc",
          "profile",
        ]
      : actor.role === "lawyer"
        ? [
            "home",
            "lawyer",
            "requests",
            "lawyerOrders",
            "order",
            "workspace",
            "doc",
            "profile",
            "finance",
          ]
        : [
            "home",
            "reviewLawyers",
            "adminOrders",
            "order",
            "doc",
            "cases",
            "audit",
            "settings",
            "profile",
          ];
  if (!allowed.includes(route.page))
    return empty(
      "当前视角没有此服务入口",
      '<a class="btn" href="#/home">返回工作台</a>',
    );
  if (route.page === "home") return dashboard();
  if (route.page === "chat") return chatPage();
  if (route.page === "model-chat") return modelConsultation.render(route);
  if (route.page === "requests")
    return route.id ? requestDetailsPage() : requestsPage();
  if (route.page === "lawyers") return lawyersPage();
  if (route.page === "orders") return ordersPage();
  if (route.page === "order") return orderPage();
  if (route.page === "docs") return docsPage();
  if (route.page === "doc") return docPage();
  if (route.page === "lawyer") return leadPage();
  if (route.page === "lawyerOrders") return lawyerOrdersPage();
  if (route.page === "workspace") return workspacePage();
  if (route.page === "profile") return profilePage();
  if (route.page === "reviewLawyers") return reviewLawyersPage();
  if (route.page === "adminOrders") return adminOrdersPage();
  if (route.page === "cases") return casesPage();
  if (route.page === "audit") return auditPage();
  if (route.page === "settings") return settingsPage();
  if (route.page === "finance") return financePage();
  return dashboard();
}
function pageHeader(eyebrow, heading, description = "", actions = "") {
  return `<div class="page-heading"><div><small>${eyebrow}</small><h1>${heading}</h1>${description ? `<p>${description}</p>` : ""}</div><div class="heading-actions">${actions}</div></div>`;
}
function statCards(cards) {
  return `<div class="stat-grid">${cards.map((c) => `<div class="stat-card ${c.tone || ""}"><span>${icon(c.icon || "doc")}</span><div><small>${c.label}</small><strong>${c.value}</strong><em>${c.note || ""}</em></div></div>`).join("")}</div>`;
}
function dashboard() {
  if (actor.role === "client") {
    const orders = db.orders.filter((o) => o.client === actor.id),
      requests = db.requests.filter((r) => r.owner === actor.id),
      docs = db.docs.filter((d) => d.members.includes(actor.id));
    return `${pageHeader("当事人端 · 服务全景", "把法律问题交给一套可追踪的服务流程", "从问题识别到律师连接、文书协作和交付确认，所有关键节点都在一个工作台完成。", button("quick-model", `${icon("spark")} 法律模型咨询`, "", true) + button("quick-request", `${icon("plus")} 发布需求`))}${statCards(
      [
        {
          icon: "chat",
          label: "咨询会话",
          value:
            db.sessions.filter(
              (s) => s.owner === actor.id && s.kind !== "model-summary",
            ).length + db.modelChats.filter((s) => s.owner === actor.id).length,
          note: "可授权转为需求",
        },
        {
          icon: "request",
          label: "我的需求",
          value: requests.length,
          note: `${requests.filter((r) => r.status === "待报价").length} 条待报价`,
        },
        {
          icon: "order",
          label: "服务订单",
          value: orders.length,
          note: `${orders.filter((o) => !["已完成", "已关闭"].includes(o.status)).length} 条进行中`,
        },
        {
          icon: "doc",
          label: "文书与合同",
          value: docs.length,
          note: "按权限访问",
        },
      ],
    )}<div class="dashboard-grid"><section class="surface welcome-card"><div class="welcome-icon">${icon("home")}</div><div><h2>从一个问题开始</h2><p>先选择民事、刑事或不确定，补充事实和诉求；高风险事项会优先提示人工律师入口。</p><div class="inline-actions">${button("quick-chat", "进入法律问答", "", true)}<a class="text-link" href="${href("lawyers")}">浏览认证律师 ${icon("arrow")}</a></div></div></section><section class="surface"><div class="section-title"><h2>待办事项</h2><a href="${href("orders")}">查看全部 ${icon("arrow")}</a></div>${clientTodos()}</section></div><section class="surface"><div class="section-title"><h2>最近服务</h2><a href="${href("orders")}">订单中心 ${icon("arrow")}</a></div>${orderTable(orders.slice(0, 4))}</section>`;
  }
  if (actor.role === "lawyer") {
    const leads = visibleRequests(db, actor),
      orders = db.orders.filter((o) => o.lawyer === actor.id),
      docs = db.docs.filter((d) => d.members.includes(actor.id));
    return `${pageHeader("律师端 · 工作台", "把线索、报价、会签和交付放在同一处", "仅展示已授权的需求；资质状态和可接单状态会影响线索与操作。", button("lawyer-apply", "更新资质资料"))}${statCards(
      [
        {
          icon: "request",
          label: "可报价线索",
          value: leads.filter((r) => r.status === "待报价").length,
          note: "脱敏需求",
        },
        {
          icon: "order",
          label: "服务订单",
          value: orders.length,
          note: `${orders.filter((o) => o.status === "服务中").length} 条服务中`,
        },
        {
          icon: "doc",
          label: "待处理文书",
          value: docs.filter(
            (d) => d.status === "会签中" || d.status === "已退回",
          ).length,
          note: "需要处理",
        },
        {
          icon: "finance",
          label: "待结算",
          value: money(
            orders
              .filter((o) => o.settlement === "待结算")
              .reduce((s, o) => s + o.price, 0),
          ),
          note: "以订单为准",
        },
      ],
    )}<div class="dashboard-grid"><section class="surface"><div class="section-title"><h2>待处理线索</h2><a href="${href("lawyer")}">进入线索池 ${icon("arrow")}</a></div>${leadTable(leads.slice(0, 4))}</section><section class="surface"><div class="section-title"><h2>工作提醒</h2></div>${lawyerTodos(orders, docs)}</section></div><section class="surface"><div class="section-title"><h2>最近订单</h2><a href="${href("lawyerOrders")}">全部订单 ${icon("arrow")}</a></div>${orderTable(orders.slice(0, 4))}</section>`;
  }
  const pending = db.lawyers.filter((l) => l.status === "待审核").length,
    cases = db.cases.filter((c) => c.status === "待处理").length;
  return `${pageHeader("运营端 · 平台治理", "让每一次服务都可审核、可追踪、可售后", "运营视角默认只看必要元数据；进入正文仍需订单参与人授权。", button("export-audit", `${icon("download")} 导出审计`))}${statCards(
    [
      { icon: "lawyer", label: "待审核律师", value: pending, note: "资质材料" },
      {
        icon: "order",
        label: "在途订单",
        value: db.orders.filter((o) => !["已完成", "已关闭"].includes(o.status))
          .length,
        note: "需关注状态",
      },
      {
        icon: "review",
        label: "待处理售后",
        value: cases,
        note: "退款 / 争议",
      },
      {
        icon: "audit",
        label: "今日操作记录",
        value: db.audit.filter(
          (l) =>
            l.created.slice(0, 10) === new Date().toISOString().slice(0, 10),
        ).length,
        note: "可导出",
      },
    ],
  )}<div class="dashboard-grid"><section class="surface"><div class="section-title"><h2>治理提醒</h2></div>${operatorTodos()}</section><section class="surface"><div class="section-title"><h2>关键状态</h2><a href="${href("audit")}">查看审计 ${icon("arrow")}</a></div>${auditTable(db.audit.slice(0, 5))}</section></div><section class="surface"><div class="section-title"><h2>最近订单</h2><a href="${href("adminOrders")}">订单监管 ${icon("arrow")}</a></div>${orderTable(db.orders.slice(0, 5), true)}</section>`;
}
function clientTodos() {
  const list = [];
  db.requests
    .filter((r) => r.owner === actor.id && r.status === "待报价")
    .forEach((r) =>
      list.push(
        `<a href="${href("requests", r.id)}"><b>需求待报价</b><span>${esc(r.title)}</span><em>查看报价 ${icon("arrow")}</em></a>`,
      ),
    );
  db.orders
    .filter((o) => o.client === actor.id && o.status === "待支付")
    .forEach((o) =>
      list.push(
        `<a href="${href("order", o.id)}"><b>服务合同待确认</b><span>${esc(o.title)}</span><em>处理订单 ${icon("arrow")}</em></a>`,
      ),
    );
  db.orders
    .filter((o) => o.client === actor.id && o.status === "待确认")
    .forEach((o) =>
      list.push(
        `<a href="${href("order", o.id)}"><b>交付物待确认</b><span>${esc(o.title)}</span><em>确认收悉 ${icon("arrow")}</em></a>`,
      ),
    );
  return list.length
    ? `<div class="todo-list">${list.slice(0, 5).join("")}</div>`
    : empty("当前没有待办事项");
}
function lawyerTodos(orders, docs) {
  const list = [];
  docs
    .filter(
      (d) =>
        d.status === "会签中" &&
        d.nodes.some((n) => n.user === actor.id && n.status === "待处理"),
    )
    .forEach((d) =>
      list.push(
        `<a href="${href("doc", d.id)}"><b>文书待确认</b><span>${esc(d.title)}</span><em>打开文书 ${icon("arrow")}</em></a>`,
      ),
    );
  orders
    .filter((o) => o.status === "服务中")
    .forEach((o) =>
      list.push(
        `<a href="${href("order", o.id)}"><b>订单待履约</b><span>${esc(o.title)}</span><em>查看交付 ${icon("arrow")}</em></a>`,
      ),
    );
  return list.length
    ? `<div class="todo-list">${list.slice(0, 5).join("")}</div>`
    : empty("当前没有待办事项");
}
function operatorTodos() {
  const cards = [];
  db.lawyers
    .filter((l) => l.status === "待审核")
    .forEach((l) =>
      cards.push(
        `<a href="${href("reviewLawyers", l.id)}"><b>律师资质待审核</b><span>${esc(l.name)} · ${esc(l.firm)}</span><em>审核 ${icon("arrow")}</em></a>`,
      ),
    );
  db.cases
    .filter((c) => c.status === "待处理")
    .forEach((c) =>
      cards.push(
        `<a href="${href("cases", c.id)}"><b>${c.type}待处理</b><span>${esc(c.reason)}</span><em>处理 ${icon("arrow")}</em></a>`,
      ),
    );
  return cards.length
    ? `<div class="todo-list">${cards.slice(0, 6).join("")}</div>`
    : empty("当前没有治理提醒");
}
function orderTable(orders, admin = false) {
  if (!orders.length) return empty("暂时没有订单");
  return `<div class="table-wrap"><table><thead><tr><th>订单</th><th>${admin ? "当事人 / 律师" : "服务方"}</th><th>金额</th><th>状态</th><th>更新时间</th><th></th></tr></thead><tbody>${orders.map((o) => `<tr><td><a class="table-main" href="${href("order", o.id)}"><b>${esc(o.title)}</b><small>${o.id} · ${o.scope}</small></a></td><td>${admin ? `${esc(db.profile.client?.name || "当事人")} / ${esc(db.lawyers.find((l) => l.id === o.lawyer)?.name || o.lawyer)}` : esc(db.lawyers.find((l) => l.id === o.lawyer)?.name || o.lawyer)}</td><td>${money(o.price)}</td><td>${status(o.status)}</td><td>${date(o.created)}</td><td>${icon("arrow")}</td></tr>`).join("")}</tbody></table></div>`;
}
function leadTable(items) {
  if (!items.length) return empty("暂无可报价需求");
  return `<div class="table-wrap"><table><thead><tr><th>需求</th><th>类型</th><th>地区</th><th>预算</th><th>时限</th><th></th></tr></thead><tbody>${items.map((r) => `<tr><td><a class="table-main" href="${href("lawyer", r.id)}"><b>${esc(r.title)}</b><small>${esc(r.facts)}</small></a></td><td>${esc(r.type)}</td><td>${esc(r.region)}</td><td>${money(r.budget)}</td><td>${esc(r.deadline)}</td><td>${icon("arrow")}</td></tr>`).join("")}</tbody></table></div>`;
}
function auditTable(items) {
  return items.length
    ? `<div class="audit-list">${items.map((l) => `<div><span>${icon(l.role === "operator" ? "settings" : "audit")}</span><section><b>${esc(l.action)}</b><small>${esc(l.actor)} · ${date(l.created)}</small><p>${esc(l.detail || l.object)}</p></section></div>`).join("")}</div>`
    : empty("暂无审计记录");
}
function chatPage() {
  const sessions = db.sessions.filter(
    (s) => s.owner === actor.id && s.kind !== "model-summary",
  );
  return `${pageHeader("P0 · 问答分流", "法律问答", "先确定服务场景，再补充事实、时间、地区和诉求。高风险事项会显示人工律师入口。", button("new-session", `${icon("plus")} 新建问答`))}<div class="chat-layout"><section class="surface chat-compose"><div class="choice-row"><span>问题类型</span>${["民事", "刑事", "不确定"].map((v) => `<button class="choice ${route.q.get("domain") === v ? "selected" : ""}" data-domain="${v}">${v}</button>`).join("")}</div><form id="session-form"><input type="hidden" name="domain" value="${esc(route.q.get("domain") || "民事")}">${field("事实经过", "facts", "", { textarea: true, wide: true, required: true, rows: 6, placeholder: "描述事件经过、涉及主体、关键材料和希望解决的问题（至少8字）" })}<div class="form-grid">${field("发生地区", "region", "北京", { required: true, placeholder: "省 / 市" })}${field("事件时间", "time", "", { required: true, type: "date" })}${field("希望解决的问题", "goal", "", { required: true, placeholder: "例如：确认风险、起草文书、联系律师" })}</div><div class="conditional-criminal ${route.q.get("domain") === "刑事" ? "show" : ""}"><div class="form-grid">${field("涉案身份", "identity", "", { required: true, placeholder: "当事人 / 亲属 / 律师等" })}${field("强制措施", "measure", "未采取", { required: true, options: ["未采取", "已采取", "不确定"] })}</div></div><div class="risk-notice">${icon("review")} ${esc(db.settings.risk)}</div><label class="check-line"><input name="confirm" type="checkbox" required> 我知道AI内容仅供一般信息参考，并确认不把演示结果作为法律意见。</label><div class="form-actions"><button class="btn" type="button" data-action="clear-session">清空</button><button class="btn primary" type="submit">整理问答摘要 ${icon("arrow")}</button></div></form></section><aside class="surface conversation-list"><div class="section-title"><h2>最近会话</h2><small>${sessions.length} 条</small></div>${
    sessions.length
      ? sessions
          .slice(0, 6)
          .map(
            (s) =>
              `<button class="session-row" data-session="${s.id}"><span>${esc(s.domain)}</span><b>${esc(s.title)}</b><small>${date(s.created)}</small><em>${s.risk ? "高风险提示" : "一般信息"} ${icon("arrow")}</em></button>`,
          )
          .join("")
      : empty("还没有问答记录")
  }</aside></div>`;
}
function requestsPage() {
  const items = visibleRequests(db, actor);
  return `${pageHeader(actor.role === "client" ? "P0 · 服务需求" : "P0 · 需求流转", "服务需求", "需求是问答摘要转为律师服务的起点，包含公开范围、预算、时限和交付物。", actor.role === "client" ? button("new-request", `${icon("plus")} 发布需求`) : "")}<div class="filter-row"><div class="segmented">${["全部", "待报价", "已下单"].map((v) => `<button class="${route.q.get("status") === v ? "active" : ""}" data-status-filter="${v}">${v}</button>`).join("")}</div><span class="muted">${items.length} 条需求</span></div>${
    items
      .filter(
        (r) =>
          !route.q.get("status") ||
          route.q.get("status") === "全部" ||
          r.status === route.q.get("status"),
      )
      .map((r) => requestCard(r))
      .join("") || empty("暂无匹配需求")
  }`;
}
function requestCard(r) {
  const quoteCount = db.quotes.filter((q) => q.requestId === r.id).length;
  return `<article class="request-card surface"><div class="request-main"><div class="request-meta"><span>${esc(r.domain)} · ${esc(r.field)}</span>${status(r.status)}<small>${date(r.created)}</small></div><h2><a href="${href("requests", r.id)}">${esc(r.title)}</a></h2><p>${esc(r.facts)}</p><div class="tag-row"><span>地区：${esc(r.region)}</span><span>预算：${money(r.budget)}</span><span>截止：${esc(r.deadline)}</span><span>交付：${esc(r.deliverables)}</span></div></div><div class="request-side"><b>${quoteCount}</b><small>份报价</small><a href="${href("requests", r.id)}">查看详情 ${icon("arrow")}</a></div></article>`;
}
function lawyersPage() {
  const q = route.q.get("field") || "";
  const list = db.lawyers.filter(
    (l) => l.status === "已认证" && (!q || l.field === q),
  );
  return `${pageHeader("P0 · 律师连接", "找律师", "按领域、地区、服务方式和可接单状态筛选认证律师。", button("new-request", `${icon("plus")} 先发布需求`))}<div class="filter-row"><div class="filter-inputs"><select id="lawyer-field"><option value="">全部服务领域</option>${fields.map((f) => `<option ${f === q ? "selected" : ""}>${f}</option>`).join("")}</select><select id="lawyer-region"><option value="">全部地区</option>${["北京", "上海", "广州"].map((f) => `<option>${f}</option>`).join("")}</select></div><span class="muted">已认证律师 ${list.length} 位</span></div><div class="lawyer-grid">${list.map((l) => lawyerCard(l)).join("")}</div>`;
}
function lawyerCard(l) {
  return `<article class="lawyer-card surface"><div class="lawyer-avatar">${esc(l.name.slice(0, 1))}</div><div class="lawyer-info"><div class="lawyer-title"><h2>${esc(l.name)}</h2>${status(l.status)}</div><p>${esc(l.firm)} · ${esc(l.region)}</p><div class="tag-row"><span>${esc(l.field)}</span><span>${esc(l.mode)}</span><span>${l.years}年经验</span></div><small>${esc(l.license)} · 有效期至 ${esc(l.expires)}</small></div><div class="lawyer-cta"><b>参考价 ${money(l.price)}</b><span>${l.available ? "可接单" : "暂停接单"}</span><button class="btn primary" data-lawyer="${l.id}">查看与选择</button></div></article>`;
}
function ordersPage() {
  const list = db.orders.filter(
    (o) =>
      actor.role === "operator" ||
      (actor.role === "client" ? o.client === actor.id : o.lawyer === actor.id),
  );
  const heading = actor.role === "lawyer" ? "我的订单" : "订单中心";
  return `${pageHeader("P0 · 服务履约", heading, "订单关联服务范围、合同、付款、交付和售后状态。", actor.role === "client" ? button("new-request", `${icon("plus")} 发布新需求`) : "")}<div class="filter-row"><div class="segmented">${["全部", "待支付", "服务中", "待确认", "已完成", "争议中"].map((v) => `<button data-order-filter="${v}">${v}</button>`).join("")}</div><span class="muted">${list.length} 条</span></div><div id="orders-list">${orderTable(list)}</div>`;
}
function requestDetail(r) {
  const quotes = db.quotes.filter((q) => q.requestId === r.id);
  return `${pageHeader("需求详情", r.title, `服务类型：${r.type} · ${r.region} · 截止 ${r.deadline}`, actor.role === "client" && r.status === "待报价" ? button("edit-request", `${icon("settings")} 编辑需求`) : "")}<div class="detail-grid"><section class="surface detail-main"><div class="detail-status">${status(r.status)}<span>公开范围：${esc(r.visibility)}</span></div><h2>事实与服务目标</h2><p class="long-copy">${esc(r.facts)}</p><dl class="data-list"><div><dt>问题分类</dt><dd>${esc(r.domain)} · ${esc(r.field)}</dd></div><div><dt>预算</dt><dd>${money(r.budget)}</dd></div><div><dt>期望交付</dt><dd>${esc(r.deliverables)}</dd></div><div><dt>来源</dt><dd>${r.sourceSession ? "由问答摘要授权转入" : "直接创建"}</dd></div></dl>${actor.role === "client" && quotes.length ? `<div class="section-title"><h2>律师报价</h2><small>${quotes.length} 份</small></div><div class="quote-list">${quotes.map((q) => quoteCard(q)).join("")}</div>` : ""}${actor.role === "lawyer" && r.status === "待报价" ? quoteForm(r) : ""}</section><aside class="surface side-timeline"><h2>服务路径</h2>${timeline(
    [
      ["问答 / 需求", "已完成"],
      ["律师报价", r.status === "待报价" ? "进行中" : "已完成"],
      ["订单与合同", r.status === "已下单" ? "进行中" : "待开始"],
      ["支付与履约", "待开始"],
      ["交付确认", "待开始"],
    ],
  )}</aside></div>`;
}
function requestDetailsPage() {
  const r = db.requests.find((x) => x.id === route.id);
  return r &&
    ((actor.role === "client" && r.owner === actor.id) ||
      (actor.role === "lawyer" && r.consent) ||
      actor.role === "operator")
    ? requestDetail(r)
    : empty(
        "未找到可访问的需求",
        '<a class="btn" href="#/requests">返回需求列表</a>',
      );
}
function quoteCard(q) {
  const l = db.lawyers.find((x) => x.id === q.lawyer);
  return `<article class="quote-card"><div><div class="quote-title"><b>${esc(l?.name || q.lawyer)}</b>${status(q.status)}</div><p>${esc(q.scope)}</p><small>交付：${esc(q.deliverables)} · ${q.days}天 · 有效至 ${q.validUntil}</small></div><div><strong>${money(q.price)}</strong>${actor.role === "client" && q.status === "有效" ? `<button class="btn primary" data-accept-quote="${q.id}">接受报价</button>` : ""}</div></article>`;
}
function quoteForm(r) {
  return `<form class="inline-form" data-form="quote"><input type="hidden" name="requestId" value="${r.id}"><h3>提交报价</h3><div class="form-grid">${field("服务金额", "price", "", { required: true, type: "number", min: 1, placeholder: "元" })}${field("工期", "days", "", { required: true, type: "number", min: 1, placeholder: "天" })}${field("有效期", "validUntil", new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), { required: true, type: "date" })}</div>${field("服务范围", "scope", "", { textarea: true, required: true, placeholder: "说明包括哪些工作，几轮修改和沟通" })}${field("交付物", "deliverables", "", { textarea: true, required: true, rows: 2, placeholder: "列明可交付成果" })}<button class="btn primary" type="submit">提交报价 ${icon("arrow")}</button></form>`;
}
function ordersDetail(o) {
  const docs = db.docs.filter((d) => d.orderId === o.id);
  const deliveries = o.delivery.length
    ? `<div class="delivery-list">${o.delivery.map((d) => `<div><span>${icon("check")}</span><b>${esc(db.docs.find((x) => x.id === d.docId)?.title || d.docId)}</b><small>版本 v${d.version} · ${date(d.created)}</small></div>`).join("")}</div>`
    : empty("尚未提交交付物");
  const receive =
    o.status === "待确认" && actor.role === "client" && o.delivery.length
      ? `<div class="inline-actions">${button("receive-delivery", "确认收悉", "", true)}${button("return-delivery", "提出修改")}</div>`
      : "";
  const timelineHtml = timeline([
    ["需求创建", "已完成"],
    ["合同确认", o.status === "待确认" ? "进行中" : "已完成"],
    [
      "支付",
      o.paymentStatus === "已支付"
        ? "已完成"
        : o.status === "待支付"
          ? "待处理"
          : "待开始",
    ],
    ["履约交付", o.delivery.length ? "进行中" : "待开始"],
    ["收悉与售后", o.status === "已完成" ? "已完成" : "待开始"],
  ]);
  return (
    pageHeader(
      "订单详情",
      o.title,
      `${o.id} · ${esc(o.scope)}`,
      button("export-evidence", `${icon("download")} 导出过程记录`),
    ) +
    `<div class="order-banner surface"><div><span>当前状态</span><strong>${status(o.status)}</strong><small>${o.paymentStatus} · ${o.settlement}</small></div><div><span>订单金额</span><strong>${money(o.price)}</strong><small>已支付 ${money(o.paid)}</small></div><div><span>服务方</span><strong>${esc(db.lawyers.find((l) => l.id === o.lawyer)?.name || o.lawyer)}</strong><small>${esc(db.lawyers.find((l) => l.id === o.lawyer)?.firm || "")}</small></div></div><div class="detail-grid"><section class="surface detail-main"><div class="section-title"><h2>履约与交付</h2>${orderActions(o)}</div>${deliveries}${receive}<div class="section-title"><h2>订单消息</h2></div>${messageList(o)}<form class="message-form" data-form="message">${field("", "text", "", { textarea: true, rows: 2, placeholder: "给订单参与人留言…", required: true })}<button class="btn" type="submit">发送消息</button></form></section><aside class="surface"><h2>服务合同与文书</h2>${docs.map((d) => docMini(d)).join("") || empty("暂无关联文书")}<div class="section-title"><h2>状态记录</h2></div>${timelineHtml}</aside></div>`
  );
}
function orderActions(o) {
  let out = "";
  if (actor.role === "client" && o.status === "待支付")
    out +=
      button("pay-fail", "模拟支付失败") +
      button("pay-success", "模拟支付成功", "", true);
  if (
    actor.role === "client" &&
    o.paid > 0 &&
    !["已关闭", "退款中", "争议中"].includes(o.status)
  )
    out += button("refund", "申请退款");
  if (
    actor.role !== "operator" &&
    o.paid > 0 &&
    !["已关闭", "退款中", "争议中"].includes(o.status)
  )
    out += button("dispute", "发起争议");
  if (actor.role === "lawyer" && o.status === "服务中")
    out += button("deliver", "提交交付");
  return out;
}
function messageList(o) {
  return o.messages.length
    ? `<div class="messages">${o.messages.map((m) => `<div><b>${esc(m.author)}</b><p>${esc(m.text)}</p><small>${date(m.created)}</small></div>`).join("")}</div>`
    : empty("暂无订单消息");
}
function docMini(d) {
  return `<a class="doc-mini" href="${href("doc", d.id)}"><span>${icon("doc")}</span><div><b>${esc(d.title)}</b><small>${esc(d.type)} · v${d.current} · ${status(d.status)}</small></div>${icon("arrow")}</a>`;
}
function docsPage() {
  const list = db.docs.filter((d) =>
    actor.role === "operator" ? false : canDoc(db, actor, d),
  );
  return `${pageHeader("P0 · 文书协作", "文书中心", "按订单管理服务合同、法律文书、附件和交付物；版本、批注和会签状态在同一处留痕。", actor.role !== "operator" ? button("new-doc", "新建文书") : "")}<div class="filter-row"><div class="segmented"><button>全部</button><button>草稿</button><button>会签中</button><button>已确认</button><button>已退回</button></div><span class="muted">${list.length} 份文书</span></div><div class="doc-grid-platform">${list.map((d) => docCard(d)).join("") || empty("暂无可访问文书")}</div>`;
}
function docCard(d) {
  return `<article class="doc-card-platform surface"><div class="doc-card-icon">${icon("doc")}</div><div class="doc-card-body"><div class="request-meta"><span>${esc(d.type)}</span>${status(d.status)}</div><h2><a href="${href("doc", d.id)}">${esc(d.title)}</a></h2><p>版本 v${d.current} · ${d.members.length} 位参与人 · 截止 ${d.deadline}</p><small>订单 ${d.orderId} · ${date(d.created)}</small></div><a class="round-arrow" href="${href("doc", d.id)}">${icon("arrow")}</a></article>`;
}
function docDetail(d) {
  const current =
    d.versions.find((v) => v.number === d.current) || d.versions.at(-1);
  return `${pageHeader("文书详情", d.title, `${d.type} · ${d.orderId} · 当前版本 v${d.current}`, button("export-doc", `${icon("download")} 导出文书`))}<div class="doc-detail-grid"><section class="surface document-editor"><div class="editor-toolbar"><span>${status(d.status)}</span><span>当前版本 v${d.current}</span><div>${actor.role !== "operator" && canDoc(db, actor, d) && !d.locked ? button("save-version", "保存新版本") : ""}${actor.role !== "operator" && canDoc(db, actor, d) && ["草稿", "已退回"].includes(d.status) ? button("start-sign", "发起顺序会签", "", true) : ""}${d.status === "会签中" && d.nodes.some((n) => (n.user === actor.id && n.status === "待处理" ? true : false)) ? button("confirm-doc", "确认此版本", "", true) : ""}</div></div><div class="document-paper"><div class="paper-label">本地工作区 · 正文预览</div><h2>${esc(d.title)}</h2>${String(
    current?.body || "",
  )
    .split("\n")
    .map((line) => (line ? `<p>${esc(line)}</p>` : "<br>"))
    .join(
      "",
    )}</div>${d.status === "会签中" ? `<div class="sign-progress"><h3>顺序会签</h3>${d.nodes.map((n) => `<div class="sign-node"><span class="${n.status === "已确认" ? "done" : ""}">${n.status === "已确认" ? icon("check") : "·"}</span><b>${esc(db.profile[n.user === "C1" ? "client" : "lawyer"]?.name || n.user)}</b><small>${esc(n.status)}${n.confirmedAt ? ` · ${date(n.confirmedAt)}` : ""}</small></div>`).join("")}${d.owner === actor.id ? button("remind-doc", "催办下一位") : ""}${d.owner === actor.id ? button("withdraw-doc", "撤回流转") : ""}</div>` : ""}</section><aside class="surface"><h2>版本与批注</h2><div class="version-list">${d.versions
    .slice()
    .reverse()
    .map(
      (v) =>
        `<button class="version-row ${v.number === d.current ? "active" : ""}" data-version="${v.number}"><b>v${v.number}</b><span>${esc(v.author)}</span><small>${date(v.created)}</small></button>`,
    )
    .join(
      "",
    )}</div><div class="section-title"><h3>访问参与人</h3></div><div class="member-list">${d.members.map((user) => `<span>${esc(user === "C1" ? "当事人 · 陈先生" : db.lawyers.find((l) => l.id === user)?.name || user)}${user !== actor.id && actor.role !== "operator" ? `<button data-revoke="${user}" aria-label="撤销授权">×</button>` : ""}</span>`).join("")}</div><div class="section-title"><h3>批注</h3></div>${d.comments?.length ? d.comments.map((c) => `<div class="comment"><b>${esc(c.author)}</b><p>${esc(c.text)}</p><small>${date(c.created)} · ${c.resolved ? "已解决" : "待处理"}</small>${!c.resolved && canDoc(db, actor, d) ? button("resolve-comment", '标记解决 data-comment="' + c.id + '"') : ""}</div>`).join("") : empty("暂无批注")}${canDoc(db, actor, d) ? `<form class="comment-form" data-form="comment"><input type="hidden" name="id" value="${d.id}">${field("新增批注", "text", "", { textarea: true, rows: 3, required: true, placeholder: "针对正文或版本补充意见" })}<button class="btn" type="submit">添加批注</button></form>` : ""}</aside></div>`;
}
function leadPage() {
  const r = route.id
    ? visibleRequests(db, actor).find((x) => x.id === route.id)
    : null;
  return r
    ? requestDetail(r)
    : `${pageHeader("P0 · 律师端", "需求线索", "查看已授权需求，提交服务报价。", button("lawyer-apply", "更新资质资料"))}<div class="filter-row"><div class="segmented"><button>全部</button><button>待报价</button><button>已下单</button></div></div>${leadTable(visibleRequests(db, actor))}`;
}
function lawyerOrdersPage() {
  return ordersPage();
}
function financePage() {
  const orders = db.orders.filter((o) => o.lawyer === actor.id);
  return `${pageHeader("P1 · 律师端", "收款与结算", "展示已支付、待结算和争议冻结金额；本地原型不连接真实支付渠道。")}${statCards(
    [
      {
        icon: "finance",
        label: "已收服务金额",
        value: money(orders.reduce((s, o) => s + o.paid, 0)),
        note: "仅演示金额",
      },
      {
        icon: "finance",
        label: "待结算",
        value: money(
          orders
            .filter((o) => o.settlement === "待结算")
            .reduce((s, o) => s + o.price, 0),
        ),
        note: "需订单完成",
      },
      {
        icon: "review",
        label: "冻结金额",
        value: money(
          orders
            .filter((o) => o.settlement === "暂停结算")
            .reduce((s, o) => s + o.paid, 0),
        ),
        note: "售后处理中",
      },
      {
        icon: "audit",
        label: "支付记录",
        value: db.payments.filter((p) => orders.some((o) => o.id === p.orderId))
          .length,
        note: "状态可追踪",
      },
    ],
  )}<section class="surface">${orderTable(orders)}</section>`;
}
function workspacePage() {
  return docsPage();
}
function enhancePage() {
  app.querySelectorAll(".page-heading small").forEach((el) => {
    el.textContent = el.textContent.replace(/^P[012]\s*·\s*/, "");
  });
  app
    .querySelectorAll(".choice")
    .forEach((el) =>
      el.classList.toggle(
        "selected",
        el.dataset.domain === (route.q.get("domain") || "民事"),
      ),
    );
  const sessionForm = app.querySelector("#session-form");
  if (sessionForm) {
    const grid = sessionForm.querySelector(".form-grid");
    if (route.q.get("domain") !== "刑事")
      grid.insertAdjacentHTML(
        "beforeend",
        field("民事场景", "field", "合同纠纷", {
          options: db.settings.fields.filter((v) => v !== "刑事案件"),
        }),
      );
    sessionForm
      .querySelector(".risk-notice")
      .insertAdjacentHTML(
        "beforebegin",
        '<label class="field"><span>相关材料（可选）</span><input type="file" name="files" multiple accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png"><small>文件仅记录名称和大小，提交前请移除不必要的个人敏感信息。</small></label>',
      );
  }
  if (route.page === "doc") {
    const d = currentDoc();
    if (d && canDoc(db, actor, d)) {
      if (
        d.status === "会签中" &&
        d.nodes.some((n) => n.user === actor.id && n.status === "待处理")
      )
        app
          .querySelector(".editor-toolbar>div")
          ?.insertAdjacentHTML("beforeend", button("return-doc", "退回修改"));
      const o = db.orders.find((o) => o.id === d.orderId);
      app
        .querySelector(".heading-actions")
        ?.insertAdjacentHTML(
          "afterbegin",
          `<a class="btn" href="${href("order", d.orderId)}">${icon("back")} 关联订单</a>`,
        );
      app.querySelectorAll(".comment").forEach((node, i) => {
        const b = node.querySelector('[data-action="resolve-comment"]');
        if (b) {
          b.textContent = "标记解决";
          b.dataset.comment = d.comments[i].id;
        }
      });
      const missing = [o?.client, o?.lawyer].filter(
        (u) => u && !d.members.includes(u),
      );
      if (missing.length && (d.owner === actor.id || o?.client === actor.id))
        app
          .querySelector(".member-list")
          ?.insertAdjacentHTML(
            "beforeend",
            missing
              .map((u) =>
                button("grant-doc", "恢复参与人授权", `data-user="${u}"`),
              )
              .join(""),
          );
      if (d.attachments?.length)
        app
          .querySelector(".document-paper")
          ?.insertAdjacentHTML(
            "beforeend",
            `<p class="muted">附件：${d.attachments.map((f) => esc(f.name)).join("、")}</p>`,
          );
      if (d.locked)
        app.querySelector(".paper-label").textContent =
          "最终确认版本 · 已锁定 · 平台内确认不等同电子签名";
    }
  }
  if (route.page === "order" && actor.role !== "operator") {
    const o = currentOrder();
    if (o) {
      if (!o.delivery.length)
        app
          .querySelector('[data-action="receive-delivery"]')
          ?.closest(".inline-actions")
          ?.remove();
      const aside = app.querySelector(".detail-grid>aside");
      if (actor.role === "lawyer")
        aside?.insertAdjacentHTML(
          "afterbegin",
          button("new-doc", `${icon("plus")} 新建关联文书`),
        );
      const related = db.cases.filter((c) => c.orderId === o.id);
      if (related.length)
        app
          .querySelector(".detail-main")
          ?.insertAdjacentHTML(
            "beforeend",
            `<h2>售后记录</h2>${related.map((c) => `<div class="comment"><b>${esc(c.type)} ${status(c.status)}</b><p>${esc(c.reason)}</p>${c.result ? `<p>处理意见：${esc(c.result)}</p>` : ""}</div>`).join("")}`,
          );
      if (o.status === "已完成")
        app
          .querySelector(".detail-main")
          ?.insertAdjacentHTML(
            "beforeend",
            `<form data-form="rating"><h3>服务评价</h3>${field("评分", "stars", String(o.ratings?.[actor.id]?.stars || 5), { options: ["5", "4", "3", "2", "1"] })}${field("评价", "text", o.ratings?.[actor.id]?.text || "", { textarea: true, rows: 2 })}<button class="btn" type="submit">保存评价</button></form>`,
          );
    }
  }
  if (["docs", "workspace"].includes(route.page))
    app
      .querySelectorAll(".segmented button")
      .forEach((el) => (el.dataset.docFilter = el.textContent));
  if (route.page === "lawyer")
    app
      .querySelectorAll(".segmented button")
      .forEach((el) => (el.dataset.leadFilter = el.textContent));
  if (route.page === "cases")
    app.querySelectorAll("[data-case]").forEach((form) => {
      const c = db.cases.find((c) => c.id === form.dataset.case);
      form.querySelector("select").innerHTML =
        c.type === "退款"
          ? '<option value="approve">同意模拟退款</option><option value="reject">拒绝并恢复订单</option>'
          : '<option value="resume">恢复履约</option><option value="close">结束服务并待核对结算</option>';
    });
  if (route.page === "reviewLawyers")
    app.querySelectorAll(".review-row").forEach((row, i) => {
      const list = route.id
        ? db.lawyers.filter((l) => l.id === route.id)
        : db.lawyers;
      const l = list[i];
      if (l.status === "已认证")
        row.lastElementChild.insertAdjacentHTML(
          "beforeend",
          button("freeze-lawyer", "暂停资质", `data-lawyer="${l.id}"`),
        );
      if (l.status === "需补件" || l.status === "已冻结")
        row.lastElementChild.insertAdjacentHTML(
          "beforeend",
          button("approve-lawyer", "重新审核通过", `data-lawyer="${l.id}"`),
        );
    });
  if (route.page === "profile") {
    const form = app.querySelector('form[data-form="profile"]');
    const identity = form?.querySelector('[name="identity"]');
    if (identity)
      identity.closest(".field").innerHTML =
        `<span>身份核验</span><div class="permission-row"><span>${esc(db.profile[actor.role]?.identity || "账户信息")}</span><b>需后端人工核验</b></div>`;
    const name = app.querySelector('button[data-action="save-profile"]');
    if (name) {
      const section = name.closest("section");
      const f = document.createElement("form");
      f.dataset.form = "profile";
      section.querySelectorAll(".field").forEach((node) => f.append(node));
      f.insertAdjacentHTML(
        "beforeend",
        '<button class="btn" type="submit">保存账户资料</button>',
      );
      name.replaceWith(f);
    }
  }
}
function profilePage() {
  const p = db.profile[actor.role] || {};
  if (actor.role === "lawyer") {
    const l = db.lawyers.find((x) => x.id === actor.id);
    return `${pageHeader("律师端 · 资质与账户", "资质与账户", "只有审核通过且在有效期内的律师可接收需求和提交报价。", status(l.status))}<div class="profile-grid"><section class="surface"><h2>当前资质</h2><div class="profile-status">${status(l.status)}<span>${l.available ? "可接单" : "暂停接单"}</span></div><form data-form="lawyer-apply">${field("所在机构", "firm", l.firm, { required: true })}<div class="form-grid">${field("执业证信息", "license", l.license, { required: true })}${field("有效期", "expires", l.expires, { required: true, type: "date" })}</div><div class="form-grid">${field("服务地区", "region", l.region, { required: true })}${field("擅长领域", "field", l.field, { required: true, options: fields })}</div>${field("接单说明", "mode", l.mode, { required: true })}<button class="btn primary" type="submit">提交审核资料</button></form></section><section class="surface"><h2>账户信息</h2>${field("展示名称", "name", p.name || l.name, { required: true })}${field("团队/机构", "firm", l.firm)}<button class="btn" data-action="save-profile">保存账户资料</button><div class="security-note">${icon("review")} 真实执业认证、身份信息和收款信息需要后端审核与权限控制。</div></section></div>`;
  }
  return `${pageHeader("账户与安全", "账户与安全", "管理当事人身份、企业资料、隐私和本地演示数据。", button("clear-local", "清空本地演示数据"))}<div class="profile-grid"><section class="surface"><h2>基本资料</h2><form data-form="profile">${field("展示名称", "name", p.name || actor.name, { required: true })}${field("身份状态", "identity", p.identity || "待实名认证", { options: ["待实名认证", "已实名认证"] })}${field("组织/企业", "enterprise", p.enterprise || "个人用户")}${field("通知邮箱", "email", p.email || "", { type: "email", placeholder: "用于接收服务通知" })}<button class="btn primary" type="submit">保存资料</button></form></section><section class="surface"><h2>访问与隐私</h2><div class="permission-row"><span>${icon("doc")} 文书访问</span><b>按订单与参与人授权</b></div><div class="permission-row"><span>${icon("audit")} 操作留痕</span><b>保留当前本地演示记录</b></div><div class="permission-row"><span>${icon("download")} 数据导出</span><b>可从订单导出过程记录</b></div><div class="security-note">${icon("review")} 当前为本地前端原型，不保存真实身份、支付或文书内容到外部服务。</div></section></div>`;
}
function reviewLawyersPage() {
  const list = route.id
    ? db.lawyers.filter((l) => l.id === route.id)
    : db.lawyers;
  return `${pageHeader("P0 · 运营审核", "律师资质审核", "审核执业信息、服务领域和有效期；普通运营视角不直接浏览业务文书正文。")}${list.map((l) => `<article class="review-row surface"><div><h2>${esc(l.name)} <small>${esc(l.firm)}</small></h2><p>${esc(l.license)} · ${esc(l.region)} · ${esc(l.field)} · 有效期 ${esc(l.expires)}</p></div><div>${status(l.status)} ${l.status === "待审核" ? `${button("approve-lawyer", "通过", 'data-lawyer="' + l.id + '"', true)}${button("request-lawyer", "补件", 'data-lawyer="' + l.id + '"')}` : ""}</div></article>`).join("")}`;
}
function adminOrdersPage() {
  return `${pageHeader("P0 · 订单监管", "订单监管", "查询服务范围、付款状态、交付状态和异常记录。")}${orderTable(db.orders, true)}`;
}
function casesPage() {
  const list = db.cases.filter((c) => !route.id || c.id === route.id);
  return `${pageHeader("P0 · 售后处理", "退款与争议", "平台运营处理退款、争议和结算暂停，记录决定与理由。")}${list.length ? list.map((c) => caseCard(c)).join("") : empty("暂无待处理售后")}`;
}
function caseCard(c) {
  const o = db.orders.find((x) => x.id === c.orderId);
  return `<article class="case-row surface"><div><div class="request-meta"><span>${esc(c.type)} · 订单 ${c.orderId}</span>${status(c.status)}</div><h2>${esc(o?.title || "订单售后")}</h2><p>${esc(c.reason)}</p><small>申请人：${esc(c.owner)} · ${date(c.created)}</small></div>${actor.role === "operator" && c.status === "待处理" ? `<form class="case-form" data-case="${c.id}"><select name="decision"><option value="approve">同意退款</option><option value="reject">拒绝并恢复订单</option><option value="close">关闭争议</option></select>${field("处理意见", "result", "", { textarea: true, rows: 2, required: true })}<button class="btn primary" type="submit">提交处理</button></form>` : ""}</article>`;
}
function auditPage() {
  return `${pageHeader("P0 · 过程留痕", "审计与存证", "按订单导出文书版本、流转、支付、交付和售后记录。运营只查看必要元数据。", button("export-all-audit", `${icon("download")} 导出日志`))}<section class="surface">${auditTable(db.audit)}</section>`;
}
function settingsPage() {
  return `${pageHeader("P1 · 运营配置", "服务与风险配置", "配置问答分流可用领域、服务类目和平台风险提示。")}<section class="surface settings-panel"><form data-form="settings">${field("服务领域", "fields", db.settings.fields.join("、"), { textarea: true, required: true, rows: 3, hint: "用顿号或换行分隔" })}${field("服务类型", "services", db.settings.services.join("、"), { textarea: true, required: true, rows: 2 })}${field("风险提示", "risk", db.settings.risk, { textarea: true, required: true, rows: 3 })}<button class="btn primary" type="submit">保存配置</button></form></section>`;
}
function timeline(items) {
  return `<div class="timeline">${items.map(([label, state]) => `<div><span class="${state === "已完成" ? "done" : ""}">${state === "已完成" ? icon("check") : "·"}</span><section><b>${label}</b><small>${state}</small></section></div>`).join("")}</div>`;
}
function orderPage() {
  const o = db.orders.find((x) => x.id === route.id);
  if (!o || !canOrder(db, actor, o)) return empty("未找到可访问的订单");
  if (actor.role === "operator")
    return `${pageHeader("订单监管", o.title, `${o.id} · ${o.scope}`, button("export-evidence", "导出必要元数据"))}<div class="surface"><dl class="data-list"><div><dt>订单状态</dt><dd>${status(o.status)}</dd></div><div><dt>付款状态</dt><dd>${esc(o.paymentStatus)} · 已付 ${money(o.paid)}</dd></div><div><dt>结算状态</dt><dd>${esc(o.settlement)}</dd></div></dl><h2>关联文书元数据</h2>${db.docs
      .filter((d) => d.orderId === o.id)
      .map(
        (d) =>
          `<p>${esc(d.title)} · v${d.current} · ${esc(d.status)} <span class="muted">正文按参与人授权</span></p>`,
      )
      .join("")}<h2>售后记录</h2>${
      db.cases
        .filter((c) => c.orderId === o.id)
        .map(
          (c) =>
            `<a class="text-link" href="${href("cases", c.id)}">${esc(c.type)} · ${esc(c.status)} ${icon("arrow")}</a>`,
        )
        .join("") || '<p class="muted">暂无售后记录</p>'
    }<h2>操作记录</h2>${auditTable(db.audit.filter((l) => l.object === o.id))}</div>`;
  return ordersDetail(o);
}
function docPage() {
  const d = db.docs.find((x) => x.id === route.id);
  if (!d || !canDoc(db, actor, d))
    return empty(
      "您没有此文书的访问授权",
      "<p>请联系订单参与人确认授权。运营视角不能直接浏览正文。</p>",
    );
  return docDetail(d);
}
function safeRefresh() {
  saveDb();
  render();
}
function modal(title, body) {
  document.querySelector("#modal-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "modal-overlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><h2 id="modal-title">${title}</h2><button class="close-button" data-close-modal aria-label="关闭">×</button></header><div class="modal-body">${body}</div></section>`;
  document.body.append(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  overlay
    .querySelector("[data-close-modal]")
    .addEventListener("click", closeModal);
  bind(overlay);
  overlay.querySelector("input,textarea,select,button")?.focus();
}
function closeModal() {
  document.querySelector("#modal-overlay")?.remove();
}
function currentOrder() {
  return db.orders.find((x) => x.id === route.id);
}
function currentDoc() {
  return db.docs.find((x) => x.id === route.id);
}
function bind(root = app) {
  root.querySelector("#role-switch")?.addEventListener("change", (e) => {
    actor = actors[e.target.value];
    localStorage.setItem(ROLE_KEY, actor.role);
    if (!["order", "doc", "requests", "lawyer"].includes(route.page))
      navigate("home");
    render();
  });
  root
    .querySelectorAll("[data-action]")
    .forEach((el) =>
      el.addEventListener("click", () => action(el.dataset.action, el)),
    );
  root.querySelectorAll("[data-domain]").forEach((el) =>
    el.addEventListener("click", () => {
      if (root.querySelector('[name="facts"]')?.value.trim())
        modal(
          "切换问题类型",
          `<p>切换会清空尚未整理的本次输入。已保存会话不受影响。</p>${button("confirm-domain", "确认切换", `data-domain-value="${el.dataset.domain}"`, true)}`,
        );
      else navigate("chat", "", { domain: el.dataset.domain });
    }),
  );
  root
    .querySelectorAll("[data-session]")
    .forEach((el) =>
      el.addEventListener("click", () => showSession(el.dataset.session)),
    );
  root
    .querySelectorAll("[data-status-filter]")
    .forEach((el) =>
      el.addEventListener("click", () =>
        navigate("requests", "", { status: el.dataset.statusFilter }),
      ),
    );
  root.querySelectorAll("[data-order-filter]").forEach((el) =>
    el.addEventListener("click", () => {
      const list = db.orders.filter(
        (o) =>
          canOrder(db, actor, o) &&
          (el.dataset.orderFilter === "全部" ||
            o.status === el.dataset.orderFilter),
      );
      root.querySelector("#orders-list").innerHTML = orderTable(list);
    }),
  );
  root
    .querySelector("#lawyer-field")
    ?.addEventListener("change", (e) =>
      navigate("lawyers", "", { field: e.target.value }),
    );
  root.querySelector("#lawyer-region")?.addEventListener("change", (e) => {
    const target = e.target.value;
    root.querySelectorAll(".lawyer-card").forEach((card) => {
      card.hidden = !!target && !card.textContent.includes(target);
    });
  });
  root.querySelectorAll("[data-lawyer]").forEach((el) => {
    if (el.matches(".lawyer-cta button"))
      el.addEventListener("click", () => showLawyer(el.dataset.lawyer));
  });
  root.querySelectorAll("[data-accept-quote]").forEach((el) =>
    el.addEventListener("click", () => {
      const q = db.quotes.find((x) => x.id === el.dataset.acceptQuote);
      modal(
        "确认服务报价",
        `<p>服务范围：${esc(q.scope)}</p><p>交付物：${esc(q.deliverables)}</p><p>金额 ${money(q.price)} · 工期 ${q.days}天</p><p class="muted">本地演示会生成订单和服务合同草稿，仍需双方在会签中确认。</p>${button("accept-quote", "接受并生成订单", `data-quote="${q.id}"`, true)}`,
      );
    }),
  );
  root
    .querySelectorAll("[data-version]")
    .forEach((el) =>
      el.addEventListener("click", () =>
        showVersion(Number(el.dataset.version)),
      ),
    );
  root.querySelectorAll("[data-revoke]").forEach((el) =>
    el.addEventListener("click", () => {
      const result = run(
        "access-doc",
        { id: route.id, user: el.dataset.revoke, grant: false },
        "已撤销该参与人的文书访问",
      );
      if (result) render();
    }),
  );
  root
    .querySelectorAll("form:not(#model-consultation-form)")
    .forEach((form) => form.addEventListener("submit", submit));
  root
    .querySelectorAll(
      ".conditional-criminal:not(.show) input,.conditional-criminal:not(.show) select",
    )
    .forEach((el) => (el.disabled = true));
}
function showSession(id) {
  const s = db.sessions.find((x) => x.id === id && x.owner === actor.id);
  if (!s) return;
  modal(
    "问答摘要",
    `<div class="summary-head">${status(s.domain)}<small>${date(s.created)} · 来源：法律问答</small></div>${s.risk ? `<div class="risk-notice urgent">${icon("review")} ${esc(db.settings.risk)}</div>` : ""}<dl class="data-list"><div><dt>事实</dt><dd>${esc(s.facts)}</dd></div><div><dt>地区 / 时间</dt><dd>${esc(s.region)} · ${esc(s.time)}</dd></div><div><dt>诉求</dt><dd>${esc(s.goal)}</dd></div>${s.domain === "刑事" ? `<div><dt>涉案身份 / 措施</dt><dd>${esc(s.identity)} · ${esc(s.measure)}</dd></div>` : ""}</dl><div class="summary-note"><h3>待核实事项</h3><p>请核对事件经过、材料来源、关键日期和参与人信息。此摘要整理用户输入，不提供法律判断。</p></div><div class="inline-actions">${button("summary-request", "授权摘要并发布需求", `data-session-id="${s.id}"`, true)}${button("summary-lawyers", "找人工律师")} ${button("feedback", "有用", `data-session-id="${s.id}" data-value="有用"`)} ${button("feedback", "无用", `data-session-id="${s.id}" data-value="无用"`)}</div>`,
  );
}
function requestModal(source = "", editing = "") {
  const s = db.sessions.find((x) => x.id === source && x.owner === actor.id),
    r = db.requests.find((x) => x.id === editing && x.owner === actor.id);
  modal(
    editing ? "编辑服务需求" : "发布服务需求",
    `<form data-form="request"><input type="hidden" name="sourceSession" value="${s?.id || r?.sourceSession || ""}"><input type="hidden" name="editId" value="${r?.id || ""}">${field("需求标题", "title", r?.title || s?.goal || "", { required: true })}<div class="form-grid">${field("问题类型", "domain", r?.domain || s?.domain || "民事", { options: ["民事", "刑事", "不确定"] })}${field("服务领域", "field", r?.field || "合同纠纷", { options: db.settings.fields })}${field("服务类型", "type", r?.type || "法律咨询", { options: db.settings.services })}</div>${field("事实摘要", "facts", r?.facts || s?.facts || "", { textarea: true, required: true, rows: 4 })}<div class="form-grid">${field("地区", "region", r?.region || s?.region || "北京", { required: true })}${field("预算（元）", "budget", r?.budget || 2000, { type: "number", required: true, min: 1 })}${field("期望截止时间", "deadline", r?.deadline || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), { type: "date", required: true })}</div>${field("期望交付物", "deliverables", r?.deliverables || "", { required: true, placeholder: "咨询意见、合同修改稿、文书初稿等" })}${field("公开范围", "visibility", r?.visibility || "认证律师可见", { options: ["认证律师可见"] })}<label class="check-line"><input type="checkbox" name="consent" required> 我确认以上摘要内容，并授权认证律师在报价流程中查看。请先移除不必要的个人敏感信息。</label>${s ? `<p class="muted">关联来源：${s.id} · ${date(s.created)}</p>` : ""}<button class="btn primary" type="submit">${editing ? "保存需求" : "发布需求"}</button></form>`,
  );
  const form = document.querySelector(
    '#modal-overlay form[data-form="request"]',
  );
  if (
    s?.field &&
    !r &&
    Array.from(form.elements.field.options).some((o) => o.value === s.field)
  )
    form.elements.field.value = s.field;
  if (s?.kind === "model-summary")
    form.querySelector("p.muted").textContent =
      `关联来源：法律模型咨询 · ${s.sourceChat} · 摘要 ${s.id} · ${date(s.created)}`;
}
function showLawyer(id) {
  const l = db.lawyers.find((x) => x.id === id);
  modal(
    "律师资料",
    `<div class="lawyer-title"><h2>${esc(l.name)}</h2>${status(l.status)}</div><p>${esc(l.firm)} · ${esc(l.region)}</p><p>服务领域：${esc(l.field)} · ${esc(l.mode)}</p><p>${esc(l.license)} · 有效期至 ${l.expires}</p><p class="muted">请通过需求与报价明确服务范围、工期与交付物。展示价格是演示参考值。</p>${button("new-request", "发布需求，获取报价", "", true)}`,
  );
}
function documentModal() {
  const orders = db.orders.filter((o) => canOrder(db, actor, o));
  if (!orders.length) return notify("请先通过需求与报价创建订单");
  modal(
    "新建文书",
    `<form data-form="create-doc"><div class="form-grid">${field("文书类型", "type", "法律文书", { options: ["法律文书", "服务合同", "交付物", "附件材料"] })}<label class="field"><span>关联订单 *</span><select name="orderId">${orders.map((o) => `<option value="${o.id}" ${route.page === "order" && route.id === o.id ? "selected" : ""}>${esc(o.title)}</option>`).join("")}</select></label></div>${field("文书名称", "title", "", { required: true })}<label class="field"><span>常用起草模板</span><select id="draft-template"><option value="">空白文书</option>${draftingTemplates.map((t) => `<option>${esc(t.name)}</option>`).join("")}</select></label>${field("正文 / 草稿", "body", "", { textarea: true, required: true, rows: 8, placeholder: "输入或编辑文书正文；模板只生成结构，不替代律师意见" })}${field("截止时间", "deadline", new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), { required: true, type: "date" })}<label class="field"><span>附件材料</span><input type="file" name="files" accept=".pdf,.doc,.docx,.txt,.png,.jpg" multiple><small>选择材料只记录名称和大小；正文可在上方编辑，不会自动解析PDF/Word。</small></label><button class="btn primary" type="submit">创建文书</button></form>`,
  );
  document.querySelector("#draft-template").addEventListener("change", (e) => {
    if (!e.target.value) return;
    const form = e.target.form;
    form.elements.title.value = e.target.value;
    form.elements.body.value = `${e.target.value}（待核对草稿）\n一、当事人信息\n[填写并核实]\n二、事实经过\n[根据已核实材料填写]\n三、请求事项\n[待确认]\n四、依据与附件\n[由律师核对与补充]`;
  });
}
function showVersion(number) {
  const d = currentDoc(),
    v = d?.versions.find((x) => x.number === number),
    current = d?.versions.find((x) => x.number === d.current);
  if (!v) return;
  modal(
    `文书版本 v${number}`,
    `<p>${esc(v.author)} · ${date(v.created)}</p><div class="version-compare"><section><h3>v${number}</h3><pre>${esc(v.body)}</pre></section><section><h3>当前 v${d.current}</h3><pre>${esc(current.body)}</pre></section></div>${!d.locked && d.status !== "会签中" && number !== d.current ? button("restore-version", "以此版本恢复为新版本", `data-number="${number}"`) : ""}`,
  );
}
async function exportEvidence(id) {
  try {
    const result = evidence(db, actor, id);
    for (const doc of result.documents)
      for (const v of doc.versions) {
        if (v.body) {
          const digest = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(v.body),
          );
          v.fingerprint = Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        }
      }
    download(
      `订单过程记录-${id}.json`,
      JSON.stringify(result, null, 2),
      "application/json",
    );
    notify("已导出本地过程记录与版本指纹");
  } catch (e) {
    notify(e.message);
  }
}
function download(name, text, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function action(name, el) {
  if (name === "quick-model") {
    navigate("model-chat");
    render();
  }
  if (name === "quick-chat" || name === "new-session") {
    navigate("chat");
    render();
  }
  if (name === "clear-session") {
    document.querySelector("#session-form").reset();
  }
  if (name === "confirm-domain") {
    closeModal();
    navigate("chat", "", { domain: el.dataset.domainValue });
  }
  if (name === "new-request" || name === "quick-request") {
    closeModal();
    requestModal();
  }
  if (name === "edit-request") requestModal("", route.id);
  if (name === "summary-request") {
    const id = el.dataset.sessionId;
    closeModal();
    requestModal(id);
  }
  if (name === "summary-lawyers") {
    closeModal();
    navigate("lawyers");
  }
  if (name === "feedback") {
    run(
      "feedback",
      { id: el.dataset.sessionId, value: el.dataset.value },
      "已记录反馈",
    );
    closeModal();
  }
  if (name === "accept-quote") {
    const result = run(
      "accept-quote",
      { id: el.dataset.quote },
      "已创建订单与服务合同草稿",
    );
    if (result) {
      closeModal();
      navigate("order", result.id);
    }
  }
  if (name === "new-doc") documentModal();
  if (name === "grant-doc")
    run(
      "access-doc",
      { id: route.id, user: el.dataset.user, grant: true },
      "已恢复文书授权",
    );
  if (name === "save-version") {
    const d = currentDoc();
    modal(
      "保存新版本",
      `<form data-form="save-version"><input name="id" type="hidden" value="${d.id}">${field("正文", "body", d.versions.find((v) => v.number === d.current)?.body || "", { textarea: true, required: true, rows: 14 })}<p class="muted">保存会新增版本，并保留原版本、作者和时间。</p><button class="btn primary" type="submit">保存新版本</button></form>`,
    );
  }
  if (name === "restore-version") {
    run(
      "restore-version",
      { id: route.id, number: Number(el.dataset.number) },
      "已恢复为新版本",
    );
    closeModal();
  }
  if (
    ["start-sign", "confirm-doc", "withdraw-doc", "remind-doc"].includes(name)
  )
    run(name, { id: route.id }, "文书流转状态已更新");
  if (name === "return-doc")
    modal(
      "退回文书",
      `<form data-form="return-doc"><input type="hidden" name="id" value="${route.id}">${field("退回原因", "reason", "", { textarea: true, required: true, rows: 4 })}<button class="btn primary" type="submit">退回修改</button></form>`,
    );
  if (name === "resolve-comment")
    run(
      "resolve-comment",
      { id: route.id, comment: el.dataset.comment },
      "批注已标记解决",
    );
  if (name === "pay-success" || name === "pay-fail")
    run(
      "pay",
      { id: route.id, result: name === "pay-success" ? "success" : "fail" },
      "模拟付款状态已更新（无真实资金交易）",
    );
  if (name === "receive-delivery")
    run("receive", { id: route.id }, "已确认收悉，订单已完成");
  if (name === "return-delivery" || name === "refund" || name === "dispute") {
    const o = currentOrder();
    modal(
      name === "refund"
        ? "申请退款"
        : name === "dispute"
          ? "发起争议"
          : "提出交付修改",
      `<form data-form="${name}"><input name="id" type="hidden" value="${o.id}">${name === "refund" ? field("退款金额（元）", "amount", o.paid, { required: true, type: "number", min: 1, max: o.paid }) : ""}${field("原因与说明", "reason", "", { required: true, textarea: true, rows: 4 })}<p class="muted">操作仅更新本地演示流程，不触发真实退款或外部处理。</p><button class="btn primary" type="submit">提交</button></form>`,
    );
  }
  if (name === "deliver") {
    const o = currentOrder(),
      docs = db.docs.filter(
        (d) =>
          d.orderId === o.id && d.type !== "服务合同" && canDoc(db, actor, d),
      );
    if (!docs.length) return documentModal();
    modal(
      "提交交付物",
      `<form data-form="deliver"><input name="id" type="hidden" value="${o.id}"><label class="field"><span>交付文书</span><select name="docId">${docs.map((d) => `<option value="${d.id}">${esc(d.title)} · v${d.current}</option>`).join("")}</select></label>${field("交付说明", "note", "", { textarea: true, rows: 3 })}<button class="btn primary" type="submit">提交并通知当事人</button></form>`,
    );
  }
  if (name === "export-evidence") exportEvidence(route.id);
  if (name === "export-doc") {
    const d = currentDoc();
    if (canDoc(db, actor, d))
      download(
        `${d.title}-v${d.current}.txt`,
        d.versions.find((v) => v.number === d.current)?.body || "",
      );
  }
  if (name === "export-audit" || name === "export-all-audit")
    download(
      "平台审计日志.json",
      JSON.stringify(db.audit, null, 2),
      "application/json",
    );
  if (name === "lawyer-apply") {
    navigate("profile");
    render();
  }
  if (name === "approve-lawyer" || name === "request-lawyer") {
    modal(
      "处理律师资质",
      `<form data-form="review-lawyer"><input name="id" type="hidden" value="${el.dataset.lawyer}"><input name="decision" type="hidden" value="${name === "approve-lawyer" ? "approve" : "reject"}">${field("审核意见", "reason", "", { required: true, textarea: true })}<button class="btn primary" type="submit">确认${name === "approve-lawyer" ? "通过" : "补件"}</button></form>`,
    );
  }
  if (name === "freeze-lawyer")
    modal(
      "暂停律师资质",
      `<form data-form="review-lawyer"><input name="id" type="hidden" value="${el.dataset.lawyer}"><input name="decision" type="hidden" value="freeze">${field("处理意见", "reason", "", { required: true, textarea: true })}<button class="btn primary" type="submit">确认暂停</button></form>`,
    );
  if (name === "notifications") {
    const ns = db.notifications.filter((n) => n.user === actor.id);
    ns.forEach((n) => (n.read = true));
    saveDb();
    modal(
      "服务通知",
      ns.length
        ? `<div class="notification-list">${ns.map((n) => `<a href="#/${n.target.replace(/^documents\//, "doc/").replace(/^orders\//, "order/")}"><b>${esc(n.title)}</b><small>${date(n.created)}</small></a>`).join("")}</div>`
        : empty("暂无服务通知"),
    );
  }
  if (name === "reset" || name === "clear-local") {
    modal(
      "重置本地演示",
      `<p>将重新载入示例需求、报价、订单和文书。本地新增业务数据将清空，旧版复刻的历史键不受影响。</p>${button("confirm-reset", "确认重置", "", true)}`,
    );
  }
  if (name === "confirm-reset") {
    Object.assign(db, seed());
    safeRefresh();
    closeModal();
    navigate("home");
  }
  if (name === "save-profile") notify("账户资料请通过左侧资料表单提交");
}
function submit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  if (!form.reportValidity()) return;
  const values = formData(form);
  const chosenFiles = Array.from(
    form.querySelector('input[type="file"]')?.files || [],
  );
  if (chosenFiles.some((f) => f.size > 50 * 1024 * 1024)) {
    notify("单个文件大小不能超过50MB");
    return;
  }
  values.attachments = chosenFiles.map((f) => ({ name: f.name, size: f.size }));
  delete values.files;
  const kind =
    form.id === "session-form"
      ? "session"
      : form.dataset.form || (form.dataset.case ? "resolve-case" : "");
  let result;
  if (kind === "session") {
    result = run("session", values, "已整理问答摘要");
    if (result) showSession(result.id);
    return;
  }
  if (kind === "request") {
    values.consent = !!form.elements.consent.checked;
    result = run(
      values.editId ? "edit-request" : "request",
      values,
      "需求已保存",
    );
    if (result) {
      closeModal();
      navigate("requests", result.id);
    }
    return;
  }
  if (kind === "create-doc") {
    values.attachments = Array.from(form.elements.files.files).map((f) => ({
      name: f.name,
      size: f.size,
    }));
    delete values.files;
    result = run("create-doc", values, "文书已创建");
    if (result) {
      closeModal();
      navigate("doc", result.id);
    }
    return;
  }
  if (kind === "resolve-case") {
    values.id = form.dataset.case;
    result = run(kind, values, "售后状态已更新");
    return;
  }
  if (kind === "message") {
    values.id = route.id;
    run(kind, values, "消息已保存");
    return;
  }
  const actionName = kind === "return-delivery" ? "return-delivery" : kind;
  result = run(actionName, values, "服务记录已更新");
  if (result) closeModal();
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});
window.addEventListener("hashchange", () => {
  closeModal();
  render();
});
render();
