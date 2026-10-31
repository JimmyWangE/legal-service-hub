import { caseTypes, docTypes, label, statusTone } from "./labels.js";
import { ago, avatar, button, date, dateOnly, empty, esc, icon, money, shortId, status } from "./ui.js";

export const orderFilters = [
  ["all", "全部", null],
  ["todo", "待确认/支付", ["pending_confirm", "pending_payment"]],
  ["service", "服务中", ["service"]],
  ["pending_receipt", "待验收", ["pending_receipt"]],
  ["completed", "已完成", ["completed"]],
  ["after_sales", "售后", ["refund_pending", "disputed"]],
  ["ended", "已关闭", ["closed", "cancelled"]],
];
const view = { filter: "all", query: "" };
const progress = [["pending_confirm", "确认合同"], ["pending_payment", "支付"], ["service", "律师服务"], ["pending_receipt", "验收交付"], ["completed", "完成"]];
const stage = { pending_confirm: 0, pending_payment: 1, service: 2, pending_receipt: 3, completed: 4 };
const afterSales = ["refund_pending", "disputed"];
const ended = ["closed", "cancelled"];
const badge = (value) => status(label(value), statusTone(value));
const settlementLabels = { frozen: "资金暂存中", pending: "待结算（售后期内）", settled: "已结算", refunded: "已全额退款", partially_refunded: "部分退款" };
const daysLeft = (value) => Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);

export function setOrderFilter(value) { view.filter = value; }
export function setOrderQuery(value) { view.query = value; }

function counterpart(order, user) {
  return order.client_id === user.id ? { label: "承办律师", name: order.lawyer_name, id: order.lawyer_id } : { label: "委托人", name: order.client_name, id: order.client_id };
}

export function renderOrderCards({ orders, user }) {
  const statuses = orderFilters.find(([key]) => key === view.filter)?.[2];
  const query = view.query.trim().toLowerCase();
  const items = orders.filter((order) => (!statuses || statuses.includes(order.status)) && (!query || order.title.toLowerCase().includes(query) || shortId(order.id).toLowerCase().includes(query)));
  if (!items.length) return `<div class="no-result">${empty(orders.length ? "没有符合条件的订单" : "暂无订单", orders.length ? "" : '<a class="btn primary" href="#/requests">去发布需求</a>', orders.length ? "调整筛选条件后再试" : "接受律师报价后会生成订单", "order")}</div>`;
  return items.map((order) => {
    const other = counterpart(order, user);
    const step = stage[order.status];
    return `<a class="item-card order-card" href="#/order/${esc(order.id)}"><header><h3>${esc(order.title)}</h3>${badge(order.status)}</header><div class="meta"><span>${icon("lawyer")}${other.label}：${esc(other.name || "—")}</span><span>#${shortId(order.id)}</span>${order.overdue ? '<span class="status danger">交付逾期</span>' : ""}</div>${step !== undefined ? `<div class="mini-progress" aria-label="进度 ${step + 1}/5">${progress.map((_, index) => `<i class="${index <= step ? "on" : ""}"></i>`).join("")}</div>` : ""}<footer><div class="amount">${money(order.price)}<small>${Number(order.paid) > 0 ? `已付 ${money(order.paid)}` : "未支付"}</small></div><span class="meta">${ago(order.updated_at || order.created_at)}更新</span></footer></a>`;
  }).join("");
}

export function renderOrderList(context) {
  const { orders } = context;
  const counts = Object.fromEntries(orderFilters.map(([key, , statuses]) => [key, statuses ? orders.filter((order) => statuses.includes(order.status)).length : orders.length]));
  return `<div class="list-toolbar"><div class="pill-tabs" role="tablist">${orderFilters.map(([key, title]) => `<button type="button" role="tab" aria-selected="${view.filter === key}" class="${view.filter === key ? "active" : ""}" data-action="order-filter" data-value="${key}">${title}<em>${counts[key]}</em></button>`).join("")}</div><label class="search-input">${icon("search")}<span class="sr-only">搜索订单</span><input data-search="orders" value="${esc(view.query)}" placeholder="搜索订单标题或订单号"></label></div><div class="card-grid" id="order-cards">${renderOrderCards(context)}</div>`;
}

