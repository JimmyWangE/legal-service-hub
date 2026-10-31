import { fields, label, regions, serviceModes, serviceTypes, statusTone } from "./labels.js";
import { requestAttachmentField } from "./request-attachments.js";
import { avatar, button, dateOnly, empty, esc, field, icon, money, stars, status } from "./ui.js";

const badge = (value) => status(label(value), statusTone(value));
const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const plusDays = (days) => new Date(Date.now() + 8 * 3600000 + days * 86400000).toISOString().slice(0, 10);
const percent = (rate) => `${Math.round(Number(rate || 0) * 1000) / 10}%`;
const view = { serviceField: "", serviceQuery: "" };

export function setServiceFilter(name, value) { view[name] = value; }

function lawyerLine(lawyer) {
  return `<div class="party">${avatar(lawyer)}<div><b>${esc(lawyer.name)}</b><small>${esc(lawyer.firm || "")}${lawyer.region ? ` · ${esc(lawyer.region)}` : ""}</small></div></div>`;
}

export function serviceCard(service, { lawyer = service.lawyer, canBuy = false, manage = false } = {}) {
  return `<article class="service-card ${service.active ? "" : "inactive"}"><header><span class="chip">${esc(service.service_type)}</span>${service.active ? "" : '<span class="status muted">已下架</span>'}</header><h3>${esc(service.title)}</h3><p class="card-excerpt">${esc(service.description)}</p><dl class="service-terms"><div><dt>交付物</dt><dd>${esc(service.deliverables)}</dd></div><div><dt>交付周期</dt><dd>${service.days} 天</dd></div></dl>${lawyer ? `<a class="service-lawyer" href="#/lawyers/${esc(lawyer.id)}">${lawyerLine(lawyer)}${stars(lawyer.rating_avg, lawyer.review_count)}</a>` : ""}<footer><div class="amount">${money(service.price)}<small>${service.sold ? `已委托 ${service.sold} 次` : "一口价 · 明码标价"}</small></div>${canBuy ? button("purchase-service", "立即委托", `data-id="${esc(service.id)}"`, true) : ""}${manage ? `${button("edit-service", "编辑", `data-id="${esc(service.id)}"`, "sm")}${button("toggle-service", service.active ? "下架" : "重新上架", `data-id="${esc(service.id)}"`, "sm ghost")}` : ""}</footer></article>`;
}

export function renderServiceCatalog({ services, user }) {
  const query = view.serviceQuery.trim();
  const items = services.filter((item) => (!view.serviceField || item.field === view.serviceField) && (!query || [item.title, item.description, item.service_type, item.lawyer?.name].some((text) => String(text || "").includes(query))));
  const canBuy = user.roles.includes("client");
  return `<div class="value-strip">${[["wallet", "明码标价", "价格、交付物、工期提前确定"], ["review", "认证律师", "资质经平台人工审核"], ["shield", "验收后结算", "律师交付并经你确认后才结算"], ["clock", "售后保障", "完成后 15 天内可申请退款或争议处理"]].map(([glyph, title, text]) => `<div>${icon(glyph)}<span><b>${title}</b><small>${text}</small></span></div>`).join("")}</div>
  <div class="list-toolbar"><div class="toolbar-filters grow"><label class="search-input">${icon("search")}<span class="sr-only">搜索服务</span><input data-search="services" value="${esc(view.serviceQuery)}" placeholder="搜索服务，如：合同审查、律师函"></label><label class="select-filter"><span class="sr-only">领域</span><select data-service-filter="serviceField"><option value="">全部领域</option>${fields.map((value) => `<option ${view.serviceField === value ? "selected" : ""}>${esc(value)}</option>`).join("")}</select></label></div><span class="muted">找不到合适的？<a class="link" href="#/requests">发布需求</a>，让律师主动报价</span></div>
  <div class="service-grid" id="service-cards">${items.length ? items.map((item) => serviceCard(item, { canBuy: canBuy && item.lawyer_id !== user.id })).join("") : `<div class="no-result">${empty(services.length ? "没有符合条件的服务" : "暂无上架的服务", "", services.length ? "调整筛选条件后再试" : "律师上架标准化服务后会出现在这里", "briefcase")}</div>`}</div>`;
}

