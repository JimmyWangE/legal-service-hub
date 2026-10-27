import { domains, fields, label, regions, serviceTypes, statusTone } from "./labels.js";
import { ago, avatar, button, dateOnly, empty, esc, field, icon, money, stars, status } from "./ui.js";

const requestFilters = [["all", "全部", null], ["quoting", "报价中", ["quoting"]], ["ordered", "已下单", ["ordered"]], ["closed", "已关闭", ["closed"]]];
const view = { status: "all", field: "", region: "", query: "", lawyerQuery: "", lawyerField: "", lawyerRegion: "" };

export function setRequestFilter(name, value) { view[name] = value; }

const badge = (value) => status(label(value), statusTone(value));
const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const chips = (item) => `<div class="chip-list">${[item.domain, item.field, item.service_type].filter(Boolean).map((text) => `<span class="chip">${esc(text)}</span>`).join("")}<span class="chip ghost">${icon("map")}${esc(item.region)}</span></div>`;

export function renderRequestCards({ requests, user, lawyerView }) {
  const statuses = requestFilters.find(([key]) => key === view.status)?.[2];
  const query = view.query.trim();
  const items = requests.filter((item) => (!lawyerView || item.owner_id !== user.id)
    && (!statuses || statuses.includes(item.status))
    && (!view.field || item.field === view.field)
    && (!view.region || item.region === view.region)
    && (!query || item.title.includes(query) || item.facts.includes(query)));
  if (!items.length) return `<div class="no-result">${requests.length ? empty("没有符合条件的需求", "", "调整筛选条件后再试", "filter") : lawyerView ? empty("暂无可报价的需求线索", "", "当事人发布需求后会第一时间出现在这里", "request") : empty("还没有发布需求", button("new-request", `${icon("plus")} 发布需求`, "", true), "也可以先在法律咨询中梳理问题，再一键生成需求草稿", "request")}</div>`;
  return items.map((item) => `<a class="item-card request-card" href="#/requests/${esc(item.id)}"><header><h3>${esc(item.title)}</h3>${badge(item.status)}</header>${chips(item)}<p class="card-excerpt">${esc(item.facts.slice(0, 90))}${item.facts.length > 90 ? "…" : ""}</p><footer><div class="amount">${money(item.budget)}<small>预算</small></div><span class="meta">${icon("clock")}期望 ${esc(dateOnly(item.deadline))} 前 · ${ago(item.created_at)}发布</span></footer></a>`).join("");
}

export function renderRequestList(context) {
  const { requests, lawyerView } = context;
  const select = (name, title, values) => `<label class="select-filter"><span class="sr-only">${title}</span><select data-request-filter="${name}"><option value="">${title}</option>${values.map((value) => `<option ${view[name] === value ? "selected" : ""}>${esc(value)}</option>`).join("")}</select></label>`;
  return `<div class="list-toolbar"><div class="pill-tabs" role="tablist">${requestFilters.map(([key, title, statuses]) => `<button type="button" role="tab" aria-selected="${view.status === key}" class="${view.status === key ? "active" : ""}" data-action="request-filter" data-value="${key}">${title}<em>${statuses ? requests.filter((item) => statuses.includes(item.status)).length : requests.length}</em></button>`).join("")}</div><div class="toolbar-filters">${select("field", "全部领域", fields)}${select("region", "全部地区", regions)}<label class="search-input">${icon("search")}<span class="sr-only">搜索需求</span><input data-search="requests" value="${esc(view.query)}" placeholder="${lawyerView ? "搜索线索关键词" : "搜索需求"}"></label></div></div><div class="card-grid" id="request-cards">${renderRequestCards(context)}</div>`;
}

