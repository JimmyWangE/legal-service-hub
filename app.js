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
import { renderLawyerCards, renderLawyerDirectory, renderRequestCards, renderRequestDetail, renderRequestList, requestFormBody, setRequestFilter } from "./requests-view.js";
import { renderAuditPage, renderCasesPage, renderNotifications, renderPaymentOps, renderReviewPage, setAdminFilter } from "./admin-view.js";
import { acceptQuoteBody, inviteFormBody, lawyerProfileForm, purchaseFormBody, renderHelp, renderLawyerProfile, renderMyQuotes, renderMyServices, renderServiceCatalog, reopenFormBody, reviewFormBody, serviceFormBody, setServiceFilter } from "./market-view.js";
import { avatar, button, esc, field, formData, icon, money, status } from "./ui.js";

const app = document.querySelector("#app");
let state = freshState();
let route = parseRoute();
let viewRole = readViewRole();
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

// 视图偏好：律师默认进入律师工作台；手动切换后在本标签页内记住
function readViewRole() { try { return sessionStorage.getItem("legal-view-role") || ""; } catch { return ""; } }
function saveViewRole(role) { viewRole = role; try { sessionStorage.setItem("legal-view-role", role); } catch { /* 存储不可用时仅本次有效 */ } }
function preferredRole(roles) { return roles.includes(viewRole) ? viewRole : ["lawyer", "client", "operator"].find((role) => roles.includes(role)) || roles[0] || "client"; }

function freshState() {
  return { capabilities: {}, consultations: [], requests: [], lawyers: [], services: [], quotes: [], orders: [], documents: [], notifications: [], applications: [], cases: [], audit: [], metrics: null, settlements: {}, detail: null, loading: false, error: "" };
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
    ["服务", [["requests", lawyerView ? "需求线索" : "服务需求", "request"], ...(lawyerView ? [["my-services", "我的服务套餐", "briefcase"]] : [["services", "服务套餐", "briefcase"], ["lawyers", "找律师", "lawyer"]]), ["orders", "服务订单", "order"], ["docs", "文书中心", "doc"]]],
    ["我的", [["notifications", "服务通知", "bell", "notifications"], ["account", "账号设置", "account"], ...(ownsRole("operator") ? [] : [["lawyer-onboarding", ownsRole("lawyer") ? "律师资料" : "律师入驻", "review"]]), ["help", "帮助与保障", "shield"]]],
  ];
  if (ownsRole("operator")) groups.push(["运营管理", [["reviewLawyers", "律师审核", "review"], ["cases", "售后处理", "order"], ["paymentOps", "支付运维", "finance"], ["audit", "审计日志", "audit"]]]);
  return groups;
}