export function purchaseFormBody(service, capabilities = {}) {
  return `<div class="purchase-summary"><div><b>${esc(service.title)}</b><small>${esc(service.lawyer?.name || "")} · ${service.days} 天交付 · ${esc(service.deliverables)}</small></div><strong>${money(service.price)}</strong></div>
  <ol class="consent-steps"><li><b>提交委托</b>说明你的情况，生成订单与服务合同</li><li><b>律师确认</b>律师确认合同后进入支付</li><li><b>验收结算</b>律师交付、你验收后订单完成</li></ol>
  <form data-form="purchase-service" data-id="${esc(service.id)}">${field("你的情况与诉求", "facts", "", { textarea: true, rows: 5, required: true, placeholder: "简要说明事情经过、目前进展和希望达到的结果（至少8字）", hint: "律师看到的内容中，手机号、身份证号、邮箱会自动隐藏" })}${field("所在地区", "region", "", { options: regions, required: true, placeholder: "请选择" })}${requestAttachmentField()}<p class="muted">付款前你可以随时取消订单，不产生费用。律师提交交付后，你 ${capabilities.delivery_auto_accept_days || 7} 天内未处理将自动确认验收。</p><p class="form-error" role="alert"></p><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">提交委托</button></div></form>`;
}

export function renderLawyerProfile({ lawyer, user, myRequests = [] }) {
  if (!lawyer) return empty("律师不存在或资质已失效");
  const client = user.roles.includes("client") && lawyer.id !== user.id;
  const quoting = myRequests.filter((item) => item.status === "quoting" && item.visibility === "认证律师可见");
  const specialties = [lawyer.field, ...(lawyer.specialties || [])];
  return `<a class="back-link" href="#/lawyers">${icon("back")} 返回律师列表</a>
  <section class="surface lawyer-hero">${avatar(lawyer, "xl")}<div class="grow"><h1>${esc(lawyer.name)} <span class="verified" title="执业资质已通过平台审核">${icon("review")} 认证律师</span></h1><p>${esc(lawyer.firm)} · ${esc(lawyer.region)}${lawyer.practice_years ? ` · 执业 ${lawyer.practice_years} 年` : ""}</p><div class="chip-list">${specialties.map((text) => `<span class="chip">${esc(text)}</span>`).join("")}<span class="chip ghost">${esc(lawyer.mode)}</span></div><div class="lawyer-stats">${stars(lawyer.rating_avg, lawyer.review_count)}<span>已完成 <b>${lawyer.completed_orders ?? 0}</b> 单</span><span class="${lawyer.can_take_orders ? "online" : "offline"}">${lawyer.can_take_orders ? "可接单" : "暂停接单"}</span></div></div>${client ? `<div class="hero-actions column">${button("open-chat", `${icon("message")} 在线咨询`, `data-peer="${esc(lawyer.id)}"`, true)}${lawyer.can_take_orders ? button("invite-lawyer", `${icon("request")} 邀请报价`, `data-id="${esc(lawyer.id)}"${quoting.length ? "" : ' data-empty="1"'}`) : ""}</div>` : ""}</section>
  <div class="detail-grid-2"><div>
    <section class="surface"><h2>律师简介</h2><p class="prose">${esc(lawyer.bio || "这位律师还没有填写简介。可以通过在线咨询了解其执业经历与服务方式。")}</p></section>
    <section class="surface"><div class="section-title"><h2>服务套餐</h2><small>明码标价，可直接委托</small></div>${(lawyer.services || []).length ? `<div class="service-grid compact">${lawyer.services.map((item) => serviceCard(item, { lawyer: null, canBuy: client && lawyer.can_take_orders })).join("")}</div>` : empty("暂未上架服务套餐", client ? button("invite-lawyer", "邀请该律师为我的需求报价", `data-id="${esc(lawyer.id)}"${quoting.length ? "" : ' data-empty="1"'}`) : "", "可以发布需求后邀请律师报价", "briefcase")}</section>
    <section class="surface"><div class="section-title"><h2>当事人评价</h2><small>${lawyer.review_count ? `共 ${lawyer.review_count} 条` : ""}</small></div>${(lawyer.reviews || []).length ? lawyer.reviews.map((entry) => `<div class="review-item"><div class="review-head"><b>${esc(entry.author)}</b><span class="stars-static">${"★".repeat(entry.rating)}<i>${"★".repeat(5 - entry.rating)}</i></span><small>${dateOnly(entry.created_at)}</small></div>${entry.content ? `<p>${esc(entry.content)}</p>` : '<p class="muted">用户未填写评价内容</p>'}</div>`).join("") : empty("暂无评价", "", "完成订单的当事人评价会展示在这里", "star")}</section>
  </div><aside>
    <section class="surface"><h2>执业信息</h2><dl class="data-list single"><div><dt>执业机构</dt><dd>${esc(lawyer.firm)}</dd></div><div><dt>执业地区</dt><dd>${esc(lawyer.region)}</dd></div><div><dt>服务方式</dt><dd>${esc(lawyer.mode)}</dd></div><div><dt>资质有效期</dt><dd>${esc(dateOnly(lawyer.expires_on))}</dd></div></dl><p class="muted">执业证号等证件信息仅平台审核人员可见。</p></section>
    <section class="surface tip-card"><h2>${icon("shield")} 平台保障</h2><ul class="tips"><li>律师资质经平台人工审核</li><li>服务合同双方在线确认后才付款</li><li>交付经你验收后订单才完成并结算</li><li>完成后仍可在售后期内申请退款或争议处理</li></ul></section>
  </aside></div>`;
}