function quoteCard({ quote, item, me, best }) {
  const lawyer = quote.lawyer || {};
  const owner = item.owner_id === me;
  const canAccept = owner && quote.status === "valid" && item.status === "quoting";
  const tags = [best.price === quote.id ? '<span class="tag gold">报价最低</span>' : "", best.rating === quote.id ? '<span class="tag navy">评分最高</span>' : ""].join("");
  return `<article class="quote-card ${quote.status !== "valid" ? "inactive" : ""}"><header><div class="party">${avatar(lawyer)}<div><b>${esc(lawyer.name || "认证律师")}</b><small>${esc(lawyer.firm || "")}${lawyer.region ? ` · ${esc(lawyer.region)}` : ""}</small></div></div>${badge(quote.status)}</header>
  <div class="quote-meta">${stars(lawyer.rating_avg, lawyer.review_count)}<span>${icon("check")} 已完成 ${lawyer.completed_orders ?? 0} 单</span>${tags}</div>
  <div class="quote-price"><strong>${money(quote.price)}</strong><span>${quote.days} 天交付</span></div>
  <dl class="quote-terms"><div><dt>服务范围</dt><dd>${esc(quote.scope)}</dd></div><div><dt>交付物</dt><dd>${esc(quote.deliverables)}</dd></div><div><dt>付款方式</dt><dd>${esc(quote.payment_terms || "确认合同后一次性支付")}</dd></div><div><dt>报价有效期</dt><dd>${esc(dateOnly(quote.valid_until))} 前</dd></div></dl>
  <footer>${canAccept ? button("accept-quote", "选择该律师", `data-id="${esc(quote.id)}" data-name="${esc(lawyer.name || "")}" data-price="${esc(quote.price)}"`, true) : ""}${owner ? button("open-chat", `${icon("message")} 咨询律师`, `data-peer="${esc(quote.lawyer_id)}"`) : ""}${quote.lawyer_id === me && quote.status === "valid" ? button("withdraw-quote", "撤回报价", `data-id="${esc(quote.id)}"`, "ghost") : ""}</footer></article>`;
}

