import test from "node:test";
import assert from "node:assert/strict";
import { seed, dispatch, actors, canDoc, evidence } from "./business.js";
const c = actors.client,
  l = actors.lawyer,
  a = actors.operator;
function contracted() {
  const db = seed();
  const o = dispatch(db, c, "accept-quote", { id: "Q1001" });
  dispatch(db, c, "start-sign", { id: o.contract });
  dispatch(db, l, "confirm-doc", { id: o.contract });
  dispatch(db, c, "confirm-doc", { id: o.contract });
  return { db, id: o.id };
}

test("报价、顺序会签、付款、交付与收悉形成完整订单闭环", () => {
  const { db, id } = contracted();
  assert.equal(db.orders.find((o) => o.id === id).status, "待支付");
  dispatch(db, c, "pay", { id, result: "success" });
  const doc = dispatch(db, l, "create-doc", {
    orderId: id,
    title: "交付意见",
    body: "已经核对的交付内容",
    type: "交付物",
    deadline: "2027-01-01",
  });
  dispatch(db, l, "deliver", { id, docId: doc.id });
  assert.equal(db.orders.find((o) => o.id === id).status, "待确认");
  dispatch(db, c, "receive", { id });
  assert.equal(db.orders.find((o) => o.id === id).status, "已完成");
  assert.equal(db.orders.find((o) => o.id === id).settlement, "待结算");
});
test("重复接受与付款不重复创建订单、不重复记账；付款失败保留重试路径", () => {
  const { db, id } = contracted();
  const count = db.orders.length;
  assert.equal(dispatch(db, c, "accept-quote", { id: "Q1001" }).id, id);
  assert.equal(db.orders.length, count);
  dispatch(db, c, "pay", { id, result: "fail" });
  assert.equal(db.orders.find((o) => o.id === id).status, "待支付");
  dispatch(db, c, "pay", { id, result: "success" });
  const ledgerCount = db.payments.length;
  dispatch(db, c, "pay", { id, result: "success" });
  assert.equal(db.payments.length, ledgerCount);
});
test("会签顺序和锁定版本禁止越级确认或直接修改", () => {
  const db = seed();
  const o = dispatch(db, c, "accept-quote", { id: "Q1001" });
  dispatch(db, c, "start-sign", { id: o.contract });
  assert.throws(
    () => dispatch(db, c, "confirm-doc", { id: o.contract }),
    /尚未轮到/,
  );
  dispatch(db, l, "confirm-doc", { id: o.contract });
  dispatch(db, c, "confirm-doc", { id: o.contract });
  assert.throws(
    () => dispatch(db, c, "save-version", { id: o.contract, body: "其他文字" }),
    /锁定/,
  );
});
test("恢复生成独立新版本并保留历史；无原因退回不污染状态", () => {
  const db = seed();
  dispatch(db, l, "save-version", { id: "D1001", body: "修改后的第二版" });
  dispatch(db, l, "restore-version", { id: "D1001", number: 1 });
  const d = db.docs.find((d) => d.id === "D1001");
  assert.equal(d.versions.length, 3);
  assert.equal(d.current, 3);
  assert.equal(d.versions[2].body, d.versions[0].body);
  dispatch(db, l, "start-sign", { id: d.id });
  const before = JSON.stringify(db);
  assert.throws(
    () => dispatch(db, l, "return-doc", { id: d.id, reason: "" }),
    /原因/,
  );
  assert.equal(JSON.stringify(db), before);
});
test("撤销访问后律师无法获取正文；运营存证导出只包含必要元数据", () => {
  const db = seed();
  dispatch(db, c, "access-doc", { id: "D1001", user: "L1", grant: false });
  const d = db.docs.find((d) => d.id === "D1001");
  assert.equal(canDoc(db, l, d), false);
  assert.equal(canDoc(db, a, d), false);
  assert.throws(
    () => dispatch(db, l, "comment", { id: d.id, text: "访问尝试" }),
    /未获得/,
  );
  const data = evidence(db, a, "O1001");
  assert.ok(
    data.documents.every((d) => d.versions.every((v) => !("body" in v))),
  );
  assert.equal("messages" in data.order, false);
});
test("摘要转需求需要明确授权且保持来源，未认证律师不能报价", () => {
  const db = seed();
  const s = dispatch(db, c, "session", {
    domain: "刑事",
    facts: "亲属已被采取强制措施，需要整理材料",
    region: "北京",
    time: "2026-10-01",
    goal: "联系律师",
    identity: "亲属",
    measure: "已采取",
  });
  assert.equal(s.risk, true);
  const p = {
    title: "律师服务需求",
    sourceSession: s.id,
    facts: s.facts,
    region: "北京",
    deadline: "2027-01-01",
    deliverables: "咨询意见",
    budget: 1000,
  };
  assert.throws(() => dispatch(db, c, "request", p), /授权/);
  const r = dispatch(db, c, "request", { ...p, consent: true });
  assert.equal(r.sourceSession, s.id);
  dispatch(db, a, "review-lawyer", {
    id: "L1",
    decision: "freeze",
    reason: "资质核对中",
  });
  assert.throws(
    () =>
      dispatch(db, l, "quote", {
        requestId: r.id,
        price: 1000,
        days: 1,
        scope: "咨询",
        deliverables: "意见",
        validUntil: "2027-01-01",
      }),
    /资质/,
  );
});
test("争议冻结结算，售后处理需要运营角色且重复处理被拒绝", () => {
  const db = seed();
  const issue = dispatch(db, c, "dispute", {
    id: "O1001",
    reason: "交付范围需要重新确认",
  });
  assert.equal(db.orders[0].settlement, "暂停结算");
  assert.throws(
    () =>
      dispatch(db, c, "resolve-case", {
        id: issue.id,
        decision: "resume",
        result: "恢复履约",
      }),
    /运营/,
  );
  dispatch(db, a, "resolve-case", {
    id: issue.id,
    decision: "resume",
    result: "双方已补充服务范围，恢复履约",
  });
  assert.equal(db.orders[0].status, "服务中");
  assert.throws(
    () =>
      dispatch(db, a, "resolve-case", {
        id: issue.id,
        decision: "resume",
        result: "重复处理",
      }),
    /已处理/,
  );
});
test("退款金额不得超过已付金额，完整退款关闭订单", () => {
  const db = seed();
  assert.throws(
    () =>
      dispatch(db, c, "refund", {
        id: "O1001",
        reason: "需要退款",
        amount: 1801,
      }),
    /超过/,
  );
  const issue = dispatch(db, c, "refund", {
    id: "O1001",
    reason: "双方同意取消服务",
    amount: 1800,
  });
  dispatch(db, a, "resolve-case", {
    id: issue.id,
    decision: "approve",
    result: "审核通过，模拟全额退款",
  });
  assert.equal(db.orders[0].status, "已关闭");
  assert.equal(db.orders[0].paymentStatus, "已退款");
});

