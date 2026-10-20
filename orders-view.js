import { avatar, button, date, empty, esc, icon, money } from "./ui.js";

export const orderFilters = [
  ["all", "全部", null],
  ["pending_payment", "待支付", ["pending_payment"]],
  ["service", "服务中", ["service", "pending_delivery"]],
  ["pending_receipt", "待收悉", ["pending_receipt"]],
  ["completed", "已完成", ["completed"]],
  ["after_sales", "售后中", ["refund_pending", "refund_processing", "disputed", "closed"]],
];
const view = { filter: "all", query: "" };
const progress = [["pending_payment", "待支付"], ["service", "服务中"], ["pending_receipt", "待收悉"], ["completed", "已完成"]];
const stage = { pending_payment: 0, service: 1, pending_delivery: 1, pending_receipt: 2, completed: 3 };
const afterSales = ["refund_pending", "refund_processing", "disputed", "closed"];

export function setOrderFilter(value) { view.filter = value; }
export function setOrderQuery(value) { view.query = value; }

function counterpart(order, user) {
  return order.client_id === user.id ? { label: "承办律师", name: order.lawyer_name, id: order.lawyer_id } : { label: "委托当事人", name: order.client_name, id: order.client_id };
}

export function renderOrderCards({ orders, user, badge }) {
  const statuses = orderFilters.find(([key]) => key === view.filter)?.[2];
  const query = view.query.trim().toLowerCase();
  const items = orders.filter((order) => (!statuses || statuses.includes(order.status)) && (!query || order.title.toLowerCase().includes(query) || order.id.includes(query)));
  if (!items.length) return `<div class="no-result">${empty(orders.length ? "没有符合条件的订单" : "暂无订单", orders.length ? "" : '<a class="btn primary" href="#/requests">去发布需求</a>')}</div>`;
  return items.map((order) => {
    const other = counterpart(order, user);
    return `<a class="item-card" href="#/order/${esc(order.id)}"><header><h3>${esc(order.title)}</h3>${badge(order.status)}</header><div class="meta"><span>${icon("lawyer")}${other.label}：${esc(other.name || "—")}</span><span>${icon("clock")}${date(order.created_at)}</span></div><footer><div class="amount">${money(order.price)}<small>已付 ${money(order.paid)}</small></div>${badge(order.payment_status)}</footer></a>`;
  }).join("");
}

export function renderOrderList(context) {
  const { orders } = context;
  const counts = Object.fromEntries(orderFilters.map(([key, , statuses]) => [key, statuses ? orders.filter((order) => statuses.includes(order.status)).length : orders.length]));
  return `<div class="list-toolbar"><div class="pill-tabs" role="tablist">${orderFilters.map(([key, title]) => `<button type="button" role="tab" aria-selected="${view.filter === key}" class="${view.filter === key ? "active" : ""}" data-action="order-filter" data-value="${key}">${title}<em>${counts[key]}</em></button>`).join("")}</div><label class="search-input">${icon("search")}<span class="sr-only">搜索订单</span><input data-search="orders" value="${esc(view.query)}" placeholder="搜索订单标题或编号"></label></div><div class="card-grid" id="order-cards">${renderOrderCards(context)}</div>`;
}

function paymentBlock({ item, payment, client, capabilities }) {
  const simulationReady = client && payment?.provider === "stub" && ["created", "pending"].includes(payment.status) && capabilities.payment_simulation_enabled;
  const simulationPanel = simulationReady ? `<div class="simulation-payment"><p class="simulation-payment-title">模拟支付</p><p class="simulation-payment-amount">${money(payment.amount)}</p><p class="muted">请核对金额。二维码仅用于展示本次支付信息，点击下方“已支付”即可完成模拟支付。</p>${payment.client_params?.qr_svg_base64 ? `<img class="remote-payment-qr" alt="模拟支付二维码，金额${esc(money(payment.amount))}" src="data:image/svg+xml;base64,${esc(payment.client_params.qr_svg_base64)}">` : ""}${button("simulate-payment", "已支付", `data-id="${esc(payment.id)}"`, true)}</div>` : "";
  const external = payment ? `${payment.client_params?.pay_url && /^https:\/\/openapi(?:-sandbox\.dl)?\.alipay(?:dev)?\.com\/gateway\.do\?/.test(payment.client_params.pay_url) ? `<a class="btn primary" href="${esc(payment.client_params.pay_url)}" target="_blank" rel="noopener noreferrer">前往支付宝收银台</a>` : ""}${payment.client_params?.qr_svg_base64 && !simulationReady ? `<img class="remote-payment-qr" alt="微信支付二维码" src="data:image/svg+xml;base64,${esc(payment.client_params.qr_svg_base64)}">` : ""}${payment.client_params?.test_only && !simulationReady ? '<p class="muted">这是隔离测试支付单，不产生真实资金。</p>' : ""}` : "";
  return { simulationReady, html: `${simulationPanel}${external}`, payable: capabilities.payments_enabled && item.status === "pending_payment" };
}