function paymentBlock({ payment, capabilities }) {
  if (payment?.provider === "stub" && ["created", "pending"].includes(payment.status) && capabilities.payment_simulation_enabled) {
    return { ready: true, html: `<div class="simulation-payment"><div class="sim-head"><span class="tag gold">模拟支付</span><span class="muted">不产生真实资金</span></div><p class="simulation-payment-amount">${money(payment.amount)}</p>${payment.client_params?.qr_svg_base64 ? `<img class="payment-qr" alt="模拟支付二维码，金额${esc(money(payment.amount))}" src="data:image/svg+xml;base64,${esc(payment.client_params.qr_svg_base64)}">` : ""}<p class="muted">请核对金额后点击“我已完成支付”。</p>${button("simulate-payment", `${icon("check")} 我已完成支付`, `data-id="${esc(payment.id)}" data-amount="${esc(payment.amount)}"`, true)}</div>` };
  }
  if (!payment) return { ready: false, html: "" };
  const alipay = payment.client_params?.pay_url && /^https:\/\/openapi(?:-sandbox\.dl)?\.alipay(?:dev)?\.com\/gateway\.do\?/.test(payment.client_params.pay_url);
  return { ready: false, html: `${alipay ? `<a class="btn primary" href="${esc(payment.client_params.pay_url)}" target="_blank" rel="noopener noreferrer">前往支付宝收银台</a>` : ""}${payment.client_params?.qr_svg_base64 ? `<img class="payment-qr" alt="支付二维码" src="data:image/svg+xml;base64,${esc(payment.client_params.qr_svg_base64)}">` : ""}` };
}

function nextAction({ item, user, capabilities, reviews = [] }) {
  const client = item.client_id === user.id;
  const lawyer = item.lawyer_id === user.id;
  const party = client || lawyer;
  const cancel = party ? button("cancel-order", "取消订单", "", "ghost") : "";
  if (item.status === "pending_confirm") {
    const mine = client ? item.client_confirmed_at : item.lawyer_confirmed_at;
    if (!party) return ["", "等待双方确认服务合同", "", ""];
    if (mine) return ["", "已确认，等待对方确认服务合同", `对方确认后订单进入待支付${client ? "，届时请完成支付" : ""}。`, cancel];
    return ["", "请确认服务合同", "核对服务范围、交付物、工期与费用。双方都确认后合同生效、订单进入支付环节；平台内“确认”不等同于电子签名。", `${button("confirm-contract", `${icon("check")} 确认服务合同`, "", true)}${button("view-contract", "查看合同全文")}${cancel}`];
  }
  if (item.status === "pending_payment") {
    if (!client) return ["", "等待当事人支付", "当事人完成支付后订单进入服务中，届时即可开始履约。", cancel];
    const payment = (item.payments || []).find((entry) => ["creating", "created", "pending"].includes(entry.status));
    const block = paymentBlock({ payment, capabilities });
    const create = !payment && capabilities.payments_enabled ? button("pay", `${icon("wallet")} 立即支付 ${money(item.price)}`, "", true) : "";
    const note = capabilities.payments_enabled ? (capabilities.payment_simulation_enabled ? "当前为模拟支付环境：生成支付单后点击“我已完成支付”即可，不会产生真实扣款。" : "支付结果以支付机构通知为准，完成支付后页面会自动刷新。") : "平台暂未开放在线支付，请联系平台运营。";
    return ["", `待支付 ${money(item.price)}`, note, `${create}${cancel}`, block.html];
  }
  if (item.status === "service") {
    const due = item.due_date ? `约定 ${dateOnly(item.due_date)} 前交付${item.overdue ? "，<b>已逾期</b>" : `（剩余 ${Math.max(0, daysLeft(`${item.due_date}T23:59:59+08:00`))} 天）`}` : `约定 ${item.days || "—"} 天内交付`;
    return lawyer ? [item.overdue ? "alert" : "", item.overdue ? "交付已逾期，请尽快提交或与当事人沟通" : "服务进行中，请按期提交交付物", `${due}。在“订单文书”中起草或上传交付文书，完成后提交给当事人验收。`, `${button("delivery-modal", `${icon("check")} 提交交付物`, "", true)}${button("new-document", "新建文书", `data-order="${esc(item.id)}"`)}`, "", true] : [item.overdue ? "alert" : "", item.overdue ? "律师交付已逾期" : "律师正在为你服务", `${due}。律师完成后会提交交付物并通知你验收，期间可随时在线沟通${item.overdue ? "；如需退款可申请售后" : ""}。`, button("open-chat", `${icon("message")} 联系律师`, `data-peer="${esc(item.lawyer_id)}" data-order="${esc(item.id)}"`, true), "", true];
  }
  if (item.status === "pending_receipt") {
    const auto = item.auto_accept_at ? `${dateOnly(item.auto_accept_at)} 前未处理将自动确认验收` : "";
    return client ? ["", "请验收交付物", `查看下方交付记录中的文书。满意请确认验收；需要修改请退回并说明原因。${auto ? `<b>${auto}</b>。` : ""}`, `${button("accept-delivery", `${icon("check")} 确认验收`, "", true)}${button("return-delivery", "退回修改")}`, "", true] : ["", "等待当事人验收", `当事人确认后订单完成；如被退回，会通知你具体修改意见。${auto ? `${auto}。` : ""}`, "", "", true];
  }
  if (item.status === "completed") {
    const reviewed = reviews.some((entry) => entry.author_id === user.id);
    const settle = item.settlement_status === "settled" ? (lawyer ? `已于 ${dateOnly(item.settled_at)} 结算，服务收入 ${money(Number(item.paid) - Number(item.platform_fee))}（平台服务费 ${money(item.platform_fee)}）。` : "") : item.after_sales_until ? `售后期至 ${dateOnly(item.after_sales_until)}${lawyer ? `，期满且无争议后结算，预计收入 ${money(Number(item.paid) * (1 - Number(capabilities.platform_fee_rate || 0)))}` : "，期间如有问题可申请售后"}。` : "";
    return ["done", "订单已完成", `${party && !reviewed ? `邀请你为本次合作打分，帮助${client ? "其他当事人选择律师" : "平台改进服务"}。` : "感谢使用平台服务，交付文书可在文书中心随时查看。"}${settle}`, `${party && !reviewed ? button("review-modal", `${icon("star")} 评价${client ? "律师" : "当事人"}`, "", true) : ""}${button("export-evidence", `${icon("download")} 导出存证包`)}`];
  }
  if (afterSales.includes(item.status)) return ["alert", item.status === "disputed" ? "争议处理中" : "退款处理中", "平台运营正在处理，期间结算暂停。处理结果会通过服务通知告知双方。", ""];
  if (item.status === "cancelled") return ["muted", "订单已取消", `取消原因：${item.closed_reason || "—"}。需求已重新开放报价。`, ""];
  if (item.status === "closed") return ["muted", "订单已关闭", `${item.closed_reason || "订单已结束"}。如有疑问请联系平台运营。`, button("export-evidence", `${icon("download")} 导出存证包`)];
  return ["", label(item.status), "", ""];
}

