import { auditActions, caseTypes, label, objectTypes, reviewDecisions, statusTone } from "./labels.js";
import { ago, button, date, dateOnly, empty, esc, field, icon, money, shortId, status } from "./ui.js";

const badge = (value) => status(label(value), statusTone(value));
const view = { review: "pending", cases: "pending", auditType: "", auditAction: "" };
export function setAdminFilter(name, value) { view[name] = value; }

const tabs = (name, items, counts) => `<div class="pill-tabs" role="tablist">${items.map(([key, title]) => `<button type="button" role="tab" aria-selected="${view[name] === key}" class="${view[name] === key ? "active" : ""}" data-action="admin-filter" data-name="${name}" data-value="${key}">${title}${counts ? `<em>${counts[key]}</em>` : ""}</button>`).join("")}</div>`;
const decisionRadios = (choices) => `<fieldset class="radio-group"><legend>处理决定 <b>*</b></legend>${choices.map(([value, title, hint], index) => `<label class="radio-card"><input type="radio" name="decision" value="${value}" ${index === 0 ? "checked" : ""} required><span><b>${title}</b><small>${hint}</small></span></label>`).join("")}</fieldset>`;

const reviewGroups = { pending: ["submitted", "under_review"], approved: ["approved"], supplement: ["supplement"], rejected: ["rejected", "withdrawn"], all: null };

export function renderReviewPage({ applications }) {
  const counts = Object.fromEntries(Object.entries(reviewGroups).map(([key, values]) => [key, values ? applications.filter((item) => values.includes(item.status)).length : applications.length]));
  const items = applications.filter((item) => !reviewGroups[view.review] || reviewGroups[view.review].includes(item.status));
  const card = (entry) => {
    const pending = ["submitted", "under_review"].includes(entry.status);
    return `<article class="surface review-card"><header><div><h2>${esc(entry.applicant_name || "申请人")} <small>${esc(entry.applicant_email || "")}</small></h2><div class="chip-list"><span class="chip">${esc(entry.field)}</span><span class="chip ghost">${icon("map")}${esc(entry.region)}</span><span class="chip ghost">${esc(entry.mode)}</span></div></div><div class="badges">${badge(entry.status)}${entry.profile_status === "frozen" ? '<span class="status danger">已冻结接单</span>' : ""}</div></header>
    <dl class="data-list"><div><dt>执业机构</dt><dd>${esc(entry.firm)}</dd></div><div><dt>执业证号</dt><dd>${esc(entry.license_number)}</dd></div><div><dt>证件有效期</dt><dd>${esc(dateOnly(entry.expires_on))}</dd></div><div><dt>提交时间</dt><dd>${date(entry.created_at)} · 第 ${entry.version} 次申请</dd></div></dl>
    <div class="file-row">${entry.credential_file_ids.length ? entry.credential_file_ids.map((fileId, index) => button("review-file", `${icon("download")} 资质材料 ${index + 1}`, `data-application="${esc(entry.id)}" data-id="${esc(fileId)}"`, "sm")).join("") : '<span class="muted">未上传材料</span>'}<span class="muted">下载将记录审计日志</span></div>
    ${entry.reviews.length ? `<ul class="timeline-list compact">${entry.reviews.map((review) => `<li><div><b>${esc(reviewDecisions[review.decision] || review.decision)}</b> · ${esc(review.reason)}</div><small>${date(review.created_at)}</small></li>`).join("")}</ul>` : ""}
    ${pending ? `<form data-form="review-lawyer" data-id="${esc(entry.id)}"><input name="expected_version" type="hidden" value="${entry.version}">${decisionRadios([["approve", "通过", "开通律师身份与接单能力"], ["supplement", "需补充材料", "退回申请人补充后重新提交"], ["reject", "驳回", "资质不符合入驻要求"]])}${field("审核意见", "reason", "", { textarea: true, rows: 2, required: true, placeholder: "将通知申请人，请具体说明" })}<p class="form-error" role="alert"></p><div class="form-actions"><button class="btn primary" type="submit">提交审核结果</button></div></form>` : ""}
    ${entry.profile_status === "approved" ? `<div class="form-actions">${button("freeze-lawyer", "冻结接单权限", `data-id="${esc(entry.user_id)}"`, "ghost danger-text")}</div>` : entry.profile_status === "frozen" ? `<div class="form-actions">${button("unfreeze-lawyer", "恢复接单权限", `data-id="${esc(entry.user_id)}"`, true)}</div>` : ""}
    </article>`;
  };
  return `<div class="list-toolbar">${tabs("review", [["pending", "待审核"], ["approved", "已通过"], ["supplement", "需补件"], ["rejected", "已驳回/撤回"], ["all", "全部"]], counts)}</div>${items.map(card).join("") || `<section class="surface">${empty(view.review === "pending" ? "暂无待审核申请" : "暂无记录", "", "", "review")}</section>`}`;
}