export function inviteFormBody(lawyerId, requests) {
  const quoting = requests.filter((item) => item.status === "quoting" && item.visibility === "认证律师可见");
  if (!quoting.length) return `<div class="info-callout">${icon("info")}<span>你目前没有“报价中”的需求。先发布需求，再邀请这位律师报价。</span></div><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">取消</button>${button("new-request", `${icon("plus")} 发布需求`, "", true)}</div>`;
  return `<form data-form="invite-lawyer" data-id="${esc(lawyerId)}"><p class="muted">律师会收到站内通知，可查看脱敏后的需求内容并报价。每位律师对同一需求只会被邀请一次。</p><label class="field"><span>选择需求 <b>*</b></span><select name="request_id" required>${quoting.map((item) => `<option value="${esc(item.id)}">${esc(item.title)} · 预算 ${money(item.budget)}</option>`).join("")}</select></label><p class="form-error" role="alert"></p><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">发送邀请</button></div></form>`;
}

export function renderMyServices({ services, profile, capabilities = {} }) {
  const approved = profile?.status === "approved";
  if (!approved) return `<section class="surface">${empty("资质审核通过后即可上架服务", '<a class="btn primary" href="#/lawyer-onboarding">前往律师入驻</a>', "", "review")}</section>`;
  return `<div class="info-callout">${icon("info")}<span>上架标准化服务后，当事人可在“服务套餐”与你的律师主页直接委托。平台服务费为成交金额的 ${percent(capabilities.platform_fee_rate)}，订单完成且售后期结束后结算。${profile.available ? "" : "<b>你当前已暂停接单，服务不会对当事人展示。</b>"}</span></div>
  <div class="service-grid">${services.length ? services.map((item) => serviceCard(item, { lawyer: null, manage: true })).join("") : `<div class="no-result">${empty("还没有上架服务", button("new-service", `${icon("plus")} 上架第一个服务`, "", true), "例如：合同审查 ¥299、律师函 ¥599、劳动仲裁咨询 ¥199", "briefcase")}</div>`}</div>`;
}

export function serviceFormBody(service = null, capabilities = {}) {
  const value = service || { service_type: "合同审阅", field: "合同纠纷", days: 3 };
  const fee = Number(capabilities.platform_fee_rate || 0);
  return `<form data-form="service" data-id="${esc(service?.id || "")}">${field("服务名称", "title", value.title || "", { required: true, maxlength: 100, placeholder: "例如：合同审查（10页内）" })}<div class="form-grid">${field("服务类型", "service_type", value.service_type, { options: serviceTypes, required: true })}${field("所属领域", "field", value.field, { options: fields, required: true })}${field("价格（元）", "price", value.price || "", { type: "number", min: "1", step: "0.01", required: true, hint: fee ? `平台服务费 ${percent(fee)}，结算到账约为价格的 ${percent(1 - fee)}` : "" })}${field("交付周期（天）", "days", value.days, { type: "number", min: 1, max: 365, step: 1, required: true })}</div>${field("服务内容", "description", value.description || "", { textarea: true, rows: 4, required: true, placeholder: "说明服务包含什么、不包含什么、沟通与修改次数等（至少8字）" })}${field("交付物", "deliverables", value.deliverables || "", { required: true, placeholder: "例如：书面审查意见书一份" })}<label class="check-row"><input type="checkbox" name="active" ${value.active === false ? "" : "checked"}> 立即上架</label><p class="form-error" role="alert"></p><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">${service ? "保存修改" : "上架服务"}</button></div></form>`;
}