function stepper(item) {
  const current = stage[item.status];
  if (current === undefined) return "";
  return `<ol class="stepper" aria-label="订单进度">${progress.map(([, title], index) => {
    const done = index < current || item.status === "completed";
    return `<li class="step ${done ? "done" : index === current ? "current" : ""}"><span>${done ? icon("check") : index + 1}</span><b>${title}</b></li>`;
  }).join("")}</ol>`;
}

const confirmState = (at) => (at ? `<span class="status success">已确认 · ${dateOnly(at)}</span>` : '<span class="status muted">未确认</span>');

export function renderOrderDetail(context) {
  const { item, user, documents = [] } = context;
  if (!item) return empty("未找到订单");
  const client = item.client_id === user.id;
  const party = client || item.lawyer_id === user.id;
  const reviews = item.reviews || [];
  const [tone, title, text, actions, extra = "", rich = false] = nextAction({ ...context, reviews });
  const payments = item.payments || [];
  const parties = [["委托人", item.client_id, item.client_name, item.client_confirmed_at], ["承办律师", item.lawyer_id, item.lawyer_name, item.lawyer_confirmed_at]];
  const paid = Number(item.paid) > 0;
  const canAfterSales = party && paid && ["service", "pending_receipt", "completed"].includes(item.status) && item.settlement_status !== "settled";
  return `<a class="back-link" href="#/orders">${icon("back")} 返回订单列表</a>
  <section class="surface detail-hero-card"><div class="detail-hero"><div><div class="badges">${badge(item.status)}${paid ? badge(item.payment_status) : ""}</div><h1>${esc(item.title)}</h1><div class="meta"><button type="button" class="copy-id" data-action="copy-id" data-value="${esc(item.id)}" title="复制完整订单号">订单号 #${shortId(item.id)} ${icon("copy")}</button><span>创建于 ${date(item.created_at)}</span></div></div><div class="price"><small>订单金额</small><strong>${money(item.price)}</strong><small>${paid ? `已付 ${money(item.paid)}` : "尚未支付"}</small></div></div>${stepper(item)}</section>
  <section class="next-action ${tone}"><div class="next-body"><h3>${esc(title)}</h3>${text ? `<p>${rich ? text : esc(text)}</p>` : ""}${extra}</div>${actions ? `<div class="actions">${actions}</div>` : ""}</section>
  <div class="detail-grid-2"><div>
    <section class="surface"><div class="section-title"><h2>服务方案</h2>${button("refresh", `${icon("history")} 刷新`, 'aria-label="刷新订单"', "ghost sm")}</div><dl class="data-list"><div class="wide"><dt>服务范围</dt><dd>${esc(item.scope)}</dd></div><div class="wide"><dt>交付物</dt><dd>${esc(item.deliverables || "—")}</dd></div><div><dt>交付周期</dt><dd>${item.days ? `${item.days} 天` : "—"}${item.due_date ? `<small class="muted block">约定 ${dateOnly(item.due_date)} 前交付</small>` : ""}</dd></div><div><dt>付款方式</dt><dd>${esc(item.payment_terms || "确认合同后一次性支付")}</dd></div><div><dt>资金状态</dt><dd>${esc(Number(item.paid) > 0 ? settlementLabels[item.settlement_status] || label(item.settlement_status) : "未支付")}</dd></div><div><dt>最近更新</dt><dd>${date(item.updated_at)}</dd></div></dl></section>
    <section class="surface"><div class="section-title"><h2>订单文书</h2>${party && ["service", "pending_receipt", "completed"].includes(item.status) ? button("new-document", `${icon("plus")} 新建文书`, `data-order="${esc(item.id)}"`, "sm") : '<small>支付后可创建履约文书</small>'}</div>${documents.length ? `<div class="mini-list">${documents.map((doc) => `<a class="mini-row" href="#/doc/${esc(doc.id)}"><span class="doc-icon">${icon("doc")}</span><span class="grow"><b>${esc(doc.title)}</b><small>${esc(docTypes[doc.doc_type] || "文书")} · v${doc.current_version}</small></span>${badge(doc.status)}</a>`).join("")}</div>` : empty("暂无订单文书", "", "", "doc")}</section>
    <section class="surface"><h2>交付记录</h2>${(item.deliveries || []).length ? `<ul class="timeline-list">${item.deliveries.map((delivery) => `<li><div>${badge(delivery.status === "submitted" ? "pending_receipt" : delivery.status === "accepted" ? "accepted" : "returned")} <a class="link" href="#/doc/${esc(delivery.document_id)}">查看交付文书</a></div>${delivery.note ? `<p>${esc(delivery.note)}</p>` : ""}<small>${date(delivery.created_at)}</small></li>`).join("")}</ul>` : empty("暂无交付记录", "", "", "check")}</section>
    ${(item.cases || []).length ? `<section class="surface"><h2>售后记录</h2><ul class="timeline-list">${item.cases.map((entry) => `<li><div><b>${esc(caseTypes[entry.case_type] || entry.case_type)}</b> ${badge(entry.status)}${Number(entry.amount) > 0 ? ` · ${money(entry.amount)}` : ""}</div><p>${esc(entry.reason)}</p>${entry.resolution ? `<p class="resolution">处理结果：${esc(entry.resolution)}</p>` : ""}<small>${date(entry.created_at)}</small></li>`).join("")}</ul></section>` : ""}
    ${reviews.length ? `<section class="surface"><h2>评价</h2>${reviews.map((entry) => `<div class="review-item"><div class="review-head"><b>${esc(entry.author_name || "用户")}</b><span class="stars-static">${"★".repeat(entry.rating)}<i>${"★".repeat(5 - entry.rating)}</i></span><small>${dateOnly(entry.created_at)}</small></div>${entry.content ? `<p>${esc(entry.content)}</p>` : ""}</div>`).join("")}</section>` : ""}
  </div><aside>
    <section class="surface"><h2>参与方</h2>${parties.map(([role, id, name, confirmedAt]) => `<div class="party">${avatar({ name })}<div class="grow"><b>${esc(name || "—")}</b><small>${role}${id === user.id ? "（我）" : ""}</small>${item.status === "pending_confirm" ? `<div>${confirmState(confirmedAt)}</div>` : ""}</div>${id !== user.id && party ? button("open-chat", icon("message"), `data-peer="${esc(id)}" data-order="${esc(item.id)}" aria-label="与${esc(name || role)}交流" title="在线交流"`, "icon-only") : ""}</div>`).join("")}</section>
    <section class="surface"><h2>支付记录</h2>${payments.length ? `<div class="mini-list">${payments.map((payment) => `<div class="mini-row"><span class="grow"><b>${money(payment.amount)}</b><small>${date(payment.created_at)}</small></span>${badge(payment.status)}</div>`).join("")}</div>` : empty("暂无支付记录", "", "", "wallet")}</section>
    ${canAfterSales ? `<section class="surface"><h2>售后服务</h2><p class="muted">${client ? `对服务有异议或需要退款，可申请平台介入。订单完成 ${context.capabilities?.after_sales_window_days || 15} 天内可申请。` : "与当事人存在履约争议时，可申请平台介入处理。"}</p>${button("after-sales-modal", client ? "申请退款 / 争议处理" : "申请争议处理", "", "block")}</section>` : ""}
    ${party ? `<section class="surface"><h2>交易存证</h2><p class="muted">导出包含合同、文书版本指纹、会签、支付、交付与操作日志的存证包。</p>${button("export-evidence", `${icon("download")} 导出存证包`, "", "block")}</section>` : ""}
  </aside></div>`;
}