function render() {
  route = parseRoute();
  if (!getCurrentUser()) return renderAuthentication();
  const user = getCurrentUser();
  if (!user.roles.includes(viewRole)) viewRole = preferredRole(user.roles);
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
  const lawyerView = viewRole === "lawyer";
  if (route.page === "model-chat" || route.page === "chat") return modelConsultation.render(route);
  if (route.page === "messages") return chat.render(route);
  if (route.page === "requests" || route.page === "lawyer") {
    if (route.id) return `${renderRequestDetail({ item: state.detail, user, lawyerCanQuote: lawyerView && user.lawyer_profile?.can_quote, capabilities: state.capabilities })}${state.detail ? renderRequestAttachments(state.detail) : ""}`;
    if (lawyerView) {
      const tab = route.query.get("tab") === "quotes" ? "quotes" : "leads";
      const tabs = `<div class="pill-tabs page-tabs" role="tablist"><a role="tab" href="#/requests" class="${tab === "leads" ? "active" : ""}" aria-selected="${tab === "leads"}">可报价线索</a><a role="tab" href="#/requests?tab=quotes" class="${tab === "quotes" ? "active" : ""}" aria-selected="${tab === "quotes"}">我的报价</a></div>`;
      const notice = user.lawyer_profile?.can_quote ? "" : `<div class="info-callout warn">${icon("info")}<span>${user.lawyer_profile?.status === "approved" ? "你已暂停接单，开启“接受新委托”后才能报价。" : "资质审核通过且有效后才能报价。"} <a class="link" href="#/lawyer-onboarding">前往律师资料</a></span></div>`;
      return `${heading("需求线索", "浏览当事人公开的需求（联系方式已脱敏），提交服务方案与报价。")}${notice}${tabs}${tab === "quotes" ? renderMyQuotes({ quotes: state.quotes }) : renderRequestList({ requests: state.requests, user, lawyerView })}`;
    }
    return `${heading("服务需求", "情况复杂或不确定需要什么服务时，发布需求让多位认证律师给出方案和报价，比较后再选择。", ownsRole("client") ? button("new-request", `${icon("plus")} 发布新需求`, "", true) : "")}${renderRequestList({ requests: state.requests, user, lawyerView })}`;
  }
  if (route.page === "lawyers") {
    if (route.id) return renderLawyerProfile({ lawyer: state.detail, user, myRequests: state.requests });
    return `${heading("找律师", "仅展示资质有效、审核通过的律师。查看主页了解律师背景、服务套餐与评价，可在线咨询或邀请为你的需求报价。")}${renderLawyerDirectory({ lawyers: state.lawyers, user, canContact: ownsRole("client") })}`;
  }
  if (route.page === "services") return `${heading("服务套餐", "律师明码标价的标准化法律服务，需求明确时可直接委托，无需等待报价。")}${renderServiceCatalog({ services: state.services, user })}`;
  if (route.page === "my-services") return `${heading("我的服务套餐", "上架标准化服务，当事人可直接下单委托。", user.lawyer_profile?.status === "approved" ? button("new-service", `${icon("plus")} 上架服务`, "", true) : "")}${renderMyServices({ services: state.services, profile: user.lawyer_profile, capabilities: state.capabilities })}`;
  if (["orders", "lawyerOrders", "adminOrders"].includes(route.page)) return `${heading("服务订单", "跟踪每笔订单的合同确认、支付、履约、验收与售后进度。金额与支付状态以服务端记录为准。")}${renderOrderList({ orders: state.orders, user, badge })}`;
  if (route.page === "order") return renderOrderDetail({ item: state.detail, user, capabilities: state.capabilities, documents: state.documents, badge, labels });
  if (["docs", "workspace"].includes(route.page)) return `${heading("文书中心", "集中管理订单文书：版本留痕、批注讨论、顺序会签与受控下载。", !ownsRole("operator") ? button("new-document", `${icon("plus")} 新建文书`, "", true) : "")}${renderDocumentList({ documents: state.documents, user, badge })}`;
  if (route.page === "doc") return renderDocumentDetail({ item: state.detail, user, badge, operator: ownsRole("operator") });
  if (route.page === "account") return `${heading("账号设置", "管理头像、个人资料与登录安全。")}${renderAccount({ user, roleNames })}`;
  if (route.page === "lawyer-onboarding") {
    const profile = user.lawyer_profile;
    return `${heading(ownsRole("lawyer") ? "律师资料" : "律师入驻", ownsRole("lawyer") ? "维护律师主页展示资料与接单状态，查看资质申请记录。" : "提交执业资质，审核通过后开通律师视图与接单能力。")}${profile && ["approved", "frozen"].includes(profile.status) ? lawyerProfileForm({ ...profile, user_id: user.id }) : ""}${renderLawyerOnboarding({ applications: state.applications, badge, operator: ownsRole("operator"), profile })}`;
  }
  if (route.page === "help") return `${heading("帮助与保障", "了解平台的服务流程、收费规则、售后与隐私保护。")}${renderHelp(state.capabilities)}`;
  if (route.page === "reviewLawyers") return `${heading("律师入驻审核", "核验执业资质与材料；通过后开通律师身份与接单能力，可随时冻结或恢复接单权限。")}${renderReviewPage({ applications: state.applications })}`;
  if (route.page === "cases") return `${heading("售后与争议", "处理退款申请与履约争议，结果同时通知当事人与律师。")}${renderCasesPage({ cases: state.cases })}`;
  if (route.page === "paymentOps") return `${heading("支付与结算运维", "监测支付通知、退款与订单结算；签约前收款保持关闭。")}${renderPaymentOps({ capabilities: state.capabilities, detail: state.detail || {}, settlements: state.settlements })}`;
  if (route.page === "audit") return `${heading("审计日志", "业务变更与审计共同提交；不包含模型凭证。")}${renderAuditPage({ audit: state.audit })}`;
  if (route.page === "notifications") return `${heading("服务通知", "订单、报价、文书与审核相关的系统通知。")}${renderNotifications({ notifications: state.notifications })}`;
  return renderWorkbench({ state, user, viewRole, roleName: roleNames[viewRole] || viewRole, unreadChats: badges.chat });
}

