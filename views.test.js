import assert from "node:assert/strict";
import test from "node:test";
import { renderAccount, renderLawyerOnboarding } from "./account-view.js";
import { renderAuthPage } from "./auth-view.js";
import { renderDocumentDetail, renderDocumentList, workflowModalBody } from "./documents-view.js";
import { renderWorkbench } from "./guide.js";
import { renderOrderDetail, renderOrderList, setOrderFilter, setOrderQuery } from "./orders-view.js";
import { avatar } from "./ui.js";

const badge = (value) => `<span class="status">${value}</span>`;
const client = { id: "C1", name: "陈先生", email: "client@example.com", roles: ["client"], avatar: null };
const lawyer = { id: "L1", name: "林律师", email: "lawyer@example.com", roles: ["client", "lawyer"] };
const order = (status, extra = {}) => ({ id: `O-${status}`, title: `订单${status}`, client_id: "C1", lawyer_id: "L1", client_name: "陈先生", lawyer_name: "林律师", price: "1800.00", paid: status === "pending_payment" ? "0" : "1800.00", status, payment_status: status === "pending_payment" ? "unpaid" : "paid", settlement_status: "frozen", scope: "合同审阅", created_at: "2026-10-20T08:00:00", updated_at: "2026-10-20T08:00:00", payments: [], deliveries: [], cases: [], ...extra });
const doc = { id: "D1", order_id: "O1", owner_id: "L1", title: "审阅意见书", status: "signing", current_version: 2, locked_version: 2, members: ["L1", "C1"], member_profiles: [{ id: "L1", name: "林律师" }, { id: "C1", name: "陈先生" }], created_at: "2026-10-20T08:00:00", versions: [{ number: 1, author_id: "L1", body: null, created_at: "2026-10-20T08:00:00" }, { number: 2, author_id: "L1", body: "正文<script>", created_at: "2026-10-20T09:00:00" }], workflow: [{ sequence: 1, assignee_id: "L1", version: 2, status: "confirmed", reason: "" }, { sequence: 2, assignee_id: "C1", version: 2, status: "pending", reason: "" }], comments: [], files: [], can_edit: true };

test("登录页左侧宣传、右侧表单，注册保留安全问答字段", () => {
  const login = renderAuthPage(false);
  assert.match(login, /auth-brand[\s\S]*auth-panel/);
  assert.match(login, /data-form="login"/);
  const register = renderAuthPage(true);
  for (const name of ["email", "name", "password", "registration_intent", "challenge_answer", "challenge_id"]) assert.match(register, new RegExp(`name="${name}"`));
  assert.match(register, /id="registration-question"/);
});

test("工作台按视图展示用户/律师指导与待办", () => {
  const state = { consultations: [], requests: [], orders: [order("pending_payment"), order("pending_receipt")], documents: [doc] };
  const html = renderWorkbench({ state, user: client, viewRole: "client", roleName: "当事人", unreadChats: 3 });
  assert.match(html, /用户使用指导/);
  assert.match(html, /订单待支付/);
  assert.match(html, /交付待确认收悉/);
  assert.match(html, /文书待你会签/);
  assert.match(html, /3<\/b> 条未读/);
  assert.match(renderWorkbench({ state, user: lawyer, viewRole: "lawyer", roleName: "律师", unreadChats: 0 }), /律师使用指导/);
});

test("订单列表按状态筛选与搜索，详情给出当前角色的下一步", () => {
  const orders = ["pending_payment", "service", "pending_receipt", "completed", "disputed"].map((value) => order(value));
  setOrderFilter("service");
  assert.equal((renderOrderList({ orders, user: client, badge }).match(/class="item-card"/g) || []).length, 1);
  setOrderFilter("all");
  setOrderQuery("completed");
  assert.match(renderOrderList({ orders, user: client, badge }), /订单completed/);
  setOrderQuery("");
  const capabilities = { payments_enabled: true, payment_simulation_enabled: true };
  const context = (item, user) => ({ item, user, capabilities, documents: [], badge, labels: {} });
  assert.match(renderOrderDetail(context(order("pending_payment"), client)), /data-action="pay"/);
  const payment = { id: "P1", provider: "stub", status: "created", amount: "1800.00", client_params: { qr_svg_base64: "PHN2Zz4=" } };
  const simulation = renderOrderDetail(context(order("pending_payment", { payments: [payment] }), client));
  assert.match(simulation, /data-action="simulate-payment" data-id="P1"/);
  assert.doesNotMatch(simulation, /data-action="pay"/);
  assert.match(renderOrderDetail(context(order("service"), lawyer)), /data-action="delivery-modal"/);
  assert.match(renderOrderDetail(context(order("pending_receipt"), client)), /data-action="accept-delivery"[\s\S]*data-action="return-delivery"/);
  assert.match(renderOrderDetail(context(order("disputed"), client)), /next-action alert/);
  assert.match(renderOrderDetail(context(order("service"), client)), /data-action="open-chat" data-peer="L1" data-order="O-service"/);
});

