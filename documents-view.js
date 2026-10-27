import { docTypes, label, statusTone } from "./labels.js";
import { ago, avatar, button, date, empty, esc, field, icon, status } from "./ui.js";

const badge = (value) => status(label(value), statusTone(value));

export const documentTemplates = {
  blank: ["空白文书", ""],
  contract: ["法律服务合同", "法律服务合同\n\n委托方（甲方）：\n受托方（乙方）：\n\n一、服务内容\n\n二、服务期限\n\n三、服务费用及支付方式\n\n四、双方权利与义务\n\n五、保密条款\n\n六、违约责任\n\n七、争议解决\n\n甲方（签字）：            乙方（签字）：\n日期：                    日期："],
  letter: ["律师函", "律师函\n\n致：\n\n本所接受委托人的委托，就下列事宜致函贵方：\n\n一、基本事实\n\n二、法律分析\n\n三、委托人要求\n\n请贵方于收到本函之日起    日内予以回复。\n\n律师事务所：\n承办律师：\n日期："],
  complaint: ["起诉状框架", "民事起诉状\n\n原告：\n被告：\n\n诉讼请求：\n1.\n2.\n\n事实与理由：\n\n证据和证据来源：\n\n此致\n        人民法院\n\n具状人：\n日期："],
};
const filters = [["all", "全部", null], ["draft", "编辑中", ["draft", "returned"]], ["signing", "会签中", ["signing"]], ["confirmed", "已确认", ["confirmed"]], ["archived", "已归档", ["archived"]]];
const view = { filter: "all", query: "", tab: "workflow" };

export function setDocumentFilter(value) { view.filter = value; }
export function setDocumentQuery(value) { view.query = value; }
export function setDocumentTab(value) { view.tab = value; }

const awaitingMe = (doc, user) => (doc.workflow || []).some((task) => task.assignee_id === user.id && task.status === "pending" && task.version === doc.locked_version);
const nameOf = (doc, id) => (doc.member_profiles || []).find((person) => person.id === id)?.name || "参与人";

export function renderDocumentCards({ documents, user }) {
  const statuses = filters.find(([key]) => key === view.filter)?.[2];
  const query = view.query.trim().toLowerCase();
  const items = documents.filter((doc) => (!statuses || statuses.includes(doc.status)) && (!query || doc.title.toLowerCase().includes(query)));
  if (!items.length) return `<div class="no-result">${empty(documents.length ? "没有符合条件的文书" : "暂无文书", "", documents.length ? "调整筛选条件后再试" : "订单支付后即可在此起草合同、法律文书与交付物", "doc")}</div>`;
  return items.map((doc) => `<a class="item-card doc-card" href="#/doc/${esc(doc.id)}"><header><span class="doc-icon">${icon("doc")}</span><div class="grow"><h3>${esc(doc.title)}</h3><div class="meta"><span class="chip">${esc(docTypes[doc.doc_type] || "文书")}</span><span>v${doc.current_version}</span><span>${ago(doc.created_at)}</span></div></div></header><div class="meta"><span>${icon("account")}${(doc.member_profiles || []).map((person) => esc(person.name)).join("、") || "—"}</span></div><footer>${badge(doc.status)}${awaitingMe(doc, user) ? '<span class="status warning">待我会签</span>' : ""}</footer></a>`).join("");
}

export function renderDocumentList(context) {
  const { documents, user } = context;
  const pending = documents.filter((doc) => awaitingMe(doc, user));
  return `${pending.length ? `<div class="todo-strip" aria-label="待我处理">${pending.map((doc) => `<a href="#/doc/${esc(doc.id)}">${icon("review")}<span><b>${esc(doc.title)}</b>待你会签 v${doc.locked_version}</span>${icon("arrow")}</a>`).join("")}</div>` : ""}<div class="list-toolbar"><div class="pill-tabs" role="tablist">${filters.map(([key, title, statuses]) => `<button type="button" role="tab" aria-selected="${view.filter === key}" class="${view.filter === key ? "active" : ""}" data-action="document-filter" data-value="${key}">${title}<em>${statuses ? documents.filter((doc) => statuses.includes(doc.status)).length : documents.length}</em></button>`).join("")}</div><label class="search-input">${icon("search")}<span class="sr-only">搜索文书</span><input data-search="documents" value="${esc(view.query)}" placeholder="搜索文书标题"></label></div><div class="card-grid" id="document-cards">${renderDocumentCards(context)}</div>`;
}