export function renderCasesPage({ cases }) {
  const counts = { pending: cases.filter((item) => item.status === "pending").length, done: cases.filter((item) => item.status !== "pending").length, all: cases.length };
  const items = cases.filter((item) => view.cases === "all" || (view.cases === "pending" ? item.status === "pending" : item.status !== "pending"));
  const form = (entry) => {
    const refund = entry.case_type === "refund";
    const choices = refund
      ? [["approve", "同意退款", "按申请金额原路退款"], ["reject", "驳回申请", "订单恢复到申请前状态"]]
      : [["reject", "驳回争议，继续履约", "订单恢复到争议前状态"], ["complete", "协商完成订单", "视为交付完成，进入结算"], ["approve", "支持当事人退款", "按下方金额退款，全额退款将关闭订单"]];
    return `<form data-form="resolve-case" data-id="${esc(entry.id)}">${decisionRadios(choices)}${field(refund ? "退款金额（元）" : "退款金额（仅“支持退款”时生效）", "amount", refund ? entry.amount : entry.order_paid, { type: "number", min: "0.01", step: "0.01", max: entry.order_paid, hint: `订单已付 ${money(entry.order_paid)}` })}${field("处理意见", "resolution", "", { textarea: true, rows: 2, required: true, placeholder: "将同时通知当事人与律师" })}<p class="form-error" role="alert"></p><div class="form-actions"><button class="btn primary" type="submit">确认处理</button></div></form>`;
  };
  const card = (entry) => `<article class="surface case-card"><header><div><span class="tag ${entry.case_type === "refund" ? "gold" : "navy"}">${esc(caseTypes[entry.case_type] || entry.case_type)}</span><h2><a class="link" href="#/order/${esc(entry.order_id)}">${esc(entry.order_title || "关联订单")}</a></h2><small class="muted">订单 #${shortId(entry.order_id)} · ${ago(entry.created_at)}由${esc(entry.creator_name || "用户")}发起</small></div>${badge(entry.status)}</header>
  <dl class="data-list"><div><dt>当事人</dt><dd>${esc(entry.client_name || "—")}</dd></div><div><dt>承办律师</dt><dd>${esc(entry.lawyer_name || "—")}</dd></div><div><dt>订单已付</dt><dd>${money(entry.order_paid)}</dd></div><div><dt>申请金额</dt><dd>${Number(entry.amount) > 0 ? money(entry.amount) : "—"}</dd></div><div class="wide"><dt>申请原因</dt><dd>${esc(entry.reason)}</dd></div>${entry.resolution ? `<div class="wide"><dt>处理结果</dt><dd>${esc(entry.resolution)}</dd></div>` : ""}</dl>
  ${entry.status === "pending" ? form(entry) : ""}</article>`;
  return `<div class="list-toolbar">${tabs("cases", [["pending", "待处理"], ["done", "已处理"], ["all", "全部"]], counts)}<span class="muted">处理期间订单结算暂停；退款完成后自动回写订单状态</span></div>${items.map(card).join("") || `<section class="surface">${empty(view.cases === "pending" ? "暂无待处理售后" : "暂无记录", "", "", "check")}</section>`}`;
}

export function renderAuditPage({ audit }) {
  const types = [...new Set(audit.map((item) => item.object_type))];
  const items = audit.filter((item) => (!view.auditType || item.object_type === view.auditType) && (!view.auditAction || (auditActions[item.action] || item.action).includes(view.auditAction)));
  return `<div class="list-toolbar"><div class="toolbar-filters"><label class="select-filter"><span class="sr-only">对象类型</span><select data-admin-filter="auditType"><option value="">全部对象</option>${types.map((type) => `<option value="${esc(type)}" ${view.auditType === type ? "selected" : ""}>${esc(objectTypes[type] || type)}</option>`).join("")}</select></label><label class="search-input">${icon("search")}<span class="sr-only">搜索操作</span><input data-search="audit" value="${esc(view.auditAction)}" placeholder="搜索操作，如：退款"></label></div><span class="muted">日志只读，任何人不可修改或删除</span></div>
  <section class="surface flush">${items.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>对象</th><th>编号</th></tr></thead><tbody>${items.map((item) => `<tr><td data-label="时间">${date(item.created_at)}</td><td data-label="操作人">${esc(item.actor_name || "系统")}</td><td data-label="操作"><b>${esc(auditActions[item.action] || item.action)}</b></td><td data-label="对象">${esc(objectTypes[item.object_type] || item.object_type)}</td><td data-label="编号"><code>#${shortId(item.object_id)}</code></td></tr>`).join("")}</tbody></table></div>` : empty("暂无匹配的审计记录", "", "", "audit")}</section>`;
}