function nextAction(context) {
  const { item, user, capabilities } = context;
  const client = item.client_id === user.id;
  const lawyer = item.lawyer_id === user.id;
  const payment = (item.payments || [])[0];
  if (item.status === "pending_payment") {
    if (!client) return ["", "等待当事人支付", "当事人完成支付后订单进入服务中，届时即可开始履约。", ""];
    const block = paymentBlock({ item, payment, client, capabilities });
    const actions = block.simulationReady ? "" : block.payable ? button("pay", "生成模拟支付", "", true) : "";
    const note = block.payable ? (capabilities.payment_simulation_enabled ? "当前为内网模拟支付：二维码仅展示本单金额，不产生真实资金。" : "支付结果只接受支付机构认证通知或主动查单，不接受浏览器自报成功。") : "当前使用内网模拟支付，生成二维码后点击“已支付”即可完成订单。";
    return ["", `请支付 ${money(item.price)} 开始服务`, note, actions, block.html];
  }
  if (["service", "pending_delivery"].includes(item.status)) return lawyer ? ["", "请提交交付物", "在下方“订单文书”中新建或完善文书，然后选择交付文书提交给当事人确认。", `${button("delivery-modal", "提交交付物", "", true)}${button("new-document", "新建文书", `data-order="${esc(item.id)}"`)}`] : ["", "律师正在服务中", "律师完成后会提交交付物，你会收到通知。期间可通过实时交流随时沟通。", button("open-chat", `${icon("message")} 联系律师`, `data-peer="${esc(item.lawyer_id)}" data-order="${esc(item.id)}"`, true)];
  if (item.status === "pending_receipt") return client ? ["", "请确认交付物", "查看下方交付记录中的文书，满意请确认收悉；需要修改可退回并说明原因。", `${button("accept-delivery", "确认收悉", "", true)}${button("return-delivery", "退回修改")}`] : ["", "等待当事人确认收悉", "当事人确认后订单完成并进入结算。", ""];
  if (item.status === "completed") return ["done", "订单已完成", "感谢使用平台服务，交付文书可在文书中心随时查看。", ""];
  if (afterSales.includes(item.status)) return ["alert", item.status === "closed" ? "订单已关闭" : "售后处理中", item.status === "closed" ? "订单已关闭，如有疑问请联系平台运营。" : "运营人员正在处理退款或争议，处理结果会通过服务通知告知。", ""];
  return ["", "订单状态", "", ""];
}

function stepper(status) {
  const current = stage[status] ?? (status === "closed" ? 4 : 1);
  return `<div class="stepper" aria-label="订单进度">${progress.map(([, title], index) => `<div class="step ${index < current || (index === current && status === "completed") ? "done" : index === current ? "current" : ""}"><span>${index < current || status === "completed" ? icon("check") : index + 1}</span>${title}</div>`).join("")}</div>`;
}

