import { label, statusTone } from "./labels.js";
import { ago, empty, esc, icon, money, status } from "./ui.js";

const guides = {
  client: {
    title: "当事人快速上手",
    steps: [
      ["描述问题", "选择民事 / 刑事入口，向法律模型说明案情", "#/model-chat"],
      ["发布需求", "授权把咨询整理成需求草稿，核对后发布", "#/requests"],
      ["比较报价", "查看律师方案、工期、评分，择优委托", "#/requests"],
      ["确认合同并支付", "双方确认服务合同后完成支付", "#/orders"],
      ["协作与验收", "文书会签、确认交付，完成后评价律师", "#/orders"],
    ],
  },
  lawyer: {
    title: "律师快速上手",
    steps: [
      ["提交入驻", "填写执业信息并上传证件，等待审核", "#/lawyer-onboarding"],
      ["浏览线索", "查看脱敏后的需求，评估是否承接", "#/requests"],
      ["提交报价", "给出服务范围、交付物、工期与付款方式", "#/requests"],
      ["确认合同", "当事人接受报价后，双方确认服务合同", "#/orders"],
      ["履约交付", "起草文书、组织会签并提交交付物", "#/docs"],
    ],
  },
};

let guideTab = "";
function guideHidden() {
  try { return localStorage.getItem("legal-guide-hidden") === "1"; } catch { return false; }
}
export function setGuideTab(role) { guideTab = role; }
export function toggleGuide() {
  try { localStorage.setItem("legal-guide-hidden", guideHidden() ? "0" : "1"); } catch { /* 浏览器禁用存储时仅本次有效 */ }
}

function guideCard(viewRole) {
  if (guideHidden()) return "";
  const active = guideTab || (viewRole === "lawyer" ? "lawyer" : "client");
  const guide = guides[active];
  return `<section class="surface guide-card"><div class="section-title"><h2>${icon("info")} ${guide.title}</h2><div class="badges"><div class="pill-tabs sm" role="tablist">${Object.entries(guides).map(([role]) => `<button type="button" role="tab" aria-selected="${role === active}" class="${role === active ? "active" : ""}" data-action="guide-tab" data-role="${role}">${role === "lawyer" ? "律师" : "当事人"}</button>`).join("")}</div><button type="button" class="btn sm ghost" data-action="guide-toggle">不再显示</button></div></div><ol class="guide-steps">${guide.steps.map(([title, text, href], index) => `<li><a href="${href}"><span class="step-no">${index + 1}</span><b>${title}</b><small>${text}</small></a></li>`).join("")}</ol></section>`;
}

const mine = (order, user, lawyer) => (lawyer ? order.lawyer_id : order.client_id) === user.id;

export function todoItems({ state, user, viewRole, unreadChats = 0 }) {
  const lawyer = viewRole === "lawyer";
  const items = [];
  for (const order of state.orders.filter((item) => mine(item, user, lawyer))) {
    const title = `<b>${esc(order.title)}</b>`;
    const href = `#/order/${esc(order.id)}`;
    if (order.status === "pending_confirm" && !(lawyer ? order.lawyer_confirmed_at : order.client_confirmed_at)) items.push(["doc", `请确认服务合同：${title}`, href, "确认合同"]);
    if (!lawyer && order.status === "pending_payment") items.push(["wallet", `待支付 ${money(order.price)}：${title}`, href, "去支付"]);
    if (!lawyer && order.status === "pending_receipt") items.push(["check", `律师已提交交付，请验收：${title}`, href, "去验收"]);
    if (lawyer && order.status === "service") items.push(["briefcase", `服务进行中，待提交交付：${title}`, href, "去交付"]);
  }
  for (const doc of state.documents) {
    if ((doc.workflow || []).some((task) => task.assignee_id === user.id && task.status === "pending" && task.version === doc.locked_version)) items.push(["review", `文书等待你会签：<b>${esc(doc.title)}</b>`, `#/doc/${esc(doc.id)}`, "去会签"]);
  }
  if (unreadChats) items.unshift(["message", `你有 <b>${unreadChats}</b> 条未读消息`, "#/messages", "查看"]);
  return items;
}

const kpi = ([glyph, title, value, href, note = ""]) => `<a class="kpi-card" href="${href}"><span class="kpi-icon">${icon(glyph)}</span><div><small>${title}</small><strong>${value}</strong>${note ? `<em>${note}</em>` : ""}</div></a>`;