export function renderRequestDetail({ item, user, lawyerCanQuote }) {
  if (!item) return empty("未找到需求");
  const me = user.id;
  const owner = item.owner_id === me;
  const quotes = item.quotes || [];
  const valid = quotes.filter((quote) => quote.status === "valid");
  const best = {
    price: valid.length > 1 ? valid.reduce((low, quote) => (Number(quote.price) < Number(low.price) ? quote : low)).id : "",
    rating: valid.filter((quote) => quote.lawyer?.rating_avg).sort((a, b) => b.lawyer.rating_avg - a.lawyer.rating_avg)[0]?.id || "",
  };
  const myQuote = quotes.find((quote) => quote.lawyer_id === me && quote.status === "valid");
  const actions = owner && item.status === "quoting" ? `${!valid.length ? button("edit-request", `${icon("doc")} 编辑需求`) : ""}${button("close-request", "关闭需求", "", "ghost")}` : !owner && item.owner_id ? button("open-chat", `${icon("message")} 联系当事人`, `data-peer="${esc(item.owner_id)}"`) : "";
  const quoteForm = lawyerCanQuote && !owner && item.status === "quoting" && !myQuote ? `<section class="surface"><div class="section-title"><h2>提交报价方案</h2><small>当事人将看到你的姓名、律所、评分与方案</small></div><form data-form="quote">${field("服务范围", "scope", "", { textarea: true, required: true, rows: 3, placeholder: "说明你将提供哪些服务、包含几轮沟通或修改" })}${field("交付物", "deliverables", item.deliverables, { required: true })}<div class="form-grid">${field("服务费用（元）", "price", "", { type: "number", min: "0.01", step: "0.01", required: true, placeholder: `预算 ${Number(item.budget).toFixed(0)}` })}${field("交付周期（天）", "days", "3", { type: "number", min: 1, max: 3650, step: 1, required: true })}${field("付款方式", "payment_terms", "确认合同后一次性支付", { options: ["确认合同后一次性支付", "确认合同后支付全款，交付后结算"], required: true })}${field("报价有效期至", "valid_until", "", { type: "date", required: true, min: today() })}</div><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn primary" type="submit">提交报价</button></div></form></section>` : "";
  return `<a class="back-link" href="#/requests">${icon("back")} 返回需求列表</a>
  <section class="surface detail-hero-card"><div class="detail-hero"><div><div class="badges">${badge(item.status)}${item.masked ? '<span class="status muted">已脱敏</span>' : ""}</div><h1>${esc(item.title)}</h1>${chips(item)}</div><div class="price"><small>预算</small><strong>${money(item.budget)}</strong><small>期望 ${esc(dateOnly(item.deadline))} 前完成</small></div></div>${actions ? `<div class="hero-actions">${actions}</div>` : ""}</section>
  <div class="detail-grid-2"><div>
    <section class="surface"><h2>事实与目标</h2><p class="prose">${esc(item.facts)}</p>${item.masked ? `<div class="info-callout">${icon("lock")}<span>为保护当事人隐私，手机号、身份证号、邮箱等信息已隐藏；报价后可通过站内交流进一步了解。</span></div>` : ""}<h2 class="spaced">期望交付</h2><p class="prose">${esc(item.deliverables)}</p></section>
    ${quoteForm}
    <section class="surface"><div class="section-title"><h2>${owner ? "律师报价" : "我的报价"}</h2><small>${owner ? `共 ${quotes.length} 份，有效 ${valid.length} 份` : ""}</small></div>${quotes.length ? `<div class="quote-grid">${quotes.map((quote) => quoteCard({ quote, item, me, best })).join("")}</div>` : empty(owner ? "暂未收到报价" : "你尚未对该需求报价", "", owner ? "认证律师报价后会通知你，可同时在“找律师”主动联系律师" : "", "briefcase")}</section>
  </div><aside>
    <section class="surface"><h2>需求信息</h2><dl class="data-list single"><div><dt>业务分类</dt><dd>${esc(item.domain)}</dd></div><div><dt>专业领域</dt><dd>${esc(item.field)}</dd></div><div><dt>服务类型</dt><dd>${esc(item.service_type)}</dd></div><div><dt>所在地区</dt><dd>${esc(item.region)}</dd></div><div><dt>公开范围</dt><dd>${esc(item.visibility)}</dd></div><div><dt>发布时间</dt><dd>${ago(item.created_at)}</dd></div></dl></section>
    ${owner ? `<section class="surface tip-card"><h2>${icon("info")} 如何选择律师</h2><ul class="tips"><li>对比服务范围与交付物是否覆盖你的诉求</li><li>参考律师评分与已完成订单数</li><li>不确定时先“咨询律师”沟通细节</li><li>选择后双方确认服务合同，再完成支付</li></ul></section>` : ""}
  </aside></div>`;
}

