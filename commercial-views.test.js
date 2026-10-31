import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderLawyerOnboarding } from "./account-view.js";
import { renderNotifications } from "./admin-view.js";
import { acceptQuoteBody, lawyerIncome, purchaseFormBody, renderHelp, renderLawyerProfile, renderMyServices, renderServiceCatalog } from "./market-view.js";
import { renderOrderDetail } from "./orders-view.js";
import { renderLawyerCards, renderRequestCards, renderRequestDetail, requestFormBody } from "./requests-view.js";

const client = { id: "C1", name: "陈先生", roles: ["client"] };
const lawyerUser = { id: "L1", name: "林律师", roles: ["client", "lawyer"] };
const lawyer = { id: "L1", name: "林律师", firm: "和信律师事务所", region: "北京", field: "合同纠纷", specialties: ["借贷纠纷"], bio: "执业十二年<script>", practice_years: 12, mode: "线上服务", available: true, can_take_orders: true, rating_avg: 4.5, review_count: 2, completed_orders: 3, expires_on: "2099-01-01", services: [{ id: "S1", lawyer_id: "L1", title: "合同审查", service_type: "合同审阅", field: "合同纠纷", description: "逐条审查合同风险", deliverables: "审查意见书", price: "399.00", days: 2, active: true, sold: 1 }], reviews: [{ author: "陈**", rating: 5, content: "专业", created_at: "2026-10-20T08:00:00" }] };
const request = (extra = {}) => ({ id: "R1", owner_id: "C1", title: "装修纠纷", domain: "民事", field: "合同纠纷", service_type: "律师函", region: "北京", budget: "1500", deadline: "2099-01-01", facts: "装修公司逾期未完工", deliverables: "律师函", visibility: "认证律师可见", status: "quoting", quote_count: 0, quotes: [], created_at: "2026-10-20T08:00:00", ...extra });
const order = (status, extra = {}) => ({ id: `O-${status}`, title: "订单", client_id: "C1", lawyer_id: "L1", client_name: "陈先生", lawyer_name: "林律师", price: "1000.00", paid: "1000.00", status, payment_status: "paid", settlement_status: "frozen", scope: "合同审阅", days: 3, created_at: "2026-10-20T08:00:00", updated_at: "2026-10-20T08:00:00", payments: [], deliveries: [], cases: [], ...extra });

