import { apiRequest, downloadFile, mutate, streamMutate, uploadFile } from "./api-client.js";
import { clearSession, getCurrentUser, setSession, updateCurrentUser } from "./auth-state.js";
import { createModelConsultation } from "./model-consultation.js";
import { button, date, empty, esc, field, formData, icon, money, status } from "./ui.js";

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
const labels = { pending_payment: "待支付", service: "服务中", quoting: "待报价", ordered: "已下单", draft: "草稿", submitted: "已提交", under_review: "审核中", approved: "已通过", supplement: "需补件", rejected: "已拒绝", withdrawn: "已撤回", frozen: "已冻结", completed: "已完成", pending_receipt: "待收悉", pending_delivery: "待交付", refund_pending: "退款处理中", refund_processing: "退款处理中", disputed: "争议中", closed: "已关闭", confirmed: "已确认", signing: "会签中", returned: "已退回", pending: "待处理", success: "成功", created: "等待支付", creating: "支付渠道处理中", failed: "失败", paid: "已支付", unpaid: "未支付", refunded: "已退款", partially_refunded: "部分退款", valid: "有效", accepted: "已接受", expired: "已失效" };
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

function freshState() {
  return { capabilities: {}, consultations: [], requests: [], lawyers: [], orders: [], documents: [], notifications: [], applications: [], cases: [], audit: [], detail: null, loading: false, error: "" };
}

function parseRoute() {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const [page = "home", id = ""] = path.split("/").filter(Boolean);
  return { page, id, query: new URLSearchParams(query) };
}

function navigate(page, id = "", query = {}) {
  const search = new URLSearchParams(query).toString();
  location.hash = `#/${page}${id ? `/${encodeURIComponent(id)}` : ""}${search ? `?${search}` : ""}`;
}

function heading(title, description = "", actions = "") {
  return `<div class="page-heading"><div><small>法律服务平台 · 服务端数据</small><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="heading-actions">${actions}</div></div>`;
}

