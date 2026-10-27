import { apiRequest, downloadFile, mutate, streamMutate, uploadFile } from "./api-client.js";
import { clearSession, getCurrentUser, setSession, updateCurrentUser } from "./auth-state.js";
import { avatarDataUrl, renderAccount, renderLawyerOnboarding } from "./account-view.js";
import { renderAuthPage } from "./auth-view.js";
import { createChat } from "./chat.js";
import { documentTemplates, newDocumentBody, refreshPicker, renderDocumentCards, renderDocumentDetail, renderDocumentList, setDocumentFilter, setDocumentQuery, setDocumentTab, workflowModalBody } from "./documents-view.js";
import { renderWorkbench, setGuideTab, toggleGuide } from "./guide.js";
import { createModelConsultation } from "./model-consultation.js";
import { bindRequestAttachments, renderRequestAttachments, requestAttachmentField, uploadRequestAttachments } from "./request-attachments.js";
import { renderOrderCards, renderOrderDetail, renderOrderList, setOrderFilter, setOrderQuery } from "./orders-view.js";
import { avatar, button, date, empty, esc, field, formData, icon, money, status } from "./ui.js";

const app = document.querySelector("#app");
let state = freshState();
let route = parseRoute();
let viewRole = "client";
let loadVersion = 0;
let toastTimer;
let paymentTimer;
let draftOwner = "";
let registrationChallengeRequest = 0;
let registrationChallenge = null;
const formDrafts = new Map();
const badges = { chat: 0, notifications: 0 };
const labels = { pending_payment: "待支付", service: "服务中", quoting: "待报价", ordered: "已下单", draft: "草稿", submitted: "已提交", under_review: "审核中", approved: "已通过", supplement: "需补件", rejected: "已拒绝", withdrawn: "已撤回", frozen: "已冻结", completed: "已完成", pending_receipt: "待收悉", pending_delivery: "待交付", refund_pending: "退款处理中", refund_processing: "退款处理中", disputed: "争议中", closed: "已关闭", confirmed: "已确认", signing: "会签中", returned: "已退回", pending: "待处理", waiting: "待轮到", success: "成功", created: "等待支付", creating: "支付渠道处理中", failed: "失败", paid: "已支付", unpaid: "未支付", refunded: "已退款", partially_refunded: "部分退款", valid: "有效", accepted: "已接受", expired: "已失效" };
const roleNames = { client: "当事人", lawyer: "律师", operator: "运营" };
const modelConsultation = createModelConsultation({
  getDb: () => ({ modelChats: state.consultations.map((item) => ({ ...item, owner: getCurrentUser()?.id, updated: item.updated_at, created: item.created_at, messages: item.messages || [] })) }),
  getActor: () => ({ ...getCurrentUser(), role: "client" }),
  commit: consultationCommand,
  refresh: render,
  navigate,
  notify,
  modal,
  closeModal,
  download,
  createRequest: consentRequest,
});
const chat = createChat({ getUser: getCurrentUser, notify, navigate, onBadge: (count) => { badges.chat = count; paintBadges(); } });

function freshState() {
  return { capabilities: {}, consultations: [], requests: [], lawyers: [], orders: [], documents: [], notifications: [], applications: [], cases: [], audit: [], detail: null, loading: false, error: "" };
}

function parseRoute() {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const [page = "home", id = ""] = path.split("/").filter(Boolean);
  return { page: page === "profile" ? "account" : page, id: decodeURIComponent(id), query: new URLSearchParams(query) };
}

function navigate(page, id = "", query = {}) {
  const search = new URLSearchParams(query).toString();
  location.hash = `#/${page}${id ? `/${encodeURIComponent(id)}` : ""}${search ? `?${search}` : ""}`;
}

function heading(title, description = "", actions = "") {
  return `<div class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="heading-actions">${actions}</div></div>`;
}