export function renderMyQuotes({ quotes }) {
  if (!quotes.length) return `<div class="no-result">${empty("还没有提交过报价", '<a class="btn primary" href="#/requests">浏览需求线索</a>', "", "briefcase")}</div>`;
  return `<div class="surface flush"><div class="table-wrap"><table class="data-table"><thead><tr><th>需求</th><th>报价</th><th>交付</th><th>有效期</th><th>报价状态</th><th>需求状态</th></tr></thead><tbody>${quotes.map((quote) => `<tr><td data-label="需求"><a class="link" href="#/requests/${esc(quote.request.id)}">${esc(quote.request.title)}</a><small class="muted block">${esc(quote.request.region)} · ${esc(quote.request.service_type)}${quote.request.visibility === "定向委托" ? " · 定向委托" : ""}</small></td><td data-label="报价"><b>${money(quote.price)}</b></td><td data-label="交付">${quote.days} 天</td><td data-label="有效期">${esc(dateOnly(quote.valid_until))}</td><td data-label="报价状态">${badge(quote.status)}</td><td data-label="需求状态">${badge(quote.request.status)}</td></tr>`).join("")}</tbody></table></div></div>`;
}

export function lawyerProfileForm(profile) {
  const chosen = new Set(profile.specialties || []);
  return `<section class="surface"><div class="section-title"><h2>${icon("lawyer")} 律师主页资料</h2><a class="link" href="#/lawyers/${esc(profile.user_id || "")}" data-self-profile>预览主页</a></div><p class="muted">简介、执业年限与擅长领域会展示在“找律师”和你的律师主页，帮助当事人了解你。执业机构、证号等资质信息需重新提交入驻申请才能变更。</p><form data-form="lawyer-profile"><div class="form-grid">${field("执业年限", "practice_years", profile.practice_years || 0, { type: "number", min: 0, max: 60, step: 1 })}${field("服务方式", "mode", profile.mode || "线上服务", { options: serviceModes })}</div>${field("个人简介", "bio", profile.bio || "", { textarea: true, rows: 4, maxlength: 1000, placeholder: "介绍你的执业经历、擅长处理的案件类型与服务风格" })}<fieldset class="chip-picker"><legend>其他擅长领域（最多 5 个，主领域：${esc(profile.field)}）</legend>${fields.filter((name) => name !== profile.field).map((name) => `<label><input type="checkbox" name="specialties" value="${esc(name)}" ${chosen.has(name) ? "checked" : ""}><span>${esc(name)}</span></label>`).join("")}</fieldset><label class="switch-row"><input type="checkbox" name="available" ${profile.available ? "checked" : ""} ${profile.status === "approved" ? "" : "disabled"}><span><b>接受新委托</b><small>关闭后不再出现在律师列表，未被接受的有效报价将自动撤回；进行中的订单不受影响。</small></span></label><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn primary" type="submit">保存主页资料</button></div></form></section>`;
}

export function acceptQuoteBody(quote, capabilities = {}) {
  const lawyer = quote.lawyer || {};
  return `<div class="purchase-summary"><div>${lawyerLine(lawyer)}</div><strong>${money(quote.price)}</strong></div><dl class="data-list single"><div><dt>服务范围</dt><dd>${esc(quote.scope)}</dd></div><div><dt>交付物</dt><dd>${esc(quote.deliverables)}</dd></div><div><dt>交付周期</dt><dd>付款后 ${quote.days} 天内</dd></div></dl><div class="info-callout">${icon("info")}<span>选择后将生成订单和服务合同，其他律师的报价会自动失效。双方确认合同后再付款；付款前任一方都可取消订单。交付后 ${capabilities.delivery_auto_accept_days || 7} 天内未验收将自动确认。</span></div><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">再想想</button>${button("confirm-accept-quote", "确认选择并生成订单", `data-id="${esc(quote.id)}"`, true)}</div>`;
}

export function reviewFormBody(client) {
  return `<form data-form="review"><fieldset class="star-input"><legend>${client ? "为律师的服务打分" : "为本次合作打分"} <b>*</b></legend>${[5, 4, 3, 2, 1].map((value) => `<input type="radio" id="star-${value}" name="rating" value="${value}" ${value === 5 ? "checked" : ""} required><label for="star-${value}" title="${value} 星">★</label>`).join("")}</fieldset>${field("评价内容（选填）", "content", "", { textarea: true, rows: 3, maxlength: 1000, placeholder: client ? "律师的专业度、响应速度、沟通体验如何？" : "当事人的沟通配合情况如何？" })}<p class="muted">评价提交后不可修改，${client ? "将匿名展示在律师主页（仅显示姓氏）" : "仅订单双方与平台可见"}。</p><p class="form-error" role="alert"></p><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">提交评价</button></div></form>`;
}

export function reopenFormBody() {
  return `<form data-form="reopen-request"><p class="muted">设置新的期望完成日期后，需求将重新对认证律师开放报价。</p>${field("新的期望完成日期", "deadline", plusDays(14), { type: "date", required: true, min: today() })}<p class="form-error" role="alert"></p><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">重新开放报价</button></div></form>`;
}