test("文书详情转义正文、展示成员姓名与会签操作", () => {
  const html = renderDocumentDetail({ item: doc, user: client, badge, operator: false });
  assert.match(html, /正文&lt;script&gt;/);
  assert.match(html, /2\. 陈先生/);
  assert.match(html, /data-action="confirm-document"/);
  assert.match(html, /readonly/);
  assert.match(renderDocumentList({ documents: [doc], user: client, badge }), /待你确认 v2/);
  assert.match(workflowModalBody(doc), /value="L1" checked> 林律师[\s\S]*value="C1" checked> 陈先生/);
  assert.match(renderDocumentDetail({ item: { ...doc, versions: [{ ...doc.versions[1], body: null }] }, user: client, badge, operator: true }), /运营仅可查看业务元数据/);
});

test("账号页包含头像上传与修改密码，入驻页包含资质申请", () => {
  const html = renderAccount({ user: { ...client, avatar: "data:image/jpeg;base64,AAAA" }, roleNames: { client: "当事人" } });
  assert.match(html, /id="avatar-input"/);
  assert.match(html, /data-action="avatar-remove"/);
  assert.match(html, /data-form="password"/);
  assert.match(renderLawyerOnboarding({ applications: [], badge, operator: false }), /data-form="lawyer-application"/);
  assert.doesNotMatch(renderLawyerOnboarding({ applications: [], badge, operator: true }), /data-form="lawyer-application"/);
});

test("头像只渲染受信任的图片数据地址", () => {
  assert.match(avatar({ name: "陈先生", avatar: "data:image/png;base64,AAAA" }), /<img src="data:image\/png;base64,AAAA"/);
  assert.doesNotMatch(avatar({ name: "x", avatar: "javascript:alert(1)" }), /<img/);
  assert.match(avatar({ name: "林律师" }), />林</);
});

test("实时交流：会话列表、未读角标与空状态", async () => {
  globalThis.document ??= { addEventListener() {}, querySelector() { return null; }, visibilityState: "visible" };
  globalThis.location ??= { hash: "#/home" };
  const { createChat } = await import("./chat.js");
  const original = globalThis.fetch;
  let badgeCount = -1;
  try {
    const { setSession } = await import("./auth-state.js");
    setSession({ access_token: "t", user: client });
    globalThis.fetch = async (endpoint) => {
      if (endpoint === "/api/v1/chats") return new Response(JSON.stringify([{ id: "K1", my_side: "client", order_id: null, last_message_at: "2026-10-20T08:00:00", unread: 2, peer: { id: "L1", name: "林律师", avatar: null, side: "lawyer" }, last_message: { id: "m1", conversation_id: "K1", sender_id: "L1", text: "您好<b>", created_at: "2026-10-20T08:00:00" } }, { id: "K2", my_side: "client", order_id: null, last_message_at: "2026-10-19T08:00:00", unread: 0, peer: { id: "L2", name: "周律师", avatar: null, side: "lawyer" }, last_message: { id: "m2", conversation_id: "K2", sender_id: "C1", text: "", attachment: { file_id: "F1", name: "合同.pdf", size: 2048 }, created_at: "2026-10-19T08:00:00" } }]), { status: 200 });
      return new Promise(() => {});
    };
    const chat = createChat({ getUser: () => client, notify() {}, navigate() {}, onBadge: (count) => { badgeCount = count; } });
    assert.match(chat.render({ id: "" }), /暂无会话/);
    chat.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(badgeCount, 2);
    const html = chat.render({ id: "" });
    assert.match(html, /林律师<span class="role-tag">律师/);
    assert.match(html, /您好&lt;b&gt;/);
    assert.match(html, /class="unread">2</);
    assert.match(html, /我：\[文件\] 合同\.pdf/);
    const thread = chat.render({ id: "K1" });
    assert.match(thread, /id="chat-composer"/);
    assert.match(thread, /data-chat-attach/);
    assert.match(thread, /accept="\.pdf,\.doc,\.docx,\.txt,\.png,\.jpg,\.jpeg"/);
    chat.stop();
  } finally { globalThis.fetch = original; }
});