function badge(value) { return status(labels[value] || value || "—"); }
function ownsRole(role) { return getCurrentUser()?.roles?.includes(role); }
function detailList(values) { return `<dl class="data-list">${values.map(([title, value]) => `<div><dt>${esc(title)}</dt><dd>${esc(value ?? "—")}</dd></div>`).join("")}</dl>`; }
function rows(items, columns) { return items.length ? `<div class="table-wrap"><table><thead><tr>${columns.map(([title]) => `<th>${esc(title)}</th>`).join("")}</tr></thead><tbody>${items.map((item) => `<tr>${columns.map(([, value]) => `<td>${value(item)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : empty(); }
function formButton(text) { return `<p class="form-error" role="alert"></p><button class="btn primary" type="submit">${esc(text)}</button>`; }
function sourceKey(form) { return `${route.page}:${route.id}:${form.dataset.form}`; }

function render() {
  route = parseRoute();
  if (!getCurrentUser()) return renderAuthentication();
  const user = getCurrentUser();
  if (!user.roles.includes(viewRole)) viewRole = user.roles[0] || "client";
  const menus = [["home", "工作台", "home"], ["model-chat", "法律模型咨询", "spark"], ["requests", viewRole === "lawyer" ? "需求线索" : "服务需求", "request"], ["lawyers", "找律师", "lawyer"], ["orders", "服务订单", "order"], ["docs", "文书中心", "doc"], ["profile", "账户与律师入驻", "account"], ["notifications", "服务通知", "bell"]];
  if (ownsRole("operator")) menus.push(["reviewLawyers", "律师审核", "review"], ["cases", "售后处理", "order"], ["paymentOps", "支付运维", "finance"], ["audit", "审计日志", "audit"]);
  document.title = `${menus.find(([name]) => name === route.page)?.[1] || "法律服务平台"} · 法律服务平台`;
  app.innerHTML = `<div class="platform-shell"><aside class="platform-sidebar"><a class="platform-brand" href="#/home"><span class="brand-mark"><img src="./assets/legal-service-icon.jpg" alt="" /></span><div><b>法律服务平台</b><small>咨询 · 协作 · 履约</small></div></a><nav class="platform-nav">${menus.filter(([name]) => name !== "model-chat" || ownsRole("client")).map(([name, title, glyph]) => `<a href="#/${name}" class="${route.page === name ? "active" : ""}">${icon(glyph)}${esc(title)}</a>`).join("")}</nav></aside><main class="platform-main"><header class="platform-topbar"><b>专业服务，可靠协作</b><div class="remote-top-actions"><span>${esc(user.name)}</span><select id="view-role" aria-label="切换视图">${user.roles.map((role) => `<option value="${esc(role)}" ${role === viewRole ? "selected" : ""}>${esc(roleNames[role] || role)}视图</option>`).join("")}</select>${button("refresh", "刷新")}${button("logout", "退出")}</div></header><section class="page-body ${route.page === "model-chat" ? "model-page-body" : ""}">${state.loading ? '<section class="surface" aria-busy="true">正在从服务器读取…</section>' : state.error ? `<section class="surface" role="alert"><h2>暂时无法读取</h2><p>${esc(state.error)}</p>${button("refresh", "重试")}</section>` : page()}${!state.loading && !state.error ? pagination() : ""}</section></main></div><div id="toast" role="status" aria-live="polite"></div>`;
  app.querySelector("#view-role")?.addEventListener("change", (event) => { viewRole = event.target.value; render(); });
  restoreDrafts(app);
  if (["model-chat", "chat"].includes(route.page) && !state.loading && !state.error) modelConsultation.bind(app);
}

function renderAuthentication(register = false) {
  const kind = register ? "register" : "login";
  registrationChallenge = null;
  app.innerHTML = `<main class="remote-auth"><section class="surface"><a class="platform-brand" href="#/home"><span class="brand-mark"><img src="./assets/legal-service-icon.jpg" alt="" /></span><b>法律服务平台</b></a><h1>${register ? "创建账户" : "登录法律服务平台"}</h1><p class="muted">业务记录安全保存于服务器。登录凭证仅保存在当前页面内存，刷新后请重新登录。</p><form data-form="${kind}">${field("邮箱", "email", "", { type: "email", required: true })}${register ? field("姓名", "name", "", { required: true }) : ""}${field("密码（至少8位）", "password", "", { type: "password", required: true })}${register ? `${field("使用意向（不自动授予权限）", "registration_intent", "client", { options: ["client", "lawyer"] })}<label class="field"><span>安全问答 <b>*</b></span><strong id="registration-question">正在生成题目…</strong><input name="challenge_answer" type="text" inputmode="numeric" autocomplete="off" required placeholder="请输入答案"><input name="challenge_id" type="hidden"></label><button class="btn" type="button" data-action="registration-refresh">换一道题</button>` : ""}${formButton(register ? "注册" : "登录")}</form><p>${button(register ? "login-view" : "register-view", register ? "已有账户，去登录" : "创建账户 / 律师入驻")}</p><p class="muted">律师需经资质审核后开通服务能力；注册安全校验不依赖邮箱服务。</p><div id="auth-message" role="status"></div></section></main><div id="toast" role="status"></div>`;
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
  if (route.page === "model-chat" || route.page === "chat") return modelConsultation.render(route);
  if (route.page === "requests" || route.page === "lawyer") return route.id ? requestPage() : `${heading("服务需求", "真实需求由服务器验证权限并持久化。", ownsRole("client") ? button("new-request", "发布新需求", "", true) : "")}${requestRows()}`;
  if (route.page === "lawyers") return `${heading("认证律师", "仅展示资质有效且已核准的律师；完整证件和邮箱不公开。")}${rows(state.lawyers, [["姓名", (item) => esc(item.name)], ["律所", (item) => esc(item.firm)], ["地区 / 领域", (item) => `${esc(item.region)} · ${esc(item.field)}`], ["资质", (item) => badge(item.status)]])}`;
  if (["orders", "lawyerOrders", "adminOrders"].includes(route.page)) return `${heading("服务订单", "金额与支付状态以服务端及支付机构记录为准。")}${orderRows()}`;
  if (route.page === "order") return orderPage();
  if (["docs", "workspace"].includes(route.page)) return `${heading("文书中心", "版本、会签和授权由后端统一校验。", !ownsRole("operator") ? button("new-document", "新建文书", "", true) : "")}${documentRows()}`;
  if (route.page === "doc") return documentPage();
  if (route.page === "profile") return profilePage();
  if (route.page === "reviewLawyers") return reviewPage();
  if (route.page === "cases") return casesPage();
  if (route.page === "paymentOps") return paymentOpsPage();
  if (route.page === "audit") return `${heading("审计日志", "业务变更与审计共同提交；不包含模型凭证。")}${rows(state.audit, [["时间", (item) => date(item.created_at)], ["操作", (item) => esc(item.action)], ["对象", (item) => esc(`${item.object_type}:${item.object_id}`)], ["请求标识", (item) => esc(item.request_id)]])}`;
  if (route.page === "notifications") return `${heading("服务通知")}${rows(state.notifications, [["标题", (item) => esc(item.title)], ["内容", (item) => esc(item.body)], ["时间", (item) => date(item.created_at)], ["状态", (item) => item.read_at ? "已读" : button("read-notification", "标记已读", `data-id="${esc(item.id)}"`)]])}`;
  return `${heading("服务工作台", "从模型咨询开始，再按需连接律师、创建订单并协作文书。", '<a class="btn primary" href="#/model-chat">开始法律咨询</a>')}<div class="stat-grid">${[["咨询记录", state.consultations.length], ["服务需求", state.requests.length], ["服务订单", state.orders.length], ["可访问文书", state.documents.length]].map(([title, count]) => `<div class="stat-card"><span>${icon("doc")}</span><div><small>${title}</small><strong>${count}</strong><em>当前页记录</em></div></div>`).join("")}</div><section class="surface"><h2>最近咨询</h2>${state.consultations.length ? state.consultations.map((item) => `<p><a href="#/model-chat/${esc(item.id)}">${esc(item.title)}</a> · ${date(item.updated_at)}</p>`).join("") : empty("暂无咨询")}</section><section class="surface"><h2>最近订单</h2>${orderRows()}</section>`;
}

function requestRows() {
  return rows(state.requests, [["需求", (item) => `<a href="#/requests/${esc(item.id)}">${esc(item.title)}</a>`], ["地区 / 类型", (item) => `${esc(item.region)} · ${esc(item.service_type)}`], ["预算", (item) => money(item.budget)], ["截止", (item) => esc(item.deadline)], ["状态", (item) => badge(item.status)]]);
}

function orderRows() {
  return rows(state.orders, [["订单", (item) => `<a href="#/order/${esc(item.id)}">${esc(item.title)}</a>`], ["费用", (item) => money(item.price)], ["实付", (item) => money(item.paid)], ["服务状态", (item) => badge(item.status)], ["支付状态", (item) => badge(item.payment_status)]]);
}

function documentRows() {
  return rows(state.documents, [["文书", (item) => `<a href="#/doc/${esc(item.id)}">${esc(item.title)}</a>`], ["版本", (item) => `v${item.current_version}`], ["状态", (item) => badge(item.status)], ["订单", (item) => `<a href="#/order/${esc(item.order_id)}">查看订单</a>`]]);
}

function requestPage() {
  const item = state.detail;
  if (!item) return empty("未找到需求");
  return `${heading(item.title, `${item.region} · ${item.service_type}`)}<section class="surface">${badge(item.status)}${detailList([["事实与目标", item.facts], ["期望交付", item.deliverables], ["预算", money(item.budget)], ["公开范围", item.visibility]])}<h2>律师报价</h2>${rows(item.quotes || [], [["服务范围", (quote) => esc(quote.scope)], ["交付", (quote) => esc(quote.deliverables)], ["报价", (quote) => money(quote.price)], ["有效期", (quote) => esc(quote.valid_until)], ["操作", (quote) => item.owner_id === getCurrentUser().id && quote.status === "valid" && item.status === "quoting" ? button("accept-quote", "接受报价并创建订单", `data-id="${esc(quote.id)}"`, true) : badge(quote.status)]])}${ownsRole("lawyer") && item.owner_id !== getCurrentUser().id && item.status === "quoting" ? `<h2>提交报价</h2><form data-form="quote">${field("服务范围", "scope", "", { textarea: true, required: true })}${field("交付物", "deliverables", "", { required: true })}<div class="form-grid">${field("费用（元）", "price", "", { type: "number", min: "0.01", required: true })}${field("服务天数", "days", "3", { type: "number", min: 1, required: true })}${field("报价有效期", "valid_until", "", { type: "date", required: true })}</div>${formButton("提交报价")}</form>` : ""}</section>`;
}

function orderPage() {
  const item = state.detail;
  if (!item) return empty("未找到订单");
  const client = item.client_id === getCurrentUser().id;
  const lawyer = item.lawyer_id === getCurrentUser().id;
  const payments = item.payments || [];
  const payment = payments[0];
  const payable = state.capabilities.payments_enabled && item.status === "pending_payment";
  const simulationReady = client && payment?.provider === "stub" && ["created", "pending"].includes(payment.status) && state.capabilities.payment_simulation_enabled;
  const description = state.capabilities.payment_simulation_enabled ? "当前为内网模拟支付：二维码仅展示本单金额，不产生真实资金。" : "支付结果只接受支付机构认证通知或主动查单，不接受浏览器自报成功。";
  const simulationPanel = simulationReady ? `<div class="simulation-payment"><p class="simulation-payment-title">模拟支付</p><p class="simulation-payment-amount">${money(payment.amount)}</p><p class="muted">请核对金额。二维码仅用于展示本次支付信息，点击下方“已支付”即可完成模拟支付。</p>${payment.client_params?.qr_svg_base64 ? `<img class="remote-payment-qr" alt="模拟支付二维码，金额${esc(money(payment.amount))}" src="data:image/svg+xml;base64,${esc(payment.client_params.qr_svg_base64)}">` : ""}${button("simulate-payment", "已支付", `data-id="${esc(payment.id)}"`, true)}</div>` : "";
  return `${heading(item.title, description, button("refresh", "刷新订单"))}<section class="surface">${badge(item.status)}${detailList([["订单号", item.id], ["服务范围", item.scope], ["应付", money(item.price)], ["已付", money(item.paid)], ["支付状态", labels[item.payment_status] || item.payment_status], ["结算标记（非资金托管证明）", labels[item.settlement_status] || item.settlement_status]])}${client && item.status === "pending_payment" ? payable ? button("pay", "生成模拟支付", "", true) : '<p class="remote-warning">当前使用内网模拟支付，生成二维码后点击“已支付”即可完成订单。</p>' : ""}${payment ? `<h3>支付单</h3><p>${badge(payment.status)} · ${money(payment.amount)}</p>${simulationPanel}${payment.client_params?.pay_url && /^https:\/\/openapi(?:-sandbox\.dl)?\.alipay(?:dev)?\.com\/gateway\.do\?/.test(payment.client_params.pay_url) ? `<a class="btn primary" href="${esc(payment.client_params.pay_url)}" target="_blank" rel="noopener noreferrer">前往支付宝收银台</a>` : ""}${payment.client_params?.qr_svg_base64 && !simulationReady ? `<img class="remote-payment-qr" alt="微信支付二维码" src="data:image/svg+xml;base64,${esc(payment.client_params.qr_svg_base64)}">` : ""}${payment.client_params?.test_only && !simulationReady ? '<p class="muted">这是隔离测试支付单，不产生真实资金。</p>' : ""}` : ""}${lawyer && ["service", "pending_delivery"].includes(item.status) ? button("delivery-modal", "提交交付物", "", true) : ""}${client && item.status === "pending_receipt" ? `${button("accept-delivery", "确认收悉", "", true)} ${button("return-delivery", "退回交付物")}` : ""}${client && Number(item.paid) > 0 && !["closed", "refund_pending", "disputed"].includes(item.status) ? button("after-sales-modal", "申请退款 / 争议处理") : ""}<h2>订单文书</h2>${documentRows()}<h2>交付记录</h2>${rows(item.deliveries || [], [["时间", (delivery) => date(delivery.created_at)], ["文书", (delivery) => delivery.document_id ? `<a href="#/doc/${esc(delivery.document_id)}">查看交付文书</a>` : "无关联文书"], ["状态", (delivery) => badge(delivery.status)]])}<h2>售后记录</h2>${rows(item.cases || [], [["类型", (entry) => esc(entry.case_type)], ["金额", (entry) => money(entry.amount)], ["状态", (entry) => badge(entry.status)], ["处理意见", (entry) => esc(entry.resolution || entry.reason)]])}</section>`;
}

function documentPage() {
  const item = state.detail;
  if (!item) return empty("未找到文书");
  const version = item.versions.find((entry) => entry.number === item.current_version);
  const editable = !ownsRole("operator") && item.can_edit;
  const pending = item.workflow.find((entry) => entry.assignee_id === getCurrentUser().id && entry.status === "pending" && entry.version === item.locked_version);
  return `${heading(item.title, `当前版本 v${item.current_version} · ${labels[item.status] || item.status}`, button("refresh", "刷新文书"))}<div class="doc-detail-grid"><section class="surface document-editor">${badge(item.status)}${version?.body !== null ? `<form data-form="version"><input type="hidden" name="base_version" value="${item.current_version}">${field("文书正文", "body", version?.body || "", { textarea: true, rows: 18, required: true })}${editable && ["draft", "returned"].includes(item.status) ? formButton("保存新版本") : ""}</form>` : '<p>运营仅可查看业务元数据，不直接读取正文。</p>'}${editable && ["draft", "returned"].includes(item.status) ? button("workflow-modal", "发起顺序会签") : ""}${pending ? `${button("confirm-document", "确认当前锁定版本", "", true)} ${button("return-document", "退回修改")}` : ""}<h2>会签节点</h2>${rows(item.workflow, [["顺序", (entry) => esc(entry.sequence)], ["用户", (entry) => esc(entry.assignee_id)], ["版本", (entry) => `v${entry.version}`], ["状态", (entry) => badge(entry.status)]])}</section><aside class="surface"><h2>历史版本（最近50版）</h2>${item.versions.map((entry) => `<p>v${entry.number} · ${date(entry.created_at)} ${!ownsRole("operator") ? button("export-version", "导出", `data-version="${entry.number}"`) : ""}</p>`).join("")}<h2>参与人</h2>${item.members.map((member) => `<p>${esc(member)} ${item.owner_id === getCurrentUser().id && member !== getCurrentUser().id ? button("revoke-member", "撤销授权", `data-id="${esc(member)}"`) : ""}</p>`).join("")}<h2>附件</h2>${(item.files || []).map((file) => `<p>${button("download-file", esc(file.name), `data-id="${esc(file.id)}" data-name="${esc(file.name)}"`)}</p>`).join("")}${editable ? `<form data-form="document-file"><label class="field"><span>上传附件（≤50MB）</span><input name="file" type="file" required></label>${formButton("上传附件")}</form>` : ""}<h2>批注</h2>${(item.comments || []).map((entry) => `<p>${esc(entry.text)}<small> · v${entry.version} · ${date(entry.created_at)}</small></p>`).join("")}${editable ? `<form data-form="comment">${field("新增批注", "text", "", { textarea: true, required: true })}${formButton("提交批注")}</form>` : ""}</aside></div>`;
}

function profilePage() {
  const user = getCurrentUser();
  return `${heading("账户与律师入驻", "提交申请不等于通过认证；审核通过后才会出现律师能力。") }<section class="surface">${detailList([["姓名", user.name], ["邮箱", user.email], ["注册校验", "算术问答已完成"], ["账户能力", user.roles.map((role) => roleNames[role]).join("、")]])}</section><section class="surface"><h2>修改密码</h2><form data-form="password">${field("原密码", "old_password", "", { type: "password", required: true })}${field("新密码（至少12位）", "new_password", "", { type: "password", required: true })}${formButton("修改密码并退出全部会话")}</form></section>${ownsRole("operator") ? "" : `<section class="surface"><h2>律师资质申请</h2><p class="muted">上传有效PDF或图片格式的执业证及律所证明。材料仅本人和授权审核人员可访问。</p><form data-form="lawyer-application"><div class="form-grid">${[["律所", "firm"], ["地区", "region"], ["专业领域", "field"], ["服务方式", "mode"], ["执业证号", "license_number"]].map(([title, name]) => field(title, name, "", { required: true })).join("")}${field("执业证有效期", "expires_on", "", { type: "date", required: true })}</div><label class="field"><span>证件与律所证明</span><input name="credentials" type="file" multiple accept=".pdf,.png,.jpg,.jpeg" required></label>${formButton("提交律师申请")}</form></section>`}<section class="surface"><h2>申请进度</h2>${state.applications.map((entry) => `<article class="remote-record"><h3>申请 v${entry.version} · ${esc(entry.firm)} ${badge(entry.status)}</h3><p>有效期：${esc(entry.expires_on)}</p>${entry.reviews.map((review) => `<p>${esc(review.reason)} · ${date(review.created_at)}</p>`).join("")}${["submitted", "under_review", "draft"].includes(entry.status) ? button("withdraw-application", "撤回申请", `data-id="${esc(entry.id)}"`) : ""}</article>`).join("") || empty("尚未提交申请")}</section>`;
}

function reviewPage() {
  return `${heading("律师入驻审核", "管理员选择同意后即可完成律师入驻并启用接单；申请资料和有效期仍由系统校验。")}${state.applications.map((entry) => `<section class="surface remote-record"><h2>${esc(entry.firm)} · 申请 v${entry.version} ${badge(entry.status)}</h2>${detailList([["用户ID", entry.user_id], ["地区 / 领域", `${entry.region} / ${entry.field}`], ["执业证号", entry.license_number], ["有效期", entry.expires_on]])}${entry.credential_file_ids.map((fileId) => button("review-file", "下载审核材料（留审计）", `data-application="${esc(entry.id)}" data-id="${esc(fileId)}"`)).join(" ")}${["submitted", "under_review"].includes(entry.status) ? `<form data-form="review-lawyer" data-id="${esc(entry.id)}"><input name="expected_version" type="hidden" value="${entry.version}">${field("决定", "decision", "supplement", { options: ["approve", "reject", "supplement"] })}${field("审核意见", "reason", "", { textarea: true, required: true })}${formButton("提交审核决定")}</form>` : ""}${entry.status === "approved" ? button("freeze-lawyer", "冻结新接单权限", `data-id="${esc(entry.user_id)}"`) : ""}${entry.reviews.map((review) => `<p>${esc(review.decision)}：${esc(review.reason)} · ${date(review.created_at)}</p>`).join("")}</section>`).join("") || empty("暂无申请")}`;
}

function casesPage() {
  return `${heading("售后与争议", "同意退款后需等待支付机构确认，不能只修改本地已退款状态。")}${state.cases.map((entry) => `<section class="surface"><h2>${esc(entry.case_type)} ${badge(entry.status)}</h2><p><a href="#/order/${esc(entry.order_id)}">查看订单</a> · ${money(entry.amount)}</p><p>${esc(entry.reason)}</p>${entry.status === "pending" ? `<form data-form="resolve-case" data-id="${esc(entry.id)}">${field("决定", "decision", "reject", { options: ["approve", "reject"] })}${field("处理意见", "resolution", "", { textarea: true, required: true })}${formButton("确认处理")}</form>` : `<p>${esc(entry.resolution)}</p>`}</section>`).join("") || empty()}`;
}

function paymentOpsPage() {
  const details = state.detail || {};
  return `${heading("支付运维", "异常通知、重复资金流水和退款任务需持续监测；签约前收款保持关闭。") }<section class="surface">${detailList([["渠道", state.capabilities.payment_provider], ["收款开关", state.capabilities.payments_enabled ? "已配置（仍需商户验收）" : "关闭"], ["待处理通知", details.pending_inbox], ["人工处理通知", details.manual_review], ["待确认退款", details.pending_refunds], ["重复扣款待核对", details.overpayments]])}</section>`;
}

function pagination() {
  if (route.id) return "";
  const resources = { requests: "requests", lawyer: "requests", orders: "orders", lawyerOrders: "orders", adminOrders: "orders", docs: "documents", workspace: "documents", notifications: "notifications", reviewLawyers: "applications", audit: "audit", "model-chat": "consultations" };
  const resource = resources[route.page];
  if (!resource) return "";
  const offset = Math.max(0, Number(route.query.get("offset")) || 0);
  return `<div class="filter-row"><span>每页50条 · 第${Math.floor(offset / 50) + 1}页</span>${offset ? button("page", "上一页", `data-offset="${Math.max(0, offset - 50)}"`) : ""}${state[resource].length >= 50 ? button("page", "下一页", `data-offset="${offset + 50}"`) : ""}</div>`;
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
    const next = {};
    const offset = Math.max(0, Number(currentRoute.query.get("offset")) || 0);
    const paging = `limit=50&offset=${offset}`;
    next.capabilities = await apiRequest("/capabilities");
    const pageName = currentRoute.page;
    if (["home", "model-chat", "chat"].includes(pageName)) next.consultations = await apiRequest(`/consultations?${paging}`);
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
    if (pageName === "profile") next.applications = await apiRequest("/lawyers/me/application");
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

async function consentRequest(consultationId) {
  modal("授权生成需求草稿", `<p>系统将根据当前咨询对话，由法律模型生成服务需求草稿。生成后所有字段仍可修改，只有你最终确认发布后才会提交给认证律师。</p><form data-form="consent-summary" data-id="${esc(consultationId)}"><label><input type="checkbox" name="consent" required> 我同意使用本次咨询对话生成服务需求草稿</label>${formButton("同意并生成草稿")}</form>`);
}

function requestModal(summary = null) {
  const generated = summary?.summary?.request_draft || {};
  const facts = generated.facts || summary?.summary?.questions?.join("\n\n") || "";
  const missingLabels = { title: "需求标题", domain: "业务分类", field: "专业领域", service_type: "服务类型", region: "地区", budget: "预算", deadline: "期望截止日期", facts: "事实与目标", deliverables: "交付物要求" };
  const missing = (generated.missing_fields || []).map((name) => missingLabels[name] || name).filter(Boolean);
  const notice = summary ? `<div class="remote-warning"><b>${generated.generated_by === "model" ? "法律模型已根据咨询对话生成需求草稿" : "已根据咨询记录生成需求草稿"}</b><p>请逐项核对并按实际需求修改，系统不会未经确认自动发布。</p>${missing.length ? `<p>仍需补充：${esc(missing.join("、"))}</p>` : ""}</div>` : "";
  modal("发布服务需求", `${notice}<form data-form="request">${summary ? `<input type="hidden" name="source_consultation_id" value="${esc(summary.consultation_id)}"><input type="hidden" name="consent_id" value="${esc(summary.consent_id)}">` : ""}${field("需求标题", "title", generated.title || "", { required: true })}<div class="form-grid">${field("业务分类", "domain", generated.domain || "", { required: true })}${field("专业领域", "field", generated.field || "", { required: true })}${field("服务类型", "service_type", generated.service_type || "", { required: true })}${field("地区", "region", generated.region || "", { required: true })}${field("预算（元）", "budget", generated.budget || "", { type: "number", min: "0.01", required: true })}${field("期望截止日期", "deadline", generated.deadline || "", { type: "date", required: true })}</div>${field("事实与目标（至少8字）", "facts", facts, { textarea: true, required: true })}${field("交付物要求", "deliverables", generated.deliverables || "", { textarea: true, required: true })}${field("公开范围", "visibility", "认证律师可见", { options: ["认证律师可见"] })}<label><input name="consent" type="checkbox" required> 我已核对内容并同意向认证律师发布需求</label>${formButton("确认发布")}</form>`);
}

function modal(title, body) {
  closeModal();
  const element = document.createElement("div");
  element.id = "remote-modal";
  element.className = "modal-overlay";
  element.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button class="btn" data-action="close-modal" aria-label="关闭">×</button></header><div class="modal-body">${body}</div></section>`;
  document.body.append(element);
  restoreDrafts(element);
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

document.addEventListener("input", (event) => {
  const form = event.target.closest("form[data-form]");
  if (form && !["login", "register"].includes(form.dataset.form)) {
    const values = Object.fromEntries(new FormData(form));
    for (const [name, value] of Object.entries(values)) if (value instanceof File || form.elements.namedItem(name)?.type === "password") delete values[name];
    formDrafts.set(sourceKey(form), values);
  }
});

document.addEventListener("click", async (event) => {
  const element = event.target.closest("[data-action]");
  if (!element || element.disabled) return;
  const action = element.dataset.action;
  element.disabled = true;
  try {
    if (action === "login-view" || action === "register-view") return renderAuthentication(action === "register-view");
    if (action === "registration-refresh") return await loadRegistrationChallenge();
    if (action === "logout") {
      draftOwner = "";
      clearSession();
      state = freshState();
      formDrafts.clear();
      modelConsultation.clear();
      ++loadVersion;
      clearTimeout(paymentTimer);
      closeModal();
      return render();
    }
    if (action === "close-modal") return closeModal();
    if (action === "refresh") return await load();
    if (action === "page") return navigate(route.page, route.id, { offset: element.dataset.offset });
    if (action === "new-request") return requestModal();
    if (action === "accept-quote") { const order = await mutate(`/quotes/${element.dataset.id}/accept`); navigate("order", order.id); return; }
    if (action === "pay") { await mutate(`/orders/${route.id}/payments`, {}); notify(state.capabilities.payment_simulation_enabled ? "模拟支付单已创建，请点击模拟支付完成订单" : "支付单已创建，请等待渠道响应后完成支付"); return await load(); }
    if (action === "simulate-payment") { await mutate(`/orders/${route.id}/payments/${element.dataset.id}/simulate-success`, {}); notify("模拟支付成功，订单已进入服务流程"); return await load(); }
    if (action === "new-document") {
      const orders = state.orders.filter((item) => item.payment_status === "paid");
      return modal("新建文书", orders.length ? `<form data-form="document"><label class="field"><span>关联订单</span><select name="order_id">${orders.map((item) => `<option value="${esc(item.id)}">${esc(item.title)}</option>`).join("")}</select></label>${field("标题", "title", "", { required: true })}${field("正文", "body", "", { textarea: true, rows: 10, required: true })}${formButton("创建文书")}</form>` : '<p>暂无可创建文书的已支付订单。</p>');
    }
    if (action === "workflow-modal") return modal("发起顺序会签", `<form data-form="workflow">${field("按顺序填写参与人ID（用英文逗号分隔）", "assignees", state.detail.members.join(","), { required: true })}${formButton("锁定当前版本并开始会签")}</form>`);
    if (action === "confirm-document") { await mutate(`/documents/${route.id}/workflow/confirm`, { version: state.detail.locked_version, reason: "" }); return await load(); }
    if (action === "return-document" || action === "return-delivery" || action === "freeze-lawyer") return modal("填写处理原因", `<form data-form="${action}" data-id="${esc(element.dataset.id || "")}">${field("原因", "reason", "", { textarea: true, required: true })}${formButton("确认提交")}</form>`);
    if (action === "revoke-member") { await mutate(`/documents/${route.id}/access/${element.dataset.id}/revoke`); return await load(); }
    if (action === "export-version") { const entry = await apiRequest(`/documents/${route.id}/versions/${element.dataset.version}`); return download(`${state.detail.title}-v${entry.number}.txt`, entry.body); }
    if (action === "download-file") return await downloadFile(element.dataset.id, element.dataset.name);
    if (action === "review-file") return await downloadFile(element.dataset.id, `审核材料-${element.dataset.id}`, `/admin/lawyer-applications/${element.dataset.application}/files/${element.dataset.id}`);
    if (action === "delivery-modal") return modal("提交交付物", `<form data-form="delivery"><label class="field"><span>交付文书</span><select name="document_id" required>${state.documents.map((item) => `<option value="${esc(item.id)}">${esc(item.title)}</option>`).join("")}</select></label>${formButton("提交交付")}</form>`);
    if (action === "accept-delivery") { await mutate(`/orders/${route.id}/receipt?accepted=true`); return await load(); }
    if (action === "after-sales-modal") return modal("申请售后", `<form data-form="after-sales">${field("类型", "case_type", "refund", { options: ["refund", "dispute"] })}${field("申请金额（元）", "amount", state.detail.paid, { type: "number", min: 0, required: true })}${field("原因", "reason", "", { textarea: true, required: true })}${formButton("提交申请")}</form>`);
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
      return await load();
    }
    if (kind === "password") {
      await mutate("/auth/password", values);
      clearSession(); state = freshState(); formDrafts.clear(); modelConsultation.clear();
      render(); notify("密码已修改，所有旧会话已失效，请重新登录"); return;
    }
    if (kind === "consent-summary") {
      const summary = await mutate(`/consultations/${form.dataset.id}/summary`, { consent: form.elements.consent.checked, scope: "咨询转服务需求" });
      return requestModal(summary);
    }
    if (kind === "request") { values.consent = form.elements.consent.checked; const item = await mutate("/requests", values); target = ["requests", item.id]; }
    if (kind === "quote") { values.days = Number(values.days); await mutate(`/requests/${route.id}/quotes`, values); }
    if (kind === "document") { const item = await mutate("/documents", { ...values, doc_type: "legal_document", members: [] }); target = ["doc", item.id]; }
    if (kind === "version") { values.base_version = Number(values.base_version); await mutate(`/documents/${route.id}/versions`, values); }
    if (kind === "workflow") await mutate(`/documents/${route.id}/workflow`, { assignee_ids: values.assignees.split(",").map((value) => value.trim()).filter(Boolean) });
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
window.addEventListener("auth-expired", () => { ++loadVersion; closeModal(); state = freshState(); render(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });
load();