function badge(value) { return status(labels[value] || value || "—"); }
function ownsRole(role) { return getCurrentUser()?.roles?.includes(role); }
function detailList(values) { return `<dl class="data-list">${values.map(([title, value]) => `<div><dt>${esc(title)}</dt><dd>${esc(value ?? "—")}</dd></div>`).join("")}</dl>`; }
function rows(items, columns) { return items.length ? `<div class="table-wrap"><table><thead><tr>${columns.map(([title]) => `<th>${esc(title)}</th>`).join("")}</tr></thead><tbody>${items.map((item) => `<tr>${columns.map(([, value]) => `<td>${value(item)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : empty(); }
function formButton(text) { return `<p class="form-error" role="alert"></p><button class="btn primary" type="submit">${esc(text)}</button>`; }
function sourceKey(form) { return `${route.page}:${route.id}:${form.dataset.form}`; }
function paintBadges() {
  document.querySelectorAll("[data-badge]").forEach((element) => {
    const count = badges[element.dataset.badge] || 0;
    element.hidden = !count;
    element.textContent = count > 99 ? "99+" : String(count);
  });
}

function menuGroups() {
  const lawyerView = viewRole === "lawyer";
  const groups = [
    ["工作区", [["home", "工作台", "home"], ...(ownsRole("client") ? [["model-chat", "法律模型咨询", "spark"]] : []), ...(ownsRole("operator") && !ownsRole("client") && !ownsRole("lawyer") ? [] : [["messages", "实时交流", "message", "chat"]])]],
    ["服务", [["requests", lawyerView ? "需求线索" : "服务需求", "request"], ["lawyers", "找律师", "lawyer"], ["orders", "服务订单", "order"], ["docs", "文书中心", "doc"]]],
    ["我的", [["notifications", "服务通知", "bell", "notifications"], ["account", "账号设置", "account"], ...(ownsRole("operator") ? [] : [["lawyer-onboarding", "律师入驻", "review"]])]],
  ];
  if (ownsRole("operator")) groups.push(["运营管理", [["reviewLawyers", "律师审核", "review"], ["cases", "售后处理", "order"], ["paymentOps", "支付运维", "finance"], ["audit", "审计日志", "audit"]]]);
  return groups;
}

function render() {
  route = parseRoute();
  if (!getCurrentUser()) return renderAuthentication();
  const user = getCurrentUser();
  if (!user.roles.includes(viewRole)) viewRole = user.roles.includes("client") ? "client" : user.roles[0] || "client";
  const groups = menuGroups();
  const activePage = { order: "orders", doc: "docs", model: "model-chat", chat: "model-chat", lawyer: "requests", workspace: "docs" }[route.page] || route.page;
  const title = groups.flatMap(([, items]) => items).find(([name]) => name === activePage)?.[1] || "法律服务平台";
  document.title = `${title} · 法律服务平台`;
  const bodyClass = route.page === "model-chat" ? "model-page-body" : route.page === "messages" ? "chat-page-body" : "";
  app.innerHTML = `<div class="app-shell"><aside class="app-sidebar" aria-label="主导航"><a class="platform-brand" href="#/home"><span class="brand-mark"><img src="./assets/legal-service-icon.jpg" alt="" /></span><div><b>法律服务平台</b><small>咨询 · 协作 · 履约</small></div></a><nav class="app-nav">${groups.map(([group, items]) => `<div class="nav-group"><div class="nav-group-title">${group}</div>${items.map(([name, text, glyph, badgeKey]) => `<a href="#/${name}" class="nav-link ${activePage === name ? "active" : ""}" ${activePage === name ? 'aria-current="page"' : ""}>${icon(glyph)}<span>${esc(text)}</span>${badgeKey ? `<span class="count-badge" data-badge="${badgeKey}" hidden></span>` : ""}</a>`).join("")}</div>`).join("")}</nav><div class="sidebar-foot">紧急事项或已被采取强制措施时，请优先联系执业律师。</div></aside><div class="sidebar-backdrop" data-action="nav-toggle"></div>
  <div class="app-main"><header class="app-topbar"><button class="icon-btn menu-toggle" data-action="nav-toggle" aria-label="打开导航">${icon("menu")}</button><div class="topbar-title">${esc(title)}</div>${user.roles.length > 1 ? `<div class="role-switch" role="group" aria-label="切换视图">${user.roles.map((role) => `<button type="button" class="${role === viewRole ? "active" : ""}" aria-pressed="${role === viewRole}" data-action="switch-role" data-role="${esc(role)}">${esc(roleNames[role] || role)}</button>`).join("")}</div>` : ""}${!ownsRole("operator") || ownsRole("client") ? `<a class="icon-btn" href="#/messages" aria-label="实时交流" title="实时交流">${icon("message")}<span class="count-badge" data-badge="chat" hidden></span></a>` : ""}<a class="icon-btn" href="#/notifications" aria-label="服务通知" title="服务通知">${icon("bell")}<span class="count-badge" data-badge="notifications" hidden></span></a><div class="user-menu"><button class="user-trigger" data-action="user-menu" aria-haspopup="true" aria-expanded="false">${avatar(user, "sm")}<b>${esc(user.name)}</b></button><div class="user-menu-panel" id="user-menu-panel" hidden><header><b>${esc(user.name)}</b><small>${esc(user.email)}</small></header><a href="#/account">${icon("account")} 账号设置</a>${ownsRole("operator") ? "" : `<a href="#/lawyer-onboarding">${icon("review")} 律师入驻</a>`}<button data-action="refresh">${icon("history")} 刷新数据</button><button data-action="logout">${icon("logout")} 退出登录</button></div></div></header>
  <section class="page-body ${bodyClass}">${state.loading ? '<section class="surface" aria-busy="true">正在从服务器读取…</section>' : state.error ? `<section class="surface" role="alert"><h2>暂时无法读取</h2><p>${esc(state.error)}</p>${button("refresh", "重试")}</section>` : page()}${!state.loading && !state.error ? pagination() : ""}</section></div></div><div id="toast" role="status" aria-live="polite"></div>`;
  paintBadges();
  restoreDrafts(app);
  if (["model-chat", "chat"].includes(route.page) && !state.loading && !state.error) modelConsultation.bind(app);
  if (route.page === "messages" && !state.loading && !state.error) chat.bind(app);
}

function renderAuthentication(register = false) {
  registrationChallenge = null;
  app.innerHTML = renderAuthPage(register);
  if (register) {
    const submit = app.querySelector('form[data-form="register"] [type="submit"]');
    submit.disabled = true;
    void loadRegistrationChallenge();
  }
}

async function loadRegistrationChallenge() {
  const requestId = ++registrationChallengeRequest;
  const form = app.querySelector('form[data-form="register"]');
  if (!form) return;
  const question = form.querySelector("#registration-question");
  const submit = form.querySelector('[type="submit"]');
  question.textContent = "正在生成题目…";
  form.elements.challenge_id.value = "";
  form.elements.challenge_answer.value = "";
  submit.disabled = true;
  try {
    const challenge = await apiRequest("/auth/registration-challenge");
    if (requestId !== registrationChallengeRequest || !form.isConnected) return;
    registrationChallenge = challenge;
    question.textContent = challenge.question;
    form.elements.challenge_id.value = challenge.id;
    submit.disabled = false;
  } catch (error) {
    if (requestId === registrationChallengeRequest && form.isConnected) question.textContent = "题目加载失败，请点击换一道题";
    notify(error.message);
  }
}

function page() {
  const user = getCurrentUser();
  if (route.page === "model-chat" || route.page === "chat") return modelConsultation.render(route);
  if (route.page === "messages") return chat.render(route);
  if (route.page === "requests" || route.page === "lawyer") return route.id ? requestPage() : `${heading(viewRole === "lawyer" ? "需求线索" : "服务需求", viewRole === "lawyer" ? "认证律师可查看当事人公开的需求并提交报价。" : "发布需求后，认证律师会在线报价；也可以从模型咨询一键生成需求草稿。", ownsRole("client") ? button("new-request", `${icon("plus")} 发布新需求`, "", true) : "")}<section class="surface">${requestRows()}</section>`;
  if (route.page === "lawyers") return `${heading("认证律师", "仅展示资质有效且已核准的律师；完整证件和邮箱不公开。可直接发起实时交流了解服务细节。")}<section class="surface">${rows(state.lawyers, [["律师", (item) => `<span class="party">${avatar(item, "sm")}<b>${esc(item.name)}</b></span>`], ["律所", (item) => esc(item.firm)], ["地区 / 领域", (item) => `${esc(item.region)} · ${esc(item.field)}`], ["服务方式", (item) => esc(item.mode)], ["资质", (item) => badge(item.status)], ["操作", (item) => ownsRole("client") && item.id !== user.id ? button("open-chat", `${icon("message")} 联系律师`, `data-peer="${esc(item.id)}"`) : "—"]])}</section>`;
  if (["orders", "lawyerOrders", "adminOrders"].includes(route.page)) return `${heading("服务订单", "跟踪每笔订单的支付、履约、交付与售后进度。金额与支付状态以服务端记录为准。")}${renderOrderList({ orders: state.orders, user, badge })}`;
  if (route.page === "order") return renderOrderDetail({ item: state.detail, user, capabilities: state.capabilities, documents: state.documents, badge, labels });
  if (["docs", "workspace"].includes(route.page)) return `${heading("文书中心", "集中管理订单文书：版本留痕、批注讨论、顺序会签与受控下载。", !ownsRole("operator") ? button("new-document", `${icon("plus")} 新建文书`, "", true) : "")}${renderDocumentList({ documents: state.documents, user, badge })}`;
  if (route.page === "doc") return renderDocumentDetail({ item: state.detail, user, badge, operator: ownsRole("operator") });
  if (route.page === "account") return `${heading("账号设置", "管理头像、个人资料与登录安全。")}${renderAccount({ user, roleNames })}`;
  if (route.page === "lawyer-onboarding") return `${heading("律师入驻", "提交执业资质，审核通过后开通律师视图与接单能力。")}${renderLawyerOnboarding({ applications: state.applications, badge, operator: ownsRole("operator") })}`;
  if (route.page === "reviewLawyers") return reviewPage();
  if (route.page === "cases") return casesPage();
  if (route.page === "paymentOps") return paymentOpsPage();
  if (route.page === "audit") return `${heading("审计日志", "业务变更与审计共同提交；不包含模型凭证。")}<section class="surface">${rows(state.audit, [["时间", (item) => date(item.created_at)], ["操作", (item) => esc(item.action)], ["对象", (item) => esc(`${item.object_type}:${item.object_id}`)], ["请求标识", (item) => esc(item.request_id)]])}</section>`;
  if (route.page === "notifications") return `${heading("服务通知", "订单、报价、文书与审核相关的系统通知。")}<section class="surface">${rows(state.notifications, [["标题", (item) => `<b>${esc(item.title)}</b>`], ["内容", (item) => esc(item.body)], ["时间", (item) => date(item.created_at)], ["状态", (item) => item.read_at ? '<span class="muted">已读</span>' : button("read-notification", "标记已读", `data-id="${esc(item.id)}"`)]])}</section>`;
  return renderWorkbench({ state, user, viewRole, roleName: roleNames[viewRole] || viewRole, unreadChats: badges.chat });
}

function requestRows() {
  return rows(state.requests, [["需求", (item) => `<a href="#/requests/${esc(item.id)}">${esc(item.title)}</a>`], ["地区 / 类型", (item) => `${esc(item.region)} · ${esc(item.service_type)}`], ["预算", (item) => money(item.budget)], ["截止", (item) => esc(item.deadline)], ["状态", (item) => badge(item.status)]]);
}

function requestPage() {
  const item = state.detail;
  if (!item) return empty("未找到需求");
  const me = getCurrentUser().id;
  const quoted = (item.quotes || []).some((quote) => quote.lawyer_id === me);
  return `<a class="back-link" href="#/requests">${icon("back")} 返回需求列表</a>${heading(item.title, `${item.region} · ${item.service_type}`, ownsRole("lawyer") && item.owner_id !== me && quoted ? button("open-chat", `${icon("message")} 联系当事人`, `data-peer="${esc(item.owner_id)}"`) : "")}<section class="surface"><div class="badges">${badge(item.status)}</div>${detailList([["事实与目标", item.facts], ["期望交付", item.deliverables], ["预算", money(item.budget)], ["公开范围", item.visibility]])}</section>${renderRequestAttachments(item)}<section class="surface"><h2>律师报价</h2>${rows(item.quotes || [], [["服务范围", (quote) => esc(quote.scope)], ["交付", (quote) => esc(quote.deliverables)], ["报价", (quote) => money(quote.price)], ["有效期", (quote) => esc(quote.valid_until)], ["操作", (quote) => item.owner_id === me ? `${quote.status === "valid" && item.status === "quoting" ? button("accept-quote", "接受报价并创建订单", `data-id="${esc(quote.id)}"`, true) : badge(quote.status)} ${button("open-chat", `${icon("message")} 交流`, `data-peer="${esc(quote.lawyer_id)}"`)}` : badge(quote.status)]])}</section>${ownsRole("lawyer") && item.owner_id !== me && item.status === "quoting" ? `<section class="surface"><h2>提交报价</h2><form data-form="quote">${field("服务范围", "scope", "", { textarea: true, required: true })}${field("交付物", "deliverables", "", { required: true })}<div class="form-grid">${field("费用（元）", "price", "", { type: "number", min: "0.01", required: true })}${field("服务天数", "days", "3", { type: "number", min: 1, required: true })}${field("报价有效期", "valid_until", "", { type: "date", required: true })}</div>${formButton("提交报价")}</form></section>` : ""}`;
}

function reviewPage() {
  return `${heading("律师入驻审核", "管理员选择同意后即可完成律师入驻并启用接单；申请资料和有效期仍由系统校验。")}${state.applications.map((entry) => `<section class="surface remote-record"><h2>${esc(entry.firm)} · 申请 v${entry.version} ${badge(entry.status)}</h2>${detailList([["用户ID", entry.user_id], ["地区 / 领域", `${entry.region} / ${entry.field}`], ["执业证号", entry.license_number], ["有效期", entry.expires_on]])}${entry.credential_file_ids.map((fileId) => button("review-file", "下载审核材料（留审计）", `data-application="${esc(entry.id)}" data-id="${esc(fileId)}"`)).join(" ")}${["submitted", "under_review"].includes(entry.status) ? `<form data-form="review-lawyer" data-id="${esc(entry.id)}"><input name="expected_version" type="hidden" value="${entry.version}">${field("决定", "decision", "supplement", { options: ["approve", "reject", "supplement"] })}${field("审核意见", "reason", "", { textarea: true, required: true })}${formButton("提交审核决定")}</form>` : ""}${entry.status === "approved" ? button("freeze-lawyer", "冻结新接单权限", `data-id="${esc(entry.user_id)}"`) : ""}${entry.reviews.map((review) => `<p>${esc(review.decision)}：${esc(review.reason)} · ${date(review.created_at)}</p>`).join("")}</section>`).join("") || empty("暂无申请")}`;
}

function casesPage() {
  return `${heading("售后与争议", "同意退款后需等待支付机构确认，不能只修改本地已退款状态。")}${state.cases.map((entry) => `<section class="surface"><h2>${esc(entry.case_type)} ${badge(entry.status)}</h2><p><a class="link" href="#/order/${esc(entry.order_id)}">查看订单</a> · ${money(entry.amount)}</p><p>${esc(entry.reason)}</p>${entry.status === "pending" ? `<form data-form="resolve-case" data-id="${esc(entry.id)}">${field("决定", "decision", "reject", { options: ["approve", "reject"] })}${field("处理意见", "resolution", "", { textarea: true, required: true })}${formButton("确认处理")}</form>` : `<p>${esc(entry.resolution)}</p>`}</section>`).join("") || empty()}`;
}

function paymentOpsPage() {
  const details = state.detail || {};
  return `${heading("支付运维", "异常通知、重复资金流水和退款任务需持续监测；签约前收款保持关闭。") }<section class="surface">${detailList([["渠道", state.capabilities.payment_provider], ["收款开关", state.capabilities.payments_enabled ? "已配置（仍需商户验收）" : "关闭"], ["待处理通知", details.pending_inbox], ["人工处理通知", details.manual_review], ["待确认退款", details.pending_refunds], ["重复扣款待核对", details.overpayments]])}</section>`;
}

function pagination() {
  if (route.id) return "";
  const resources = { requests: "requests", lawyer: "requests", orders: "orders", lawyerOrders: "orders", adminOrders: "orders", docs: "documents", workspace: "documents", notifications: "notifications", reviewLawyers: "applications", audit: "audit" };
  const resource = resources[route.page];
  if (!resource) return "";
  const offset = Math.max(0, Number(route.query.get("offset")) || 0);
  if (!offset && state[resource].length < 50) return "";
  return `<div class="filter-row"><span class="muted">每页50条 · 第${Math.floor(offset / 50) + 1}页</span><div class="badges">${offset ? button("page", "上一页", `data-offset="${Math.max(0, offset - 50)}"`) : ""}${state[resource].length >= 50 ? button("page", "下一页", `data-offset="${offset + 50}"`) : ""}</div></div>`;
}

async function refreshNotificationBadge() {
  try {
    badges.notifications = (await apiRequest("/notifications/unread-count")).unread;
    paintBadges();
  } catch { /* 角标失败不影响页面 */ }
}

async function load() {
  const version = ++loadVersion;
  route = parseRoute();
  clearTimeout(paymentTimer);
  if (!getCurrentUser()) return render();
  state.loading = true;
  state.error = "";
  render();
  const currentRoute = { ...route };
  try {
    const user = await apiRequest("/auth/me");
    if (version !== loadVersion) return;
    updateCurrentUser(user);
    void refreshNotificationBadge();
    const next = {};
    const offset = Math.max(0, Number(currentRoute.query.get("offset")) || 0);
    const paging = `limit=50&offset=${offset}`;
    next.capabilities = await apiRequest("/capabilities");
    const pageName = currentRoute.page;
    if (["home", "model-chat", "chat"].includes(pageName) && user.roles.includes("client")) next.consultations = await apiRequest(`/consultations?${paging}`);
    if (["model-chat", "chat"].includes(pageName) && currentRoute.id) {
      const detail = await apiRequest(`/consultations/${currentRoute.id}`);
      next.consultations = [detail, ...next.consultations.filter((item) => item.id !== detail.id)];
    }
    if (["home", "requests", "lawyer"].includes(pageName)) next.requests = await apiRequest(`/requests?${paging}`);
    if (["home", "orders", "lawyerOrders", "adminOrders", "docs", "workspace"].includes(pageName)) next.orders = await apiRequest(`/orders?${paging}`);
    if (["home", "docs", "workspace"].includes(pageName)) next.documents = await apiRequest(`/documents?${paging}`);
    if (pageName === "lawyers") next.lawyers = await apiRequest("/lawyers");
    if (["requests", "lawyer"].includes(pageName) && currentRoute.id) next.detail = { ...await apiRequest(`/requests/${currentRoute.id}`), quotes: await apiRequest(`/requests/${currentRoute.id}/quotes`) };
    if (pageName === "order") {
      next.detail = { ...await apiRequest(`/orders/${currentRoute.id}`), payments: await apiRequest(`/orders/${currentRoute.id}/payments`), deliveries: await apiRequest(`/orders/${currentRoute.id}/deliveries`), cases: await apiRequest(`/orders/${currentRoute.id}/after-sales`) };
      next.documents = await apiRequest(`/documents?order_id=${encodeURIComponent(currentRoute.id)}&limit=100`);
    }
    if (pageName === "doc") next.detail = await apiRequest(`/documents/${currentRoute.id}`);
    if (pageName === "lawyer-onboarding") next.applications = await apiRequest("/lawyers/me/application");
    if (pageName === "reviewLawyers") next.applications = await apiRequest(`/admin/lawyer-applications?${paging}`);
    if (pageName === "cases") next.cases = await apiRequest("/admin/cases");
    if (pageName === "audit") next.audit = await apiRequest(`/admin/audit?${paging}`);
    if (pageName === "paymentOps") next.detail = await apiRequest("/admin/payment-status");
    if (pageName === "notifications") next.notifications = await apiRequest(`/notifications?${paging}`);
    if (version !== loadVersion || !getCurrentUser() || getCurrentUser().id !== user.id) return;
    Object.assign(state, next, { loading: false });
    render();
    if (pageName === "order" && next.detail?.payments?.some((item) => item.provider !== "stub" && ["creating", "created"].includes(item.status))) paymentTimer = setTimeout(load, 5000);
  } catch (error) {
    if (version !== loadVersion) return;
    state.loading = false;
    state.error = error.message;
    render();
  }
}

async function consultationCommand(name, payload) {
  const { onStart, onChunk, ...command } = payload;
  const owner = getCurrentUser()?.id;
  let consultationId = command.id;
  try {
    if (name === "model-feedback") {
      const chat = state.consultations.find((item) => item.id === command.id);
      const result = await mutate(`/consultations/${command.id}/feedback`, { message_id: chat.messages[command.index].id, value: command.value, reason: "" });
      await load();
      return result;
    }
    if (name === "model-delete") {
      await apiRequest(`/consultations/${encodeURIComponent(command.id)}`, { method: "DELETE" });
      state.consultations = state.consultations.filter((item) => item.id !== command.id);
      if (route.page === "model-chat" && route.id === command.id) navigate("model-chat");
      else render();
      return { id: command.id };
    }
    if (!consultationId) {
      const chat = await mutate("/consultations", { topic: command.topic, title: command.prompt.slice(0, 80) });
      consultationId = chat.id;
      onStart?.(consultationId);
    }
    const attachments = [];
    for (const item of command.attachments || []) {
      if (!item.file_id) item.file_id = (await uploadFile(item.file)).id;
      attachments.push({ file_id: item.file_id, name: item.name, size: item.size });
    }
    const chat = await streamMutate(`/consultations/${consultationId}/messages/stream`, { prompt: command.prompt, topic: command.topic, context_enabled: command.contextEnabled, attachments }, {
      timeoutMs: 200000,
      onEvent: async (event, data) => {
        if (event === "chunk") onChunk?.(data.text || "");
      },
    });
    if (getCurrentUser()?.id !== owner) throw new Error("登录状态已变化，请重新查看咨询记录");
    state.consultations = [chat, ...state.consultations.filter((item) => item.id !== chat.id)];
    return chat;
  } catch (error) {
    error.consultationId = consultationId;
    throw error;
  }
}

function consentRequest(consultationId) {
  const fields = ["需求标题", "业务分类", "专业领域", "服务类型", "地区", "预算", "期望截止日期", "事实与目标", "交付物要求"];
  const intro = `<p>“需求草稿”是把你与法律模型的咨询对话，自动整理成一份可以发布给认证律师的<b>服务需求</b>。省去重复填写，律师也能更快理解你的情况并报价。</p><ol class="consent-steps"><li><b>授权</b>勾选同意，允许系统读取本次咨询对话</li><li><b>模型生成草稿</b>自动提取关键信息并填入需求表单</li><li><b>核对后发布</b>你逐项修改确认后才会发布</li></ol><div class="consent-section"><h3>将自动填写的字段</h3><div class="chip-list">${fields.map((name) => `<span class="chip">${name}</span>`).join("")}</div><h3>使用哪些数据</h3><p>仅使用本次咨询中的提问与回答；上传的材料文件不会被读取。系统会保存一份授权快照用于留痕。</p><h3>你的控制权</h3><p>草稿不会自动发布。生成后所有字段都可修改，信息不足的字段会提示补充；只有你点击“确认发布”后，需求才对认证律师可见。</p></div>`;
  if (!consultationId) return modal("什么是需求草稿？", `${intro}<div class="modal-actions"><button class="btn primary" type="button" data-action="close-modal">我知道了</button></div>`);
  modal("授权生成需求草稿", `${intro}<form data-form="consent-summary" data-id="${esc(consultationId)}"><label class="check-row"><input type="checkbox" name="consent" required> 我同意使用本次咨询对话生成服务需求草稿</label><p class="form-error" role="alert"></p><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">暂不生成</button><button class="btn primary" type="submit">同意并生成草稿</button></div></form>`);
}

function requestModal(summary = null) {
  const generated = summary?.summary?.request_draft || {};
  const facts = generated.facts || summary?.summary?.questions?.join("\n\n") || "";
  const missingLabels = { title: "需求标题", domain: "业务分类", field: "专业领域", service_type: "服务类型", region: "地区", budget: "预算", deadline: "期望截止日期", facts: "事实与目标", deliverables: "交付物要求" };
  const missing = (generated.missing_fields || []).map((name) => missingLabels[name] || name).filter(Boolean);
  const notice = summary ? `<div class="remote-warning"><b>${generated.generated_by === "model" ? "法律模型已根据咨询对话生成需求草稿" : "已根据咨询记录生成需求草稿"}</b><p>请逐项核对并按实际需求修改，系统不会未经确认自动发布。</p>${missing.length ? `<p>仍需补充：${esc(missing.join("、"))}</p>` : ""}</div>` : "";
  modal("发布服务需求", `${notice}<form data-form="request">${summary ? `<input type="hidden" name="source_consultation_id" value="${esc(summary.consultation_id)}"><input type="hidden" name="consent_id" value="${esc(summary.consent_id)}">` : ""}${field("需求标题", "title", generated.title || "", { required: true })}<div class="form-grid">${field("业务分类", "domain", generated.domain || "", { required: true })}${field("专业领域", "field", generated.field || "", { required: true })}${field("服务类型", "service_type", generated.service_type || "", { required: true })}${field("地区", "region", generated.region || "", { required: true })}${field("预算（元）", "budget", generated.budget || "", { type: "number", min: "0.01", required: true })}${field("期望截止日期", "deadline", generated.deadline || "", { type: "date", required: true })}</div>${field("事实与目标（至少8字）", "facts", facts, { textarea: true, required: true })}${field("交付物要求", "deliverables", generated.deliverables || "", { textarea: true, required: true })}${requestAttachmentField()}${field("公开范围", "visibility", "认证律师可见", { options: ["认证律师可见"] })}<label class="check-row"><input name="consent" type="checkbox" required> 我已核对内容并同意向认证律师发布需求</label>${formButton("确认发布")}</form>`);
}

function modal(title, body) {
  closeModal();
  const element = document.createElement("div");
  element.id = "remote-modal";
  element.className = "modal-overlay";
  element.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon("close")}</button></header><div class="modal-body">${body}</div></section>`;
  document.body.append(element);
  restoreDrafts(element);
  bindRequestAttachments(element);
  element.querySelector("input:not([type=hidden]), textarea, button")?.focus();
}

function closeModal() { document.querySelector("#remote-modal")?.remove(); }
function notify(message) {
  let target = document.querySelector("#toast");
  if (!target) return;
  target.textContent = message;
  target.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => target.classList.remove("show"), 5000);
}
function download(name, content, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function restoreDrafts(root) {
  root.querySelectorAll("form[data-form]").forEach((form) => {
    if (["login", "register"].includes(form.dataset.form)) return;
    const values = formDrafts.get(sourceKey(form));
    if (!values) return;
    for (const [name, value] of Object.entries(values)) {
      const input = form.elements.namedItem(name);
      if (input && !["file", "hidden", "password"].includes(input.type)) {
        if (input.type === "checkbox") input.checked = value === "on";
        else input.value = value;
      }
    }
  });
}

function resetSession() {
  draftOwner = "";
  clearSession();
  chat.stop();
  state = freshState();
  formDrafts.clear();
  modelConsultation.clear();
  badges.chat = badges.notifications = 0;
  ++loadVersion;
  clearTimeout(paymentTimer);
  closeModal();
}

document.addEventListener("input", (event) => {
  const search = event.target.closest("[data-search]");
  if (search) {
    if (search.dataset.search === "orders") { setOrderQuery(search.value); document.querySelector("#order-cards").innerHTML = renderOrderCards({ orders: state.orders, user: getCurrentUser(), badge }); }
    if (search.dataset.search === "documents") { setDocumentQuery(search.value); document.querySelector("#document-cards").innerHTML = renderDocumentCards({ documents: state.documents, user: getCurrentUser(), badge }); }
    return;
  }
  const form = event.target.closest("form[data-form]");
  if (form && !["login", "register"].includes(form.dataset.form)) {
    const values = Object.fromEntries(new FormData(form));
    for (const [name, value] of Object.entries(values)) if (value instanceof File || form.elements.namedItem(name)?.type === "password") delete values[name];
    formDrafts.set(sourceKey(form), values);
  }
});

document.addEventListener("change", async (event) => {
  const target = event.target;
  if (target.matches("[data-template-select]")) {
    const body = target.form.elements.body;
    const template = documentTemplates[target.value]?.[1] ?? "";
    if (!body.value.trim() || body.dataset.fromTemplate === "true") { body.value = template; body.dataset.fromTemplate = "true"; }
    else notify("正文已有内容，未覆盖。清空正文后再选择模板即可填充");
    if (!target.form.elements.title.value && target.value !== "blank") target.form.elements.title.value = documentTemplates[target.value][0];
  }
  if (target.matches("[data-member]")) refreshPicker(target.closest("[data-member-picker]"));
  if (target.id === "avatar-input" && target.files[0]) {
    try {
      const user = await apiRequest("/auth/avatar", { method: "POST", body: { data_url: await avatarDataUrl(target.files[0]) } });
      updateCurrentUser({ ...getCurrentUser(), ...user });
      render();
      notify("头像已更新");
    } catch (error) { notify(error.message); target.value = ""; }
  }
});

document.addEventListener("click", async (event) => {
  const panel = document.querySelector("#user-menu-panel");
  if (panel && !panel.hidden && !event.target.closest(".user-menu")) panel.hidden = true;
  const element = event.target.closest("[data-action]");
  if (!element || element.disabled) return;
  const action = element.dataset.action;
  element.disabled = true;
  try {
    if (action === "login-view" || action === "register-view") return renderAuthentication(action === "register-view");
    if (action === "registration-refresh") return await loadRegistrationChallenge();
    if (action === "logout") { resetSession(); return render(); }
    if (action === "close-modal") return closeModal();
    if (action === "nav-toggle") return document.querySelector(".app-shell")?.classList.toggle("nav-open");
    if (action === "user-menu") { const open = panel.hidden; panel.hidden = !open; element.setAttribute("aria-expanded", String(open)); return; }
    if (action === "switch-role") { viewRole = element.dataset.role; setGuideTab(""); return render(); }
    if (action === "guide-tab") { setGuideTab(element.dataset.role); return render(); }
    if (action === "guide-toggle") { toggleGuide(); return render(); }
    if (action === "order-filter") { setOrderFilter(element.dataset.value); return render(); }
    if (action === "document-filter") { setDocumentFilter(element.dataset.value); return render(); }
    if (action === "doc-tab") {
      setDocumentTab(element.dataset.tab);
      element.parentElement.querySelectorAll("[data-tab]").forEach((tab) => { tab.classList.toggle("active", tab === element); tab.setAttribute("aria-selected", String(tab === element)); });
      document.querySelectorAll("[data-tab-panel]").forEach((item) => { item.hidden = item.dataset.tabPanel !== element.dataset.tab; });
      return;
    }
    if (action === "picker-move") {
      const item = element.closest("li");
      const sibling = element.dataset.dir === "-1" ? item.previousElementSibling : item.nextElementSibling;
      if (sibling) element.dataset.dir === "-1" ? sibling.before(item) : sibling.after(item);
      return refreshPicker(item.parentElement);
    }
    if (action === "open-chat") return await chat.open(element.dataset.peer, element.dataset.order || "");
    if (action === "avatar-remove") { const user = await apiRequest("/auth/avatar", { method: "POST", body: { data_url: null } }); updateCurrentUser({ ...getCurrentUser(), ...user }); render(); return notify("头像已移除"); }
    if (action === "refresh") return await load();
    if (action === "page") return navigate(route.page, route.id, { offset: element.dataset.offset });
    if (action === "new-request") return requestModal();
    if (action === "accept-quote") { const order = await mutate(`/quotes/${element.dataset.id}/accept`); navigate("order", order.id); return; }
    if (action === "pay") { await mutate(`/orders/${route.id}/payments`, {}); notify(state.capabilities.payment_simulation_enabled ? "模拟支付单已创建，请点击模拟支付完成订单" : "支付单已创建，请等待渠道响应后完成支付"); return await load(); }
    if (action === "simulate-payment") { await mutate(`/orders/${route.id}/payments/${element.dataset.id}/simulate-success`, {}); notify("模拟支付成功，订单已进入服务流程"); return await load(); }
    if (action === "new-document") {
      const orders = route.page === "order" && state.detail ? [state.detail].filter((item) => item.payment_status === "paid") : state.orders.filter((item) => item.payment_status === "paid");
      return modal("新建文书", newDocumentBody(orders, element.dataset.order || ""));
    }
    if (action === "workflow-modal") return modal("发起顺序会签", workflowModalBody(state.detail));
    if (action === "confirm-document") { await mutate(`/documents/${route.id}/workflow/confirm`, { version: state.detail.locked_version, reason: "" }); notify("已确认当前版本"); return await load(); }
    if (action === "return-document" || action === "return-delivery" || action === "freeze-lawyer") return modal("填写处理原因", `<form data-form="${action}" data-id="${esc(element.dataset.id || "")}">${field("原因", "reason", "", { textarea: true, required: true, placeholder: "请具体说明，便于对方处理" })}${formButton("确认提交")}</form>`);
    if (action === "revoke-member") { await mutate(`/documents/${route.id}/access/${element.dataset.id}/revoke`); return await load(); }
    if (action === "export-version") { const entry = await apiRequest(`/documents/${route.id}/versions/${element.dataset.version}`); return download(`${state.detail.title}-v${entry.number}.txt`, entry.body); }
    if (action === "download-file") return await downloadFile(element.dataset.id, element.dataset.name);
    if (action === "download-request-file") return await downloadFile(element.dataset.id, element.dataset.name, `/requests/${encodeURIComponent(element.dataset.requestId)}/files/${encodeURIComponent(element.dataset.id)}`);
    if (action === "review-file") return await downloadFile(element.dataset.id, `审核材料-${element.dataset.id}`, `/admin/lawyer-applications/${element.dataset.application}/files/${element.dataset.id}`);
    if (action === "delivery-modal") return modal("提交交付物", state.documents.length ? `<form data-form="delivery"><p class="muted">选择本订单中已完成的文书作为交付物，当事人确认收悉后订单完成。</p><label class="field"><span>交付文书</span><select name="document_id" required>${state.documents.map((item) => `<option value="${esc(item.id)}">${esc(item.title)} · v${item.current_version} · ${esc(labels[item.status] || item.status)}</option>`).join("")}</select></label>${formButton("提交交付")}</form>` : `<div class="info-callout warn">本订单还没有文书，请先新建交付文书。</div><div class="modal-actions">${button("new-document", "新建文书", `data-order="${esc(route.id)}"`, true)}</div>`);
    if (action === "accept-delivery") { await mutate(`/orders/${route.id}/receipt?accepted=true`); notify("已确认收悉，订单完成"); return await load(); }
    if (action === "after-sales-modal") return modal("申请售后", `<form data-form="after-sales"><div class="info-callout">${icon("info")}<span>提交后订单进入售后处理，结算暂停，由平台运营审核处理。</span></div>${field("类型", "case_type", "refund", { options: ["refund", "dispute"] })}${field("申请金额（元）", "amount", state.detail.paid, { type: "number", min: 0, required: true })}${field("原因", "reason", "", { textarea: true, required: true })}${formButton("提交申请")}</form>`);
    if (action === "read-notification") { await mutate(`/notifications/${element.dataset.id}/read`); return await load(); }
    if (action === "withdraw-application") { await mutate(`/lawyers/me/application/${element.dataset.id}/withdraw`); return await load(); }
  } catch (error) { notify(`${error.message}${error.requestId ? `（请求：${error.requestId}）` : ""}`); }
  finally { element.disabled = false; }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  if (form.dataset.busy || !form.reportValidity()) return;
  form.dataset.busy = "true";
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  const values = formData(form);
  const kind = form.dataset.form;
  const errorTarget = form.querySelector(".form-error");
  if (errorTarget) errorTarget.textContent = "";
  let target;
  try {
    if (["login", "register"].includes(kind)) {
      if (kind === "register") {
        const challengeId = String(values.challenge_id || "").trim();
        const challengeAnswer = String(values.challenge_answer || "").trim();
        if (!challengeId || !challengeAnswer || registrationChallenge?.id !== challengeId) {
          if (errorTarget) errorTarget.textContent = "安全问答题目尚未准备好，请点击换一道题后再提交";
          await loadRegistrationChallenge();
          return;
        }
        values.email = String(values.email || "").trim().toLowerCase();
        values.name = String(values.name || "").trim();
        values.challenge_id = challengeId;
        values.challenge_answer = challengeAnswer;
      }
      const session = await apiRequest(`/auth/${kind}`, { method: "POST", body: values });
      if (draftOwner && draftOwner !== session.user.id) { formDrafts.clear(); modelConsultation.clear(); }
      draftOwner = session.user.id;
      setSession(session);
      state = freshState();
      chat.start();
      return await load();
    }
    if (kind === "password") {
      await mutate("/auth/password", values);
      resetSession();
      render(); notify("密码已修改，所有旧会话已失效，请重新登录"); return;
    }
    if (kind === "consent-summary") {
      const summary = await mutate(`/consultations/${form.dataset.id}/summary`, { consent: form.elements.consent.checked, scope: "咨询转服务需求" });
      return requestModal(summary);
    }
    if (kind === "request") {
      const owner = getCurrentUser()?.id;
      values.consent = form.elements.consent.checked;
      values.attachment_file_ids = await uploadRequestAttachments(form, uploadFile);
      if (!owner || owner !== getCurrentUser()?.id) throw new Error("账户已变更，请重新登录后发布需求");
      const item = await mutate("/requests", values);
      target = ["requests", item.id];
    }
    if (kind === "quote") { values.days = Number(values.days); await mutate(`/requests/${route.id}/quotes`, values); }
    if (kind === "document") { const item = await mutate("/documents", { ...values, doc_type: "legal_document", members: [] }); target = ["doc", item.id]; }
    if (kind === "version") { values.base_version = Number(values.base_version); await mutate(`/documents/${route.id}/versions`, values); }
    if (kind === "workflow") {
      const assignees = [...form.querySelectorAll("[data-member]:checked")].map((input) => input.value);
      if (!assignees.length) throw new Error("请至少选择一位会签成员");
      await mutate(`/documents/${route.id}/workflow`, { assignee_ids: assignees });
    }
    if (kind === "return-document") await mutate(`/documents/${route.id}/workflow/return`, { version: state.detail.locked_version, reason: values.reason });
    if (kind === "comment") await mutate(`/documents/${route.id}/comments`, { version: state.detail.current_version, text: values.text });
    if (kind === "document-file") await uploadFile(form.elements.file.files[0], route.id);
    if (kind === "delivery") await mutate(`/orders/${route.id}/deliveries`, { document_id: values.document_id });
    if (kind === "return-delivery") await mutate(`/orders/${route.id}/receipt?accepted=false&reason=${encodeURIComponent(values.reason)}`);
    if (kind === "after-sales") await mutate(`/orders/${route.id}/after-sales`, values);
    if (kind === "resolve-case") await mutate(`/admin/cases/${form.dataset.id}/resolve`, values);
    if (kind === "lawyer-application") {
      const uploaded = [];
      for (const file of form.elements.credentials.files) uploaded.push((await uploadFile(file)).id);
      delete values.credentials;
      await mutate("/lawyers/me/application", { ...values, credential_file_ids: uploaded });
    }
    if (kind === "review-lawyer") await mutate(`/admin/lawyer-applications/${form.dataset.id}/review`, { decision: values.decision, reason: values.reason, expected_version: Number(values.expected_version) });
    if (kind === "freeze-lawyer") await mutate(`/admin/lawyers/${form.dataset.id}/freeze`, { reason: values.reason });
    formDrafts.delete(sourceKey(form));
    closeModal();
    if (target) navigate(...target);
    else await load();
    notify("操作已由服务器确认并保存");
  } catch (error) {
    if (kind === "register" && error.code === "invalid_registration_challenge") {
      if (errorTarget?.isConnected) errorTarget.textContent = `${error.message}，已刷新题目，请重新作答`;
      await loadRegistrationChallenge();
      return;
    }
    const message = `${error.message}${error.requestId ? `（请求：${error.requestId}）` : ""}`;
    if (errorTarget?.isConnected) errorTarget.textContent = message;
    else notify(message);
  } finally {
    delete form.dataset.busy;
    submit.disabled = false;
  }
});

window.addEventListener("hashchange", () => { closeModal(); load(); });
window.addEventListener("auth-expired", () => { ++loadVersion; chat.stop(); closeModal(); state = freshState(); render(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });
load();