export function renderOrderDetail(context) {
  const { item, user, documents, badge, labels } = context;
  if (!item) return empty("未找到订单");
  const client = item.client_id === user.id;
  const [tone, title, text, actions, extra = ""] = nextAction(context);
  const payments = item.payments || [];
  const parties = [["委托当事人", item.client_id, item.client_name], ["承办律师", item.lawyer_id, item.lawyer_name]];
  const canAfterSales = client && Number(item.paid) > 0 && !["closed", "refund_pending", "disputed"].includes(item.status);
  return `<a class="back-link" href="#/orders">${icon("back")} 返回订单列表</a>
  <section class="surface"><div class="detail-hero"><div><div class="badges">${badge(item.status)}${badge(item.payment_status)}</div><h1>${esc(item.title)}</h1><div class="meta"><span>订单号 ${esc(item.id)}</span><span>创建于 ${date(item.created_at)}</span></div></div><div class="price"><small>订单金额</small><strong>${money(item.price)}</strong><small>已付 ${money(item.paid)}</small></div></div>${afterSales.includes(item.status) ? "" : stepper(item.status)}</section>
  <section class="next-action ${tone}"><div><h3>${title}</h3><p>${esc(text)}</p>${extra}</div>${actions ? `<div class="actions">${actions}</div>` : ""}</section>
  <div class="detail-grid-2"><div>
    <section class="surface"><div class="section-title"><h2>服务信息</h2>${button("refresh", `${icon("history")} 刷新`, 'aria-label="刷新订单"')}</div><dl class="data-list"><div><dt>服务范围</dt><dd>${esc(item.scope)}</dd></div><div><dt>支付状态</dt><dd>${esc(labels[item.payment_status] || item.payment_status)}</dd></div><div><dt>结算标记（非资金托管证明）</dt><dd>${esc(labels[item.settlement_status] || item.settlement_status)}</dd></div><div><dt>最近更新</dt><dd>${date(item.updated_at)}</dd></div></dl></section>
    <section class="surface"><div class="section-title"><h2>订单文书</h2>${item.payment_status === "paid" ? button("new-document", `${icon("plus")} 新建文书`, `data-order="${esc(item.id)}"`) : '<small>支付后可创建文书</small>'}</div>${documents.length ? `<div class="mini-list">${documents.map((doc) => `<a class="mini-row" href="#/doc/${esc(doc.id)}"><span><b>${esc(doc.title)}</b> · v${doc.current_version}</span>${badge(doc.status)}</a>`).join("")}</div>` : empty("暂无订单文书")}</section>
    <section class="surface"><h2>交付记录</h2>${(item.deliveries || []).length ? `<ul class="timeline-list">${item.deliveries.map((delivery) => `<li>${badge(delivery.status)} ${delivery.document_id ? `<a class="link" href="#/doc/${esc(delivery.document_id)}">查看交付文书</a>` : "无关联文书"}<small>${date(delivery.created_at)}</small></li>`).join("")}</ul>` : empty("暂无交付记录")}</section>
    <section class="surface"><h2>售后记录</h2>${(item.cases || []).length ? `<ul class="timeline-list">${item.cases.map((entry) => `<li><b>${entry.case_type === "refund" ? "退款" : "争议"}</b> ${badge(entry.status)} · ${money(entry.amount)}<small>${esc(entry.resolution || entry.reason)} · ${date(entry.created_at)}</small></li>`).join("")}</ul>` : empty("暂无售后记录")}</section>
  </div><aside>
    <section class="surface"><h2>参与方</h2>${parties.map(([role, id, name]) => `<div class="party">${avatar({ name })}<div><b>${esc(name || id)}</b><small>${role}${id === user.id ? "（我）" : ""}</small></div>${id !== user.id ? `<span class="badges">${button("open-chat", `${icon("message")} 交流`, `data-peer="${esc(id)}" data-order="${esc(item.id)}"`)}</span>` : ""}</div>`).join("")}</section>
    <section class="surface"><h2>支付记录</h2>${payments.length ? `<div class="mini-list">${payments.map((payment) => `<div class="mini-row"><span><b>${money(payment.amount)}</b><br><small class="muted">${date(payment.created_at)}</small></span>${badge(payment.status)}</div>`).join("")}</div>` : empty("暂无支付记录")}</section>
    ${canAfterSales ? `<section class="surface"><h2>售后服务</h2><p class="muted">对服务不满意或需要退款，可提交申请，由平台运营介入处理。</p>${button("after-sales-modal", "申请退款 / 争议处理")}</section>` : ""}
  </aside></div>`;
}