export function requestFormBody({ draft = {}, summary = null, edit = null }) {
  const source = edit || draft;
  const missing = (draft.missing_fields || []).map((name) => ({ title: "需求标题", domain: "业务分类", field: "专业领域", service_type: "服务类型", region: "地区", budget: "预算", deadline: "期望截止日期", facts: "事实与目标", deliverables: "交付物要求" })[name]).filter(Boolean);
  const notice = summary ? `<div class="info-callout">${icon("spark")}<span><b>${draft.generated_by === "model" ? "已根据咨询对话自动生成需求草稿" : "已根据咨询记录生成需求草稿"}</b>，请逐项核对后发布。${missing.length ? `<br>仍需补充：${esc(missing.join("、"))}` : ""}</span></div>` : "";
  const pick = (values, value) => (value && !values.includes(value) ? [...values, value] : values);
  return `${notice}<form data-form="${edit ? "edit-request" : "request"}">${summary ? `<input type="hidden" name="source_consultation_id" value="${esc(summary.consultation_id)}"><input type="hidden" name="consent_id" value="${esc(summary.consent_id)}">` : ""}${edit ? `<input type="hidden" name="expected_version" value="${esc(edit.version)}">` : ""}
  ${field("需求标题", "title", source.title || "", { required: true, maxlength: 200, placeholder: "一句话说明需要什么帮助，例如：采购合同违约，需律师审阅并出具律师函" })}
  <div class="form-grid">${field("业务分类", "domain", source.domain || "", { options: pick(domains, source.domain), required: true, placeholder: "请选择" })}${field("专业领域", "field", source.field || "", { options: pick(fields, source.field), required: true, placeholder: "请选择" })}${field("服务类型", "service_type", source.service_type || "", { options: pick(serviceTypes, source.service_type), required: true, placeholder: "请选择" })}${field("所在地区", "region", source.region || "", { options: pick(regions, source.region), required: true, placeholder: "请选择" })}${field("预算（元）", "budget", source.budget || "", { type: "number", min: "0.01", step: "0.01", required: true })}${field("期望完成日期", "deadline", source.deadline || "", { type: "date", required: true, min: today() })}</div>
  ${field("事实与目标", "facts", source.facts || "", { textarea: true, rows: 5, required: true, minlength: 8, placeholder: "简要说明事情经过、目前进展和希望达到的结果（至少8字）", hint: "律师看到的需求会自动隐藏手机号、身份证号和邮箱" })}
  ${field("期望交付物", "deliverables", source.deliverables || "", { textarea: true, rows: 2, required: true, placeholder: "例如：合同审阅意见书、律师函、起诉状" })}
  ${edit ? "" : `<label class="check-row"><input name="consent" type="checkbox" required> 我已核对内容，同意向平台认证律师公开该需求</label>`}
  <p class="form-error" role="alert"></p><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">${edit ? "保存修改" : "确认发布"}</button></div></form>`;
}

export function renderLawyerCards({ lawyers, user, canContact }) {
  const query = view.lawyerQuery.trim();
  const items = lawyers.filter((item) => (!view.lawyerField || item.field === view.lawyerField) && (!view.lawyerRegion || item.region === view.lawyerRegion) && (!query || [item.name, item.firm, item.field].some((text) => String(text || "").includes(query))));
  if (!items.length) return `<div class="no-result">${empty(lawyers.length ? "没有符合条件的律师" : "暂无认证律师", "", lawyers.length ? "试试放宽领域或地区" : "", "lawyer")}</div>`;
  return items.map((item) => `<article class="lawyer-card"><header>${avatar(item, "lg")}<div><h3>${esc(item.name)} <span class="verified" title="资质已审核">${icon("review")}</span></h3><small>${esc(item.firm)}</small></div></header><div class="chip-list"><span class="chip">${esc(item.field)}</span><span class="chip ghost">${icon("map")}${esc(item.region)}</span><span class="chip ghost">${esc(item.mode)}</span></div><div class="lawyer-stats">${stars(item.rating_avg, item.review_count)}<span>已完成 <b>${item.completed_orders ?? 0}</b> 单</span><span class="${item.available ? "online" : "offline"}">${item.available ? "可接单" : "暂停接单"}</span></div><footer>${canContact && item.id !== user.id ? button("open-chat", `${icon("message")} 在线咨询`, `data-peer="${esc(item.id)}"`, true) : ""}${canContact ? button("new-request", "发布需求") : ""}</footer></article>`).join("");
}

export function renderLawyerDirectory(context) {
  const select = (name, title, values) => `<label class="select-filter"><span class="sr-only">${title}</span><select data-request-filter="${name}"><option value="">${title}</option>${values.map((value) => `<option ${view[name] === value ? "selected" : ""}>${esc(value)}</option>`).join("")}</select></label>`;
  return `<div class="list-toolbar"><div class="toolbar-filters grow"><label class="search-input">${icon("search")}<span class="sr-only">搜索律师</span><input data-search="lawyers" value="${esc(view.lawyerQuery)}" placeholder="搜索律师姓名、律所或领域"></label>${select("lawyerField", "全部领域", fields)}${select("lawyerRegion", "全部地区", regions)}</div><span class="muted">仅展示资质审核通过且在有效期内的律师</span></div><div class="lawyer-grid" id="lawyer-cards">${renderLawyerCards(context)}</div>`;
}