export function renderHelp(capabilities = {}) {
  const autoDays = capabilities.delivery_auto_accept_days || 7;
  const afterSales = capabilities.after_sales_window_days || 15;
  const faqs = [
    ["法律模型的回答可以直接作为法律意见吗？", "不可以。模型回答用于帮助你梳理事实和了解一般性规则，不构成法律意见。涉及诉讼、羁押、时效等重要事项，请委托执业律师。"],
    ["“发布需求”和“服务套餐”有什么区别？", "服务套餐是律师明码标价的标准化服务（如合同审查、律师函），适合需求明确的情况，可直接委托；发布需求适合情况复杂或不确定服务内容的情况，多位律师会给出方案和报价供你比较。"],
    ["什么时候付款？付款后律师不干活怎么办？", "双方在线确认服务合同后才需要付款。付款后款项由平台暂存，律师交付并经你验收后订单才完成；律师逾期未交付时你会收到提醒，并可随时申请售后退款。"],
    [`律师提交了交付物，我一直没处理会怎样？`, `交付提交后 ${autoDays} 天内未确认也未退回的，系统将自动确认验收，以保障律师的合理权益。对交付不满意请在期限内点击“退回修改”并说明原因。`],
    ["订单完成后还能退款吗？", `订单完成后 ${afterSales} 天内可申请退款或争议处理，由平台运营介入核实。售后期结束且无争议后订单进入结算，不再受理售后申请。`],
    ["律师能看到我的隐私信息吗？", "律师浏览需求时，手机号、身份证号、邮箱会自动隐藏；你上传的聊天记录和附件仅你本人和最终承接订单的律师可以下载。"],
    ["如何成为平台律师？", "注册后在“律师入驻”提交执业证与律所证明，平台审核通过后即可报价接单、上架服务套餐。"],
  ];
  return `<section class="help-hero surface"><div><h2>${icon("shield")} 你的每一笔委托，都有明确的规则保障</h2><p>平台连接当事人与认证律师，提供合同确认、资金暂存、交付验收、售后与存证等履约保障。以下规则对所有订单一致适用。</p></div></section>
  <div class="rule-grid">${[["review", "律师资质审核", "执业证、律所证明由平台人工核验，过期或违规的律师会被暂停接单。"], ["doc", "先确认合同再付款", "订单生成后双方在线确认服务范围、交付物、工期与费用，确认后才进入支付。"], ["wallet", "资金暂存、验收后结算", `付款由平台暂存。律师交付后你验收确认；${autoDays} 天未处理系统自动确认。`], ["clock", `${afterSales} 天售后期`, `订单完成后 ${afterSales} 天内可申请退款或争议处理，平台介入核实处理。`], ["lock", "隐私保护", "需求中的联系方式自动脱敏，附件仅本人与承办律师可下载，关键操作全程留痕。"], ["audit", "交易存证", "合同、文书版本指纹、会签、支付与操作日志可一键导出存证包。"]].map(([glyph, title, text]) => `<article class="rule-card"><span class="kpi-icon">${icon(glyph)}</span><h3>${title}</h3><p>${text}</p></article>`).join("")}</div>
  <div class="detail-grid-2"><section class="surface"><h2>常见问题</h2><div class="faq-list">${faqs.map(([question, answer]) => `<details><summary>${esc(question)}</summary><p>${esc(answer)}</p></details>`).join("")}</div></section>
  <aside><section class="surface"><h2>费用说明</h2><dl class="data-list single"><div><dt>当事人</dt><dd>按律师报价或套餐价格支付，平台不额外收费</dd></div><div><dt>律师</dt><dd>平台服务费为订单实收金额的 ${percent(capabilities.platform_fee_rate)}，结算时扣除</dd></div><div><dt>退款</dt><dd>按售后处理结果原路退回</dd></div></dl></section>
  <section class="surface tip-card"><h2>${icon("alert")} 紧急情况</h2><p class="prose">如已被采取刑事强制措施、面临诉讼时效届满或人身安全风险，请优先直接联系执业律师或拨打 110 / 12348 公共法律服务热线。</p></section></aside></div>`;
}

export function lawyerIncome(orders, user, rate = 0) {
  const mine = orders.filter((item) => item.lawyer_id === user.id && item.payment_status === "paid");
  const settled = mine.filter((item) => item.settlement_status === "settled").reduce((sum, item) => sum + Number(item.paid || 0) - Number(item.platform_fee || 0), 0);
  const pending = mine.filter((item) => item.status === "completed" && item.settlement_status !== "settled").reduce((sum, item) => sum + Number(item.paid || 0) * (1 - Number(rate || 0)), 0);
  return { settled, pending };
}