export function renderPaymentOps({ capabilities, detail = {}, settlements = {} }) {
  const provider = { stub: "模拟支付（测试环境）", wechatpay: "微信支付", alipay: "支付宝", disabled: "未启用" }[capabilities.payment_provider] || capabilities.payment_provider || "未配置";
  const cards = [["wallet", "支付渠道", provider], ["check", "在线收款", capabilities.payments_enabled ? "已开启" : "已关闭"], ["history", "待处理支付通知", detail.pending_inbox ?? 0], ["alert", "需人工核对的通知", detail.manual_review ?? 0], ["finance", "处理中退款", detail.pending_refunds ?? 0], ["review", "重复支付待核对", detail.overpayments ?? 0]];
  return `<div class="kpi-grid three">${cards.map(([glyph, title, value]) => `<div class="kpi-card"><span class="kpi-icon">${icon(glyph)}</span><div><small>${title}</small><strong>${esc(value)}</strong></div></div>`).join("")}</div><section class="surface"><div class="section-title"><h2>${icon("finance")} 订单结算</h2>${button("run-maintenance", `${icon("history")} 立即执行到期任务`, "", "sm")}</div><div class="metric-grid">${[["资金暂存中", settlements.by_status?.frozen ?? 0], ["待结算（售后期内）", settlements.by_status?.pending ?? 0], ["已结算", settlements.by_status?.settled ?? 0], ["部分退款", settlements.by_status?.partially_refunded ?? 0], ["全额退款", settlements.by_status?.refunded ?? 0], ["累计平台服务费", money(settlements.platform_fee_total || 0)]].map(([title, value]) => `<div class="metric"><small>${title}</small><strong>${esc(value)}</strong></div>`).join("")}</div><p class="muted">平台服务费率 ${Math.round(Number(capabilities.platform_fee_rate || 0) * 1000) / 10}%。Worker 每小时自动执行：需求过期、交付超 ${capabilities.delivery_auto_accept_days || 7} 天自动验收、逾期提醒、售后期满结算。</p></section>
  <section class="surface"><h2>${icon("info")} 运维说明</h2><ul class="tips"><li>支付结果只以支付机构的认证通知或主动查单为准，不接受浏览器自报成功。</li><li>“需人工核对的通知”与“重复支付”需对照渠道账单处理，处理结果会写入审计日志。</li><li>退款由售后处理触发，渠道确认后自动回写订单与结算状态。</li></ul></section>`;
}

export function renderNotifications({ notifications }) {
  const unread = notifications.filter((item) => !item.read_at).length;
  const link = { order: "order", order_overdue: "order", document: "doc", request: "requests", lawyer_application: "lawyer-onboarding", license_expiry: "lawyer-onboarding", case: "order", lawyer: "lawyer-onboarding" };
  const target = (item) => (link[item.object_type] && item.object_id ? `#/${link[item.object_type]}${["lawyer-onboarding", "account"].includes(link[item.object_type]) ? "" : `/${esc(item.object_id)}`}` : "");
  return `<div class="list-toolbar"><span class="muted">${unread ? `${unread} 条未读` : "全部已读"}</span>${unread ? button("read-all-notifications", `${icon("check")} 全部标为已读`, "", "sm") : ""}</div>
  <section class="surface flush">${notifications.length ? `<ul class="notice-list">${notifications.map((item) => `<li class="${item.read_at ? "" : "unread"}"><span class="notice-dot" aria-hidden="true"></span><div class="grow"><b>${esc(item.title)}</b><p>${esc(item.body)}</p><small>${ago(item.created_at)}</small></div><div class="notice-actions">${target(item) ? `<a class="btn sm" href="${target(item)}" data-read="${item.read_at ? "" : esc(item.id)}">查看</a>` : ""}${item.read_at ? "" : button("read-notification", "已读", `data-id="${esc(item.id)}"`, "sm ghost")}</div></li>`).join("")}</ul>` : empty("暂无通知", "", "订单、报价、文书与审核进展会在这里提醒你", "bell")}</section>`;
}