function todoSection(list) {
  return `<section class="surface"><div class="section-title"><h2>待办事项</h2><small>${list.length ? `${list.length} 项需要处理` : "暂无待办"}</small></div>${list.length ? `<div class="todo-list">${list.map(([glyph, text, href, cta]) => `<a class="todo-item" href="${href}"><span class="todo-icon">${icon(glyph)}</span><span class="todo-text">${text}</span><span class="todo-cta">${cta} ${icon("arrow")}</span></a>`).join("")}</div>` : empty("一切就绪", "", "新的待办会实时出现在这里", "check")}</section>`;
}

function orderRows(orders, user) {
  if (!orders.length) return empty("暂无订单", "", "接受律师报价后会在这里看到订单进度", "order");
  return `<div class="recent-list">${orders.slice(0, 5).map((order) => `<a href="#/order/${esc(order.id)}"><span class="recent-main"><b>${esc(order.title)}</b><small>${order.client_id === user.id ? `承办律师：${esc(order.lawyer_name || "—")}` : `委托人：${esc(order.client_name || "—")}`} · ${ago(order.updated_at || order.created_at)}</small></span><span class="recent-side">${status(label(order.status), statusTone(order.status))}<small>${money(order.price)}</small></span></a>`).join("")}</div>`;
}

function hero(user, roleName, text, actions) {
  const hour = new Date().getHours();
  const greet = hour < 6 ? "夜深了" : hour < 12 ? "上午好" : hour < 18 ? "下午好" : "晚上好";
  return `<section class="welcome"><div><span class="welcome-eyebrow">${icon("scale")} ${esc(roleName)}工作台</span><h1>${greet}，${esc(user.name)}</h1><p>${text}</p></div><div class="welcome-actions">${actions}</div></section>`;
}

function clientBench(context) {
  const { state, user } = context;
  const orders = state.orders.filter((item) => item.client_id === user.id);
  const active = orders.filter((item) => ["pending_confirm", "pending_payment", "service", "pending_receipt"].includes(item.status));
  const list = todoItems(context);
  return `${hero(user, "当事人", "从一次咨询开始，找到合适的律师，并在线完成委托、协作与验收。", '<a class="btn accent" href="#/model-chat">开始法律咨询</a><a class="btn on-dark" href="#/lawyers">浏览律师</a>')}
  <div class="kpi-grid">${[["order", "进行中订单", active.length, "#/orders"], ["review", "待我处理", list.length, "#/home"], ["request", "我的需求", state.requests.filter((item) => item.owner_id === user.id).length, "#/requests"], ["spark", "咨询记录", state.consultations.length, "#/model-chat"]].map(kpi).join("")}</div>
  ${guideCard("client")}
  <div class="dash-grid">${todoSection(list)}<section class="surface"><div class="section-title"><h2>订单进度</h2><a class="link" href="#/orders">全部订单</a></div>${orderRows(orders, user)}</section></div>
  <section class="surface"><div class="section-title"><h2>最近咨询</h2><a class="link" href="#/model-chat">新建咨询</a></div>${state.consultations.length ? `<div class="consult-grid">${state.consultations.slice(0, 6).map((item) => `<a class="consult-card" href="#/model-chat/${esc(item.id)}"><span class="chip">${esc(item.topic)}</span>${item.risk_level === "high" ? '<span class="status danger">高风险</span>' : ""}<b>${esc(item.title)}</b><small>${ago(item.updated_at)}</small></a>`).join("")}</div>` : empty("还没有咨询", '<a class="btn primary" href="#/model-chat">发起第一次咨询</a>', "描述你的问题，法律模型会帮你梳理事实与下一步", "spark")}</section>`;
}