test("每个界面按钮与表单都有对应的处理逻辑", () => {
  const views = ["app.js", "orders-view.js", "documents-view.js", "guide.js", "account-view.js", "auth-view.js", "request-attachments.js", "requests-view.js", "admin-view.js", "market-view.js"].map((name) => readFileSync(new URL(name, import.meta.url), "utf8")).join("\n");
  const app = readFileSync(new URL("app.js", import.meta.url), "utf8");
  const actions = new Set([...views.matchAll(/button\("([a-z-]+)"|data-action="([a-z-]+)"/g)].map((match) => match[1] || match[2]));
  const handled = new Set([...app.matchAll(/action === "([a-z-]+)"/g)].map((match) => match[1]));
  assert.deepEqual([...actions].filter((name) => !handled.has(name)), []);
  const forms = new Set([...views.matchAll(/data-form="([a-z-]+)"/g)].map((match) => match[1]));
  const submitted = new Set([...app.matchAll(/kind === "([a-z-]+)"/g)].map((match) => match[1]).concat(["login"]));
  assert.deepEqual([...forms].filter((name) => !submitted.has(name)), []);
});

test("需求：报价数、律师已报价标记、过期需求可重新开放、发布表单含附件", () => {
  assert.match(renderRequestCards({ requests: [request({ quote_count: 2 })], user: client, lawyerView: false }), /2 份报价/);
  assert.match(renderRequestCards({ requests: [request({ owner_id: null, quoted_by_me: true })], user: lawyerUser, lawyerView: true }), /已报价/);
  const expired = renderRequestDetail({ item: request({ status: "expired" }), user: client, lawyerCanQuote: false });
  assert.match(expired, /data-action="reopen-request"/);
  assert.match(expired, /律师无法继续报价/);
  const direct = renderRequestDetail({ item: request({ visibility: "定向委托" }), user: client, lawyerCanQuote: false });
  assert.match(direct, /定向委托/);
  assert.doesNotMatch(direct, /邀请律师报价|data-action="close-request"/);
  const quoteForm = renderRequestDetail({ item: request({ owner_id: "C9" }), user: lawyerUser, lawyerCanQuote: true, capabilities: { platform_fee_rate: 0.1 } });
  assert.match(quoteForm, /平台服务费 10%/);
  assert.match(requestFormBody({}), /data-request-files/);
  assert.doesNotMatch(requestFormBody({ edit: request({ version: 2 }) }), /data-request-files|name="consent"/);
});

test("律师主页与卡片：转义简介、展示套餐与评价、可邀请报价", () => {
  const cards = renderLawyerCards({ lawyers: [lawyer], user: client, canContact: true });
  assert.match(cards, /href="#\/lawyers\/L1"/);
  assert.match(cards, /执业 12 年/);
  assert.match(cards, /执业十二年&lt;script&gt;/);
  const profile = renderLawyerProfile({ lawyer, user: client, myRequests: [request()] });
  assert.match(profile, /data-action="purchase-service" data-id="S1"/);
  assert.match(profile, /data-action="invite-lawyer" data-id="L1"/);
  assert.match(profile, /陈\*\*/);
  assert.doesNotMatch(renderLawyerProfile({ lawyer, user: lawyerUser }), /data-action="purchase-service"/);
});

test("服务套餐：目录可购买、委托表单、律师管理与费率说明", () => {
  const services = [{ ...lawyer.services[0], lawyer: { id: "L1", name: "林律师", firm: "和信", region: "北京", rating_avg: null } }];
  assert.match(renderServiceCatalog({ services, user: client }), /立即委托/);
  assert.doesNotMatch(renderServiceCatalog({ services, user: lawyerUser }).split('id="service-cards"')[1], /data-action="purchase-service"/);
  const form = purchaseFormBody(services[0], { delivery_auto_accept_days: 7 });
  assert.match(form, /data-form="purchase-service" data-id="S1"/);
  assert.match(form, /name="facts"[\s\S]*name="region"/);
  assert.match(form, /7 天内未处理将自动确认验收/);
  assert.match(renderMyServices({ services, profile: { status: "approved", available: true }, capabilities: { platform_fee_rate: 0.1 } }), /10%[\s\S]*data-action="toggle-service"/);
  assert.match(renderMyServices({ services: [], profile: { status: "pending" } }), /资质审核通过后即可上架服务/);
  assert.match(acceptQuoteBody({ id: "Q1", price: "800", days: 3, scope: "审阅", deliverables: "意见", lawyer: { name: "林律师" } }), /data-action="confirm-accept-quote" data-id="Q1"/);
});

test("订单：逾期提醒、自动验收期限、结算收入与售后期", () => {
  const capabilities = { platform_fee_rate: 0.1, after_sales_window_days: 15 };
  const context = (item, user) => ({ item, user, capabilities, documents: [], badge: (value) => value, labels: {} });
  assert.match(renderOrderDetail(context(order("service", { due_date: "2026-01-01", overdue: true }), client)), /next-action alert[\s\S]*律师交付已逾期/);
  assert.match(renderOrderDetail(context(order("pending_receipt", { auto_accept_at: "2026-11-07T08:00:00Z" }), client)), /前未处理将自动确认验收/);
  const settled = renderOrderDetail(context(order("completed", { settlement_status: "settled", settled_at: "2026-11-20T08:00:00Z", platform_fee: "100.00" }), lawyerUser));
  assert.match(settled, /服务收入 ¥900\.00/);
  assert.doesNotMatch(settled, /data-action="after-sales-modal"/);
  assert.match(renderOrderDetail(context(order("completed", { settlement_status: "pending", after_sales_until: "2026-11-15T08:00:00Z" }), client)), /售后期至/);
  assert.deepEqual(lawyerIncome([order("completed", { settlement_status: "settled", platform_fee: "100.00" }), order("completed", { id: "O2", settlement_status: "pending" })], lawyerUser, 0.1), { settled: 900, pending: 900 });
});

test("帮助页、通知跳转与律师资料页状态", () => {
  const help = renderHelp({ delivery_auto_accept_days: 5, after_sales_window_days: 10, platform_fee_rate: 0.08 });
  assert.match(help, /5 天未处理系统自动确认/);
  assert.match(help, /10 天售后期/);
  assert.match(help, /8%/);
  assert.match(renderNotifications({ notifications: [{ id: "N1", title: "订单已超过约定交付期", body: "请尽快交付", object_type: "order_overdue", object_id: "O1", read_at: null, created_at: "2026-10-20T08:00:00" }] }), /href="#\/order\/O1" data-read="N1"/);
  const certified = renderLawyerOnboarding({ applications: [], operator: false, profile: { status: "approved", expires_on: "2099-01-01" } });
  assert.match(certified, /你已完成律师入驻/);
  assert.match(certified, /<details class="reapply">/);
  assert.match(renderLawyerOnboarding({ applications: [], operator: false, profile: { status: "approved", expires_on: "2000-01-01" } }), /执业证已过期/);
});