test("法律模型咨询兼容旧数据，限制角色和空输入，保存材料与独立会话", () => {
  const db = seed();
  delete db.modelChats;
  const requestCount = db.requests.length;
  assert.throws(
    () => dispatch(db, l, "model-chat", { prompt: "合同材料核对" }),
    /当事人/,
  );
  assert.throws(
    () => dispatch(db, c, "model-chat", { prompt: " " }),
    /法律问题/,
  );
  const chat = dispatch(db, c, "model-chat", {
    prompt: "我想梳理采购合同的履行情况",
    topic: "合同问题",
    attachments: [{ name: "示例合同.pdf", size: 1000 }],
  });
  assert.equal(db.modelChats.length, 1);
  assert.equal(db.requests.length, requestCount);
  assert.equal(db.sessions.length, 0);
  assert.equal(chat.messages.length, 2);
  assert.equal(chat.messages[0].attachments[0].name, "示例合同.pdf");
  assert.match(chat.messages[1].text, /未读取附件/);
});
test("追问在同一咨询中保存，连续对话开关影响风险提示且不同当事人不能访问", () => {
  const db = seed();
  const chat = dispatch(db, c, "model-chat", {
    prompt: "收到亲属被拘留的通知，需要梳理材料",
    topic: "刑事问题",
  });
  dispatch(db, c, "model-message", {
    id: chat.id,
    prompt: "补充一下发生的具体时间",
    contextEnabled: true,
  });
  assert.equal(db.modelChats[0].messages[3].risk, true);
  dispatch(db, c, "model-message", {
    id: chat.id,
    prompt: "另外咨询一份普通合同的字段",
    topic: "合同问题",
    contextEnabled: false,
  });
  assert.equal(db.modelChats[0].messages[5].risk, false);
  assert.equal(db.modelChats[0].contextEnabled, false);
  assert.equal(db.modelChats.length, 1);
  const other = { ...c, id: "C2" };
  assert.throws(
    () =>
      dispatch(db, other, "model-message", {
        id: chat.id,
        prompt: "查看别人的记录",
      }),
    /无权/,
  );
});
test("咨询转需求保留所有用户提问与来源，并且发布前仍需明确授权", () => {
  const db = seed();
  const chat = dispatch(db, c, "model-chat", {
    prompt: "需要采购合同审阅服务",
    topic: "合同问题",
  });
  dispatch(db, c, "model-message", {
    id: chat.id,
    prompt: "另有关于交付时间的说明",
  });
  const s = dispatch(db, c, "model-summary", { id: chat.id });
  assert.equal(s.sourceChat, chat.id);
  assert.match(s.facts, /采购合同/);
  assert.match(s.facts, /交付时间/);
  assert.doesNotMatch(s.facts, /信息整理示例/);
  assert.equal(dispatch(db, c, "model-summary", { id: chat.id }).id, s.id);
  assert.equal(db.sessions.length, 1);
  const p = {
    sourceSession: s.id,
    title: "采购合同审阅",
    facts: s.facts,
    region: "北京",
    budget: 2000,
    deadline: "2027-01-01",
    deliverables: "审阅意见",
  };
  assert.throws(() => dispatch(db, c, "request", p), /授权/);
  const r = dispatch(db, c, "request", { ...p, consent: true });
  assert.equal(r.sourceSession, s.id);
});
test("模型反馈只能关联自身咨询的助手消息，无效反馈不会污染数据", () => {
  const db = seed();
  const chat = dispatch(db, c, "model-chat", {
    prompt: "整理劳动争议的基本信息",
    topic: "劳动争议",
  });
  const before = JSON.stringify(db);
  assert.throws(
    () =>
      dispatch(db, c, "model-feedback", {
        id: chat.id,
        value: "有用",
        index: 0,
      }),
    /模型回复/,
  );
  assert.equal(JSON.stringify(db), before);
  dispatch(db, c, "model-feedback", { id: chat.id, value: "有用", index: 1 });
  assert.equal(db.modelChats[0].feedbackByMessage[1], "有用");
  assert.throws(
    () =>
      dispatch(db, { ...c, id: "C2" }, "model-feedback", {
        id: chat.id,
        value: "无用",
        index: 1,
      }),
    /无权/,
  );
});
