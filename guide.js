import { date, empty, esc, icon } from "./ui.js";

const guides = {
  client: {
    title: "用户使用指导",
    intro: "从一个问题开始，按以下步骤即可完成一次完整的法律服务。",
    steps: [
      ["描述你的问题", "在法律模型咨询中描述案情，可使用“完善提问”模板补充关键事实，支持连续追问。", "#/model-chat", "开始咨询"],
      ["生成需求草稿", "在咨询对话下方点击“转为服务需求”，授权后由模型自动整理标题、预算、事实等字段。", "#/model-chat", "查看咨询"],
      ["发布服务需求", "逐项核对草稿并确认发布，仅认证律师可见；也可以直接手动发布需求。", "#/requests", "我的需求"],
      ["比较律师报价", "在需求详情查看各律师的服务范围、交付物与报价，可先发起实时交流再决定。", "#/lawyers", "浏览律师"],
      ["支付并开始服务", "接受报价后生成订单，在订单页完成模拟支付，律师即开始履约。", "#/orders", "我的订单"],
      ["交流与文书协作", "通过实时交流随时沟通；在文书中心查看版本、添加批注并参与会签。", "#/messages", "打开交流"],
      ["确认收悉或售后", "律师提交交付后在订单页确认收悉；如有问题可退回修改或申请退款/争议处理。", "#/orders", "处理订单"],
    ],
  },
  lawyer: {
    title: "律师使用指导",
    intro: "完成入驻审核后即可在平台承接需求、协作文书并完成交付。",
    steps: [
      ["提交入驻申请", "在“律师入驻”页填写律所、执业证号、专业领域并上传执业证与律所证明。", "#/lawyer-onboarding", "去入驻"],
      ["等待资质审核", "运营人员审核通过后自动开通律师视图与接单能力，审核意见会在申请进度中展示。", "#/lawyer-onboarding", "查看进度"],
      ["浏览需求线索", "切换到律师视图，在“需求线索”查看当事人公开的需求与预算。", "#/requests", "需求线索"],
      ["提交服务报价", "在需求详情填写服务范围、交付物、费用、工期与报价有效期。", "#/requests", "去报价"],
      ["与当事人沟通", "已报价或有订单往来的当事人可在实时交流中沟通细节，消息即时送达。", "#/messages", "打开交流"],
      ["起草与会签文书", "在文书中心为订单新建文书、保存版本，并按顺序发起会签确认。", "#/docs", "文书中心"],
      ["提交交付", "在订单页选择交付文书并提交，当事人确认收悉后订单完成。", "#/orders", "我的订单"],
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
  if (guideHidden()) return `<section class="surface guide-card"><div class="guide-collapsed"><div><b>使用指导已收起</b><p class="muted">随时可以展开查看用户与律师的操作步骤。</p></div><button class="btn sm" data-action="guide-toggle">展开指导</button></div></section>`;
  const active = guideTab || (viewRole === "lawyer" ? "lawyer" : "client");
  const guide = guides[active];
  return `<section class="surface guide-card"><div class="section-title"><div><h2>${icon("info")} ${guide.title}</h2><small>${guide.intro}</small></div><div class="badges"><div class="pill-tabs" role="tablist">${Object.entries(guides).map(([role, item]) => `<button type="button" role="tab" aria-selected="${role === active}" class="${role === active ? "active" : ""}" data-action="guide-tab" data-role="${role}">${item.title.replace("使用指导", "指导")}</button>`).join("")}</div><button class="btn sm ghost" data-action="guide-toggle">收起</button></div></div><ol class="guide-steps">${guide.steps.map(([title, text, href, label]) => `<li class="guide-step"><b>${title}</b><p>${text}</p><a href="${href}">${label} →</a></li>`).join("")}</ol></section>`;
}

function todos({ state, user, viewRole, unreadChats }) {
  const items = [];
  const mine = (order) => (viewRole === "lawyer" ? order.lawyer_id : order.client_id) === user.id;
  for (const order of state.orders.filter(mine)) {
    if (viewRole !== "lawyer" && order.status === "pending_payment") items.push(["order", `订单待支付：<b>${esc(order.title)}</b>`, `#/order/${esc(order.id)}`]);
    if (viewRole !== "lawyer" && order.status === "pending_receipt") items.push(["check", `交付待确认收悉：<b>${esc(order.title)}</b>`, `#/order/${esc(order.id)}`]);
    if (viewRole === "lawyer" && ["service", "pending_delivery"].includes(order.status)) items.push(["doc", `订单服务中，待提交交付：<b>${esc(order.title)}</b>`, `#/order/${esc(order.id)}`]);
  }
  for (const doc of state.documents) {
    if ((doc.workflow || []).some((task) => task.assignee_id === user.id && task.status === "pending" && task.version === doc.locked_version)) items.push(["review", `文书待你会签：<b>${esc(doc.title)}</b>`, `#/doc/${esc(doc.id)}`]);
  }
  if (unreadChats) items.unshift(["message", `你有 <b>${unreadChats}</b> 条未读交流消息`, "#/messages"]);
  return items;
}

export function renderWorkbench(context) {
  const { state, user, viewRole, roleName } = context;
  const lawyer = viewRole === "lawyer";
  const kpis = [
    lawyer ? ["request", "需求线索", state.requests.length, "#/requests"] : ["spark", "咨询记录", state.consultations.length, "#/model-chat"],
    lawyer ? ["message", "未读消息", context.unreadChats, "#/messages"] : ["request", "服务需求", state.requests.length, "#/requests"],
    ["order", "服务订单", state.orders.length, "#/orders"],
    ["doc", "可访问文书", state.documents.length, "#/docs"],
  ];
  const list = todos(context);
  const hour = new Date().getHours();
  const greet = hour < 12 ? "上午好" : hour < 18 ? "下午好" : "晚上好";
  return `<section class="welcome"><div><h1>${greet}，${esc(user.name)}</h1><p>当前为${esc(roleName)}视图 · ${lawyer ? "查看需求线索、与当事人沟通并按时交付。" : "从模型咨询开始，再按需连接律师、创建订单并协作文书。"}</p></div><div class="welcome-actions">${lawyer ? '<a class="btn accent" href="#/requests">浏览需求线索</a><a class="btn" href="#/messages">实时交流</a>' : '<a class="btn accent" href="#/model-chat">开始法律咨询</a><a class="btn" href="#/lawyers">找律师</a>'}</div></section>
  <div class="kpi-grid">${kpis.map(([glyph, title, count, href]) => `<a class="kpi-card" href="${href}"><span>${icon(glyph)}</span><div><small>${title}</small><strong>${count}</strong></div></a>`).join("")}</div>
  ${guideCard(viewRole)}
  <div class="dash-grid"><section class="surface"><div class="section-title"><h2>待办事项</h2><small>${list.length ? `${list.length} 项需要关注` : "暂无待办"}</small></div>${list.length ? `<div class="todo-list">${list.map(([glyph, text, href]) => `<a class="todo-item" href="${href}">${icon(glyph)}<span>${text}</span>${icon("arrow")}</a>`).join("")}</div>` : empty("一切就绪，暂无待办")}</section>
  <section class="surface"><div class="section-title"><h2>${lawyer ? "最近订单" : "最近咨询"}</h2><a class="link" href="${lawyer ? "#/orders" : "#/model-chat"}">查看全部</a></div>${lawyer ? recentOrders(state.orders) : state.consultations.length ? `<div class="recent-list">${state.consultations.slice(0, 6).map((item) => `<a href="#/model-chat/${esc(item.id)}"><b>${esc(item.title)}</b><small>${date(item.updated_at)}</small></a>`).join("")}</div>` : empty("暂无咨询", '<a class="btn primary" href="#/model-chat">发起第一次咨询</a>')}${lawyer ? "" : `<div class="section-title spaced"><h2>最近订单</h2><a class="link" href="#/orders">查看全部</a></div>${recentOrders(state.orders)}`}</section></div>`;
}

function recentOrders(orders) {
  return orders.length ? `<div class="recent-list">${orders.slice(0, 5).map((item) => `<a href="#/order/${esc(item.id)}"><b>${esc(item.title)}</b><small>${date(item.updated_at || item.created_at)}</small></a>`).join("")}</div>` : empty("暂无订单");
}