function requestModal(summary = null) {
  modal("发布服务需求", requestFormBody({ draft: summary?.summary?.request_draft ? { ...summary.summary.request_draft, facts: summary.summary.request_draft.facts || summary.summary.questions?.join("\n\n") || "" } : {}, summary }));
}

function pagination() {
  if (route.id) return "";
  const resources = { requests: "requests", lawyer: "requests", orders: "orders", lawyerOrders: "orders", adminOrders: "orders", docs: "documents", workspace: "documents", notifications: "notifications", reviewLawyers: "applications", audit: "audit" };
  const resource = route.query.get("tab") === "quotes" ? "" : resources[route.page];
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
    const roleView = preferredRole(user.roles);
    const quoteTab = currentRoute.query.get("tab") === "quotes" && roleView === "lawyer";
    if (["home", "requests", "lawyer"].includes(pageName) && !currentRoute.id && !quoteTab) next.requests = await apiRequest(`/requests?${paging}`);
    if (quoteTab) next.quotes = await apiRequest("/quotes/mine");
    if (pageName === "home" && roleView === "operator") next.metrics = await apiRequest("/admin/metrics");
    if (["home", "orders", "lawyerOrders", "adminOrders", "docs", "workspace"].includes(pageName)) next.orders = await apiRequest(`/orders?${paging}`);
    if (["home", "docs", "workspace"].includes(pageName)) next.documents = await apiRequest(`/documents?${paging}`);
    if (pageName === "lawyers" && !currentRoute.id) next.lawyers = await apiRequest("/lawyers");
    if (pageName === "lawyers" && currentRoute.id) {
      next.detail = await apiRequest(`/lawyers/${encodeURIComponent(currentRoute.id)}`);
      next.requests = user.roles.includes("client") ? (await apiRequest("/requests?status=quoting&limit=100")).filter((item) => item.owner_id === user.id) : [];
    }
    if (pageName === "services") next.services = await apiRequest("/services");
    if (pageName === "my-services") next.services = user.lawyer_profile ? await apiRequest("/lawyers/me/services") : [];
    if (["requests", "lawyer"].includes(pageName) && currentRoute.id) next.detail = { ...await apiRequest(`/requests/${currentRoute.id}`), quotes: await apiRequest(`/requests/${currentRoute.id}/quotes`) };
    if (pageName === "order") {
      next.detail = { ...await apiRequest(`/orders/${currentRoute.id}`), payments: await apiRequest(`/orders/${currentRoute.id}/payments`), deliveries: await apiRequest(`/orders/${currentRoute.id}/deliveries`), cases: await apiRequest(`/orders/${currentRoute.id}/after-sales`), reviews: await apiRequest(`/orders/${currentRoute.id}/reviews`) };
      next.documents = await apiRequest(`/documents?order_id=${encodeURIComponent(currentRoute.id)}&limit=100`);
    }
    if (pageName === "doc") next.detail = await apiRequest(`/documents/${currentRoute.id}`);
    if (pageName === "lawyer-onboarding") next.applications = await apiRequest("/lawyers/me/application");
    if (pageName === "reviewLawyers") next.applications = await apiRequest(`/admin/lawyer-applications?limit=100&offset=${offset}`);
    if (pageName === "cases") next.cases = await apiRequest("/admin/cases");
    if (pageName === "audit") next.audit = await apiRequest(`/admin/audit?${paging}`);
    if (pageName === "paymentOps") { next.detail = await apiRequest("/admin/payment-status"); next.settlements = await apiRequest("/admin/settlements"); }
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
// 业务校验错误直接展示原因；只有服务端异常才附带请求编号，便于用户向客服反馈
function errorText(error) { return `${error.message}${error.requestId && (!error.status || error.status >= 500) ? `（请求编号：${error.requestId}）` : ""}`; }
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
  saveViewRole("");
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
    if (search.dataset.search === "requests") { setRequestFilter("query", search.value); document.querySelector("#request-cards").innerHTML = renderRequestCards({ requests: state.requests, user: getCurrentUser(), lawyerView: viewRole === "lawyer" }); }
    if (search.dataset.search === "lawyers") { setRequestFilter("lawyerQuery", search.value); document.querySelector("#lawyer-cards").innerHTML = renderLawyerCards({ lawyers: state.lawyers, user: getCurrentUser(), canContact: ownsRole("client") }); }
    if (search.dataset.search === "services") { setServiceFilter("serviceQuery", search.value); repaintServices(); }
    if (search.dataset.search === "audit") { setAdminFilter("auditAction", search.value); const cursor = search.selectionStart; render(); const input = document.querySelector('[data-search="audit"]'); input?.focus(); input?.setSelectionRange(cursor, cursor); }
    return;
  }
  const form = event.target.closest("form[data-form]");
  if (form && !["login", "register"].includes(form.dataset.form)) {
    const values = Object.fromEntries(new FormData(form));
    for (const [name, value] of Object.entries(values)) if (value instanceof File || form.elements.namedItem(name)?.type === "password") delete values[name];
    formDrafts.set(sourceKey(form), values);
  }
});