function lawyerBench(context) {
  const { state, user } = context;
  const orders = state.orders.filter((item) => item.lawyer_id === user.id);
  const leads = state.requests.filter((item) => item.owner_id !== user.id && item.status === "quoting");
  const income = orders.filter((item) => item.status === "completed").reduce((sum, item) => sum + Number(item.paid || 0), 0);
  const list = todoItems(context);
  return `${hero(user, "律师", "查看新的需求线索，及时确认合同、推进履约，按期交付。", '<a class="btn accent" href="#/requests">浏览需求线索</a><a class="btn on-dark" href="#/messages">客户沟通</a>')}
  <div class="kpi-grid">${[["request", "可报价线索", leads.length, "#/requests"], ["briefcase", "服务中订单", orders.filter((item) => ["service", "pending_receipt"].includes(item.status)).length, "#/orders"], ["review", "待我处理", list.length, "#/home"], ["wallet", "已完成订单收入", money(income), "#/orders", `${orders.filter((item) => item.status === "completed").length} 单已完成`]].map(kpi).join("")}</div>
  ${guideCard("lawyer")}
  <div class="dash-grid">${todoSection(list)}<section class="surface"><div class="section-title"><h2>最新需求线索</h2><a class="link" href="#/requests">全部线索</a></div>${leads.length ? `<div class="recent-list">${leads.slice(0, 5).map((item) => `<a href="#/requests/${esc(item.id)}"><span class="recent-main"><b>${esc(item.title)}</b><small>${esc(item.region)} · ${esc(item.field)} · ${esc(item.service_type)}</small></span><span class="recent-side"><strong>${money(item.budget)}</strong><small>预算</small></span></a>`).join("")}</div>` : empty("暂无新线索", "", "当事人发布需求后会出现在这里", "request")}</section></div>
  <section class="surface"><div class="section-title"><h2>我的订单</h2><a class="link" href="#/orders">全部订单</a></div>${orderRows(orders, user)}</section>`;
}

const percent = (value) => `${(Number(value || 0) * 100).toFixed(1)}%`;

export function operatorBench({ state, user }) {
  const m = state.metrics;
  if (!m) return `${hero(user, "运营", "平台数据加载中…", "")}`;
  const funnel = [["consultations", "法律咨询"], ["requests", "发布需求"], ["quoted", "获得报价"], ["ordered", "生成订单"], ["paid", "完成支付"], ["completed", "订单完成"]];
  const top = Math.max(1, ...funnel.map(([key]) => m.funnel[key] || 0));
  const statuses = Object.entries(m.orders_by_status || {}).sort((a, b) => b[1] - a[1]);
  return `${hero(user, "运营", "审核律师资质、处理售后争议，关注平台转化与履约质量。", `<a class="btn accent" href="#/reviewLawyers">律师审核${m.pending_applications ? `（${m.pending_applications}）` : ""}</a><a class="btn on-dark" href="#/cases">售后处理${m.pending_cases ? `（${m.pending_cases}）` : ""}</a>`)}
  <div class="kpi-grid">${[["account", "注册用户", m.users, "#/home", `当事人 ${m.clients}`], ["lawyer", "认证律师", m.lawyers, "#/reviewLawyers"], ["wallet", "累计成交额", money(m.gmv), "#/home", `已支付 ${m.funnel.paid} 单`], ["alert", "待处理事项", m.pending_applications + m.pending_cases, "#/cases", `审核 ${m.pending_applications} · 售后 ${m.pending_cases}`]].map(kpi).join("")}</div>
  <div class="dash-grid">
    <section class="surface"><div class="section-title"><h2>${icon("chart")} 服务转化漏斗</h2><small>咨询 → 完成</small></div><div class="funnel">${funnel.map(([key, title]) => `<div class="funnel-row"><span>${title}</span><div class="funnel-bar"><i style="width:${Math.max(2, ((m.funnel[key] || 0) / top) * 100)}%"></i></div><b>${m.funnel[key] || 0}</b></div>`).join("")}</div></section>
    <section class="surface"><div class="section-title"><h2>履约质量</h2></div><div class="metric-grid">${[["支付成功率", percent(m.payment_success_rate)], ["退款率", percent(m.refund_rate)], ["争议率", percent(m.dispute_rate)], ["平均评分", m.avg_rating ? `${m.avg_rating} / 5` : "暂无"], ["刑事咨询", m.consultations_criminal], ["高风险咨询", m.consultations_high_risk]].map(([title, value]) => `<div class="metric"><small>${title}</small><strong>${value}</strong></div>`).join("")}</div></section>
  </div>
  <section class="surface"><div class="section-title"><h2>订单状态分布</h2><a class="link" href="#/orders">查看订单</a></div>${statuses.length ? `<div class="status-dist">${statuses.map(([key, count]) => `<div>${status(label(key), statusTone(key))}<b>${count}</b></div>`).join("")}</div>` : empty("暂无订单数据")}</section>`;
}

export function renderWorkbench(context) {
  if (context.viewRole === "operator") return operatorBench(context);
  return context.viewRole === "lawyer" ? lawyerBench(context) : clientBench(context);
}