export function newDocumentBody(orders, preselected = "") {
  if (!orders.length) return `<div class="info-callout warn">${icon("info")}<span>暂无可创建文书的订单。订单完成支付、进入服务后即可为其新建文书。</span></div><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">知道了</button></div>`;
  return `<form data-form="document"><label class="field"><span>关联订单 <b>*</b></span><select name="order_id">${orders.map((item) => `<option value="${esc(item.id)}" ${item.id === preselected ? "selected" : ""}>${esc(item.title)}</option>`).join("")}</select></label><div class="form-grid">${field("文书标题", "title", "", { required: true, placeholder: "例如：合同审阅意见书" })}${field("文书类型", "doc_type", "legal_document", { options: [["legal_document", "法律文书"], ["delivery", "交付物"], ["attachment", "附件材料"]] })}<label class="field"><span>正文模板</span><select data-template-select>${Object.entries(documentTemplates).map(([key, [title]]) => `<option value="${key}">${title}</option>`).join("")}</select></label></div>${field("正文", "body", "", { textarea: true, rows: 12, required: true, placeholder: "可选择模板快速填充，或直接撰写正文" })}<p class="muted">创建后订单双方自动获得访问权限，律师与创建人可编辑；每次保存都会生成新版本并留存指纹。</p><p class="form-error" role="alert"></p><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">创建文书</button></div></form>`;
}

export function workflowModalBody(doc) {
  const people = doc.members.map((id) => ({ id, name: nameOf(doc, id) }));
  return `<form data-form="workflow"><p class="muted">勾选参与会签的成员并调整顺序。发起后当前版本 v${doc.current_version} 将被锁定，成员依次确认；任一成员退回即解锁修改。</p><ol class="member-picker" data-member-picker>${people.map((person, index) => `<li><span class="order-no">${index + 1}</span><label class="check-row"><input type="checkbox" data-member value="${esc(person.id)}" checked> ${esc(person.name)}</label><span class="moves"><button type="button" data-action="picker-move" data-dir="-1" aria-label="上移">${icon("up")}</button><button type="button" data-action="picker-move" data-dir="1" aria-label="下移">${icon("down")}</button></span></li>`).join("")}</ol><p class="form-error" role="alert"></p><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn primary" type="submit">锁定当前版本并开始会签</button></div></form>`;
}

export function refreshPicker(list) {
  let index = 0;
  list.querySelectorAll("li").forEach((item) => {
    const checked = item.querySelector("[data-member]").checked;
    item.classList.toggle("off", !checked);
    item.querySelector(".order-no").textContent = checked ? ++index : "–";
  });
}