function repaintServices() {
  const html = renderServiceCatalog({ services: state.services, user: getCurrentUser() });
  const holder = document.createElement("div");
  holder.innerHTML = html;
  document.querySelector("#service-cards")?.replaceWith(holder.querySelector("#service-cards"));
}

document.addEventListener("change", async (event) => {
  const target = event.target;
  if (target.matches("[data-request-filter]")) {
    setRequestFilter(target.dataset.requestFilter, target.value);
    if (target.dataset.requestFilter.startsWith("lawyer")) document.querySelector("#lawyer-cards").innerHTML = renderLawyerCards({ lawyers: state.lawyers, user: getCurrentUser(), canContact: ownsRole("client") });
    else document.querySelector("#request-cards").innerHTML = renderRequestCards({ requests: state.requests, user: getCurrentUser(), lawyerView: viewRole === "lawyer" });
    return;
  }
  if (target.matches("[data-service-filter]")) { setServiceFilter(target.dataset.serviceFilter, target.value); return repaintServices(); }
  if (target.matches("[data-admin-filter]")) { setAdminFilter(target.dataset.adminFilter, target.value); return render(); }
  if (target.matches('[name="specialties"]')) {
    const checked = target.form.querySelectorAll('[name="specialties"]:checked');
    if (checked.length > 5) { target.checked = false; notify("其他擅长领域最多选择 5 个"); }
  }
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
  const readLink = event.target.closest("a[data-read]");
  if (readLink?.dataset.read) void mutate(`/notifications/${readLink.dataset.read}/read`).then(refreshNotificationBadge).catch(() => {});
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
    if (action === "switch-role") { saveViewRole(element.dataset.role); setGuideTab(""); return route.page === "home" ? load() : navigate("home"); }
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
    if (action === "accept-quote") return modal("确认选择该律师", acceptQuoteBody((state.detail?.quotes || []).find((quote) => quote.id === element.dataset.id) || {}, state.capabilities));
    if (action === "confirm-accept-quote") { const order = await mutate(`/quotes/${element.dataset.id}/accept`); closeModal(); notify("已生成订单，请确认服务合同"); navigate("order", order.id); return; }
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
    if (action === "delivery-modal") {
      const deliverable = state.documents.filter((item) => item.doc_type !== "service_contract" && !["signing", "archived"].includes(item.status));
      return modal("提交交付物", deliverable.length ? `<form data-form="delivery"><p class="muted">选择本订单中已完成的文书作为交付物，当事人验收后订单完成；当事人 ${state.capabilities.delivery_auto_accept_days || 7} 天内未处理将自动确认验收。</p><label class="field"><span>交付文书</span><select name="document_id" required>${deliverable.map((item) => `<option value="${esc(item.id)}">${esc(item.title)} · v${item.current_version} · ${esc(labels[item.status] || item.status)}</option>`).join("")}</select></label>${field("交付说明（选填）", "note", "", { textarea: true, rows: 2, placeholder: "说明交付内容、使用建议或后续注意事项" })}${formButton("提交交付")}</form>` : `<div class="info-callout warn">${icon("info")}<span>本订单还没有可交付的文书（服务合同和会签中的文书不能作为交付物），请先新建交付文书。</span></div><div class="modal-actions">${button("new-document", "新建文书", `data-order="${esc(route.id)}"`, true)}</div>`);
    }
    if (action === "accept-delivery") { await mutate(`/orders/${route.id}/receipt?accepted=true`); notify("已确认收悉，订单完成"); return await load(); }
    if (action === "after-sales-modal") {
      const client = state.detail.client_id === getCurrentUser().id;
      return modal("申请售后", `<form data-form="after-sales"><div class="info-callout">${icon("info")}<span>提交后订单进入售后处理，结算暂停，由平台运营核实后处理，结果会通知双方。</span></div>${client ? field("类型", "case_type", "refund", { options: [["refund", "申请退款"], ["dispute", "履约争议（请平台介入协调）"]] }) : '<input type="hidden" name="case_type" value="dispute">'}${client ? field("申请退款金额（元）", "amount", state.detail.paid, { type: "number", min: 0, max: state.detail.paid, step: "0.01", required: true, hint: `订单已付 ${money(state.detail.paid)}；选择“履约争议”时可填 0` }) : '<input type="hidden" name="amount" value="0">'}${field("原因", "reason", "", { textarea: true, required: true, placeholder: "请具体说明问题与期望的处理方式，可附上沟通记录要点" })}${formButton("提交申请")}</form>`);
    }
    if (action === "read-notification") { await mutate(`/notifications/${element.dataset.id}/read`); return await load(); }
    if (action === "withdraw-application") { await mutate(`/lawyers/me/application/${element.dataset.id}/withdraw`); return await load(); }
    // ---- 订单 ----
    if (action === "confirm-contract") { const order = await mutate(`/orders/${route.id}/confirm`); notify(order.status === "pending_payment" ? "双方已确认，服务合同生效" : "已确认服务合同，等待对方确认"); return await load(); }
    if (action === "cancel-order") return modal("取消订单", `<form data-form="cancel-order"><p class="muted">付款前双方均可取消订单，取消后${state.detail?.request_id ? "需求将重新开放报价（定向委托的需求将关闭）" : "订单关闭"}。</p>${field("取消原因", "reason", "", { textarea: true, rows: 2, required: true, placeholder: "将告知对方" })}${formButton("确认取消订单")}</form>`);
    if (action === "view-contract") {
      if (!state.detail?.contract_id) return notify("未找到服务合同");
      const contract = await apiRequest(`/documents/${state.detail.contract_id}`);
      const body = contract.versions.find((entry) => entry.number === contract.current_version)?.body || "";
      return modal(contract.title, `<pre class="contract-body">${esc(body)}</pre><div class="modal-actions"><a class="btn" href="#/doc/${esc(contract.id)}">在文书中心打开</a><button class="btn primary" type="button" data-action="close-modal">关闭</button></div>`);
    }
    if (action === "review-modal") return modal(state.detail.client_id === getCurrentUser().id ? "评价律师" : "评价当事人", reviewFormBody(state.detail.client_id === getCurrentUser().id));
    if (action === "export-evidence") { const pack = await apiRequest(`/orders/${route.id}/evidence`); download(`存证包-${pack.order.title}-${pack.package_sha256.slice(0, 8)}.json`, JSON.stringify(pack, null, 2), "application/json;charset=utf-8"); return notify("存证包已导出，文件指纹已记录审计"); }
    if (action === "copy-id") { try { await navigator.clipboard.writeText(element.dataset.value); notify("订单号已复制"); } catch { notify(`订单号：${element.dataset.value}`); } return; }
    // ---- 文书 ----
    if (action === "restore-version") { await mutate(`/documents/${route.id}/versions/${element.dataset.version}/restore`); notify(`已将 v${element.dataset.version} 恢复为新版本`); return await load(); }
    if (action === "resolve-comment") { await mutate(`/documents/${route.id}/comments/${element.dataset.id}/resolve`); return await load(); }
    if (action === "withdraw-workflow") { await mutate(`/documents/${route.id}/workflow/withdraw`); notify("会签已撤回，文书可继续修改"); return await load(); }
    // ---- 需求与报价 ----
    if (action === "request-filter") { setRequestFilter("status", element.dataset.value); return render(); }
    if (action === "edit-request") return modal("编辑需求", requestFormBody({ edit: state.detail }));
    if (action === "close-request") return modal("关闭需求", `<form data-form="close-request"><p class="muted">关闭后律师无法继续报价，已有的有效报价将失效。之后可重新开放报价。</p>${field("关闭原因（选填）", "reason", "", { placeholder: "例如：问题已解决" })}${formButton("确认关闭")}</form>`);
    if (action === "reopen-request") return modal("重新开放报价", reopenFormBody());
    if (action === "withdraw-quote") { await mutate(`/quotes/${element.dataset.id}/withdraw`); notify("报价已撤回"); return await load(); }
    if (action === "invite-lawyer") return modal("邀请律师报价", inviteFormBody(element.dataset.id, state.requests.filter((item) => item.owner_id === getCurrentUser().id)));
    // ---- 服务套餐 ----
    if (action === "purchase-service") {
      const service = state.services.find((item) => item.id === element.dataset.id) || (state.detail?.services || []).map((item) => ({ ...item, lawyer: { name: state.detail.name } })).find((item) => item.id === element.dataset.id);
      return modal("委托服务", purchaseFormBody(service, state.capabilities));
    }
    if (action === "new-service") return modal("上架服务", serviceFormBody(null, state.capabilities));
    if (action === "edit-service") return modal("编辑服务", serviceFormBody(state.services.find((item) => item.id === element.dataset.id), state.capabilities));
    if (action === "toggle-service") {
      const item = state.services.find((entry) => entry.id === element.dataset.id);
      await apiRequest(`/lawyers/me/services/${item.id}`, { method: "PUT", body: { title: item.title, service_type: item.service_type, field: item.field, description: item.description, deliverables: item.deliverables, price: item.price, days: item.days, active: !item.active } });
      notify(item.active ? "服务已下架" : "服务已重新上架");
      return await load();
    }
    // ---- 运营 ----
    if (action === "admin-filter") { setAdminFilter(element.dataset.name, element.dataset.value); return render(); }
    if (action === "unfreeze-lawyer") return modal("恢复接单权限", `<form data-form="unfreeze-lawyer" data-id="${esc(element.dataset.id)}">${field("恢复原因", "reason", "", { textarea: true, required: true, placeholder: "将通知律师" })}${formButton("确认恢复")}</form>`);
    if (action === "run-maintenance") { const result = await mutate("/admin/maintenance/run"); notify(`已执行：过期需求 ${result.expired_requests}、自动验收 ${result.auto_accepted}、逾期提醒 ${result.overdue_reminded}、结算 ${result.settled}`); return await load(); }
    if (action === "read-all-notifications") { await mutate("/notifications/read-all"); notify("已全部标为已读"); return await load(); }
  } catch (error) { notify(errorText(error)); }
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
      if (kind === "register" && values.registration_intent === "lawyer") { notify("注册成功，请提交执业资质完成律师入驻"); if (route.page !== "lawyer-onboarding") return navigate("lawyer-onboarding"); }
      return await load();
    }
    if (kind === "profile") {
      const user = await apiRequest("/auth/me", { method: "PATCH", body: { name: values.name } });
      updateCurrentUser({ ...getCurrentUser(), ...user });
      formDrafts.delete(sourceKey(form));
      render();
      return notify("个人资料已更新");
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
    if (kind === "edit-request") { const { expected_version: version, ...rest } = values; await apiRequest(`/requests/${route.id}`, { method: "PUT", body: { ...rest, expected_version: Number(version) } }); }
    if (kind === "close-request") await mutate(`/requests/${route.id}/close`, { reason: values.reason || "" });
    if (kind === "reopen-request") await mutate(`/requests/${route.id}/reopen`, { deadline: values.deadline });
    if (kind === "invite-lawyer") { await mutate(`/requests/${values.request_id}/invitations`, { lawyer_id: form.dataset.id }); closeModal(); return notify("邀请已发送，律师报价后会通知你"); }
    if (kind === "cancel-order") await mutate(`/orders/${route.id}/cancel`, { reason: values.reason });
    if (kind === "review") await mutate(`/orders/${route.id}/reviews`, { rating: Number(values.rating), content: values.content || "" });
    if (kind === "purchase-service") {
      const owner = getCurrentUser()?.id;
      const attachment_file_ids = await uploadRequestAttachments(form, uploadFile);
      if (!owner || owner !== getCurrentUser()?.id) throw new Error("账户已变更，请重新登录后委托");
      const order = await mutate(`/services/${form.dataset.id}/purchase`, { facts: values.facts, region: values.region, attachment_file_ids });
      target = ["order", order.id];
    }
    if (kind === "service") {
      const body = { title: values.title, service_type: values.service_type, field: values.field, description: values.description, deliverables: values.deliverables, price: values.price, days: Number(values.days), active: form.elements.active.checked };
      if (form.dataset.id) await apiRequest(`/lawyers/me/services/${form.dataset.id}`, { method: "PUT", body });
      else await mutate("/lawyers/me/services", body);
    }
    if (kind === "lawyer-profile") {
      await apiRequest("/lawyers/me/profile", { method: "PUT", body: { bio: values.bio || "", practice_years: Number(values.practice_years || 0), mode: values.mode, specialties: [...form.querySelectorAll('[name="specialties"]:checked')].map((input) => input.value), available: Boolean(form.elements.available.checked) } });
    }
    if (kind === "unfreeze-lawyer") await mutate(`/admin/lawyers/${form.dataset.id}/unfreeze`, { reason: values.reason });
    if (kind === "document") { const item = await mutate("/documents", { ...values, members: [] }); target = ["doc", item.id]; }
    if (kind === "version") { values.base_version = Number(values.base_version); await mutate(`/documents/${route.id}/versions`, values); }
    if (kind === "workflow") {
      const assignees = [...form.querySelectorAll("[data-member]:checked")].map((input) => input.value);
      if (!assignees.length) throw new Error("请至少选择一位会签成员");
      await mutate(`/documents/${route.id}/workflow`, { assignee_ids: assignees });
    }
    if (kind === "return-document") await mutate(`/documents/${route.id}/workflow/return`, { version: state.detail.locked_version, reason: values.reason });
    if (kind === "comment") await mutate(`/documents/${route.id}/comments`, { version: state.detail.current_version, text: values.text });
    if (kind === "document-file") await uploadFile(form.elements.file.files[0], route.id);
    if (kind === "delivery") await mutate(`/orders/${route.id}/deliveries`, { document_id: values.document_id, note: values.note || "" });
    if (kind === "return-delivery") await mutate(`/orders/${route.id}/receipt?accepted=false&reason=${encodeURIComponent(values.reason)}`);
    if (kind === "after-sales") await mutate(`/orders/${route.id}/after-sales`, { case_type: values.case_type, reason: values.reason, amount: values.case_type === "refund" ? values.amount || "0" : "0" });
    if (kind === "resolve-case") await mutate(`/admin/cases/${form.dataset.id}/resolve`, { decision: values.decision, resolution: values.resolution, amount: values.decision === "approve" && values.amount ? values.amount : null });
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
    notify("操作成功，已保存");
  } catch (error) {
    if (kind === "register" && error.code === "invalid_registration_challenge") {
      if (errorTarget?.isConnected) errorTarget.textContent = `${error.message}，已刷新题目，请重新作答`;
      await loadRegistrationChallenge();
      return;
    }
    const message = errorText(error);
    if (errorTarget?.isConnected) errorTarget.textContent = message;
    else notify(message);
  } finally {
    delete form.dataset.busy;
    submit.disabled = false;
  }
});

// 每 10 分钟用仍有效的令牌续期一次；页面隐藏时跳过，令牌过期后由 auth-expired 处理
setInterval(async () => {
  if (!getCurrentUser() || document.hidden) return;
  try { const { access_token } = await apiRequest("/auth/refresh", { method: "POST" }); if (getCurrentUser()) setSession({ access_token, user: getCurrentUser() }); } catch { /* 续期失败时沿用现有令牌 */ }
}, 10 * 60 * 1000);

window.addEventListener("hashchange", () => { closeModal(); load(); });
window.addEventListener("auth-expired", () => { ++loadVersion; chat.stop(); closeModal(); state = freshState(); render(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });
load();