export function renderDocumentDetail({ item, user, operator }) {
  if (!item) return empty("未找到文书");
  const version = item.versions.find((entry) => entry.number === item.current_version);
  const editable = !operator && item.can_edit;
  const unlocked = ["draft", "returned"].includes(item.status);
  const pending = awaitingMe(item, user);
  const owner = item.owner_id === user.id;
  const openComments = (item.comments || []).filter((entry) => !entry.resolved).length;
  const tabs = [["workflow", "会签"], ["versions", "版本"], ["comments", `批注${openComments ? `<em>${openComments}</em>` : ""}`], ["files", "附件"], ["members", "参与人"]];
  const panel = (key, html) => `<div class="tab-panel" data-tab-panel="${key}" ${view.tab === key ? "" : "hidden"}>${html}</div>`;
  const returned = item.workflow.filter((task) => task.status === "returned" && task.reason).at(-1);
  return `<a class="back-link" href="#/docs">${icon("back")} 返回文书中心</a>
  <div class="doc-layout"><section class="surface"><div class="doc-toolbar"><div><h1 class="doc-title">${esc(item.title)}</h1><div class="badges">${badge(item.status)}<span class="chip">${esc(docTypes[item.doc_type] || "文书")}</span><span class="version-pill">v${item.current_version}</span>${item.locked_version ? `<span class="muted">锁定版本 v${item.locked_version}</span>` : ""}<a class="link" href="#/order/${esc(item.order_id)}">查看订单 ${icon("arrow")}</a></div></div><div class="badges">${owner && item.status === "signing" ? button("withdraw-workflow", "撤回会签", "", "ghost") : ""}${button("refresh", `${icon("history")} 刷新`, "", "ghost")}</div></div>
    ${returned && item.status === "returned" ? `<div class="info-callout warn">${icon("info")}<span>文书已被退回：${esc(returned.reason)}</span></div>` : ""}
    ${pending ? `<div class="next-action"><div class="next-body"><h3>轮到你会签</h3><p>请审阅锁定版本 v${item.locked_version}，确认无误后点击确认，或退回并说明修改意见。</p></div><div class="actions">${button("confirm-document", "确认当前锁定版本", "", true)}${button("return-document", "退回修改")}</div></div>` : ""}
    ${version?.body !== null && version?.body !== undefined ? `<form data-form="version"><input type="hidden" name="base_version" value="${item.current_version}"><div class="paper"><label class="sr-only" for="doc-body">文书正文</label><textarea id="doc-body" name="body" required ${editable && unlocked ? "" : "readonly"}>${esc(version.body)}</textarea></div><div class="paper-actions">${editable && unlocked ? `<span class="muted">保存后生成 v${item.current_version + 1}</span><button class="btn primary" type="submit">保存新版本</button>${button("workflow-modal", "发起顺序会签")}` : `<span class="muted">${icon("lock")} ${!editable ? "你仅有查看权限，可在右侧添加批注" : item.status === "signing" ? "会签中的文书已锁定，退回或撤回会签后可修改" : "已确认的文书已锁定"}</span>`}</div><p class="form-error" role="alert"></p></form>` : `<div class="info-callout">${icon("lock")}<span>运营仅可查看业务元数据，不直接读取正文；本次查看已记录审计。</span></div>`}
  </section>
  <aside class="surface side-panel"><div class="pill-tabs" role="tablist">${tabs.map(([key, title]) => `<button type="button" role="tab" aria-selected="${view.tab === key}" class="${view.tab === key ? "active" : ""}" data-action="doc-tab" data-tab="${key}">${title}</button>`).join("")}</div>
    ${panel("workflow", item.workflow.length ? `<ol class="sign-steps">${item.workflow.map((task) => `<li>${avatar({ name: nameOf(item, task.assignee_id) }, "sm")}<div><b>${task.sequence}. ${esc(nameOf(item, task.assignee_id))}</b><small>v${task.version}${task.reason ? ` · ${esc(task.reason)}` : ""}</small></div>${badge(task.status)}</li>`).join("")}</ol>` : empty("尚未发起会签"))}
    ${panel("versions", `<div class="mini-list">${item.versions.slice().reverse().map((entry) => `<div class="mini-row"><span class="grow"><b>v${entry.number}</b> ${entry.number === item.current_version ? '<span class="chip">当前</span>' : ""}<small>${esc(nameOf(item, entry.author_id))} · ${date(entry.created_at)}</small><code class="hash" title="内容指纹">${esc((entry.body_hash || "").slice(0, 12))}</code></span><span class="badges">${!operator ? button("export-version", icon("download"), `data-version="${entry.number}" title="导出 v${entry.number}" aria-label="导出 v${entry.number}"`, "icon-only") : ""}${editable && unlocked && entry.number !== item.current_version ? button("restore-version", "恢复", `data-version="${entry.number}"`, "sm") : ""}</span></div>`).join("")}</div><p class="muted">每个版本均保存内容指纹（SHA-256），可用于存证核验。</p>`)}
    ${panel("members", `<div>${item.members.map((member) => `<div class="party">${avatar({ name: nameOf(item, member) }, "sm")}<div><b>${esc(nameOf(item, member))}</b><small>${member === item.owner_id ? "创建人" : "参与人"}${member === user.id ? "（我）" : ""}</small></div>${item.owner_id === user.id && member !== user.id ? `<span class="badges">${button("revoke-member", "撤销授权", `data-id="${esc(member)}"`)}</span>` : ""}</div>`).join("")}</div>`)}
    ${panel("files", `${(item.files || []).length ? `<div class="mini-list">${item.files.map((file) => `<div class="mini-row"><span>${icon("attach")} ${esc(file.name)}</span>${button("download-file", "下载", `data-id="${esc(file.id)}" data-name="${esc(file.name)}"`)}</div>`).join("")}</div>` : empty("暂无附件")}${editable ? `<form data-form="document-file"><label class="field"><span>上传附件（≤50MB）</span><input name="file" type="file" required></label><p class="form-error" role="alert"></p><button class="btn primary" type="submit">上传附件</button></form>` : ""}`)}
    ${panel("comments", `${(item.comments || []).length ? item.comments.map((entry) => `<div class="comment-item ${entry.resolved ? "resolved" : ""}"><div class="comment-head">${avatar({ name: entry.author_name }, "sm")}<b>${esc(entry.author_name || "参与人")}</b><small>v${entry.version} · ${ago(entry.created_at)}</small>${entry.resolved ? '<span class="status success">已解决</span>' : (entry.author_id === user.id || owner) && !operator ? button("resolve-comment", "标记解决", `data-id="${esc(entry.id)}"`, "sm ghost") : ""}</div><p>${esc(entry.text)}</p></div>`).join("") : empty("暂无批注", "", "", "message")}${!operator ? `<form data-form="comment">${field("新增批注", "text", "", { textarea: true, required: true, placeholder: `针对 v${item.current_version} 的修改意见` })}<p class="form-error" role="alert"></p><button class="btn primary" type="submit">提交批注</button></form>` : ""}`)}
  </aside></div>`;
}
