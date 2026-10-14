export const roles = { client: "当事人", lawyer: "律师", operator: "运营" };
export const actors = {
  client: { id: "C1", name: "当事人 · 陈先生", role: "client" },
  lawyer: { id: "L1", name: "律师 · 林律师", role: "lawyer" },
  operator: { id: "A1", name: "运营 · 审核员", role: "operator" },
};
export const serviceTypes = [
  "法律咨询",
  "合同审阅",
  "法律文书起草",
  "合同与文书协作",
];
export const fields = [
  "合同纠纷",
  "劳动争议",
  "婚姻家事",
  "侵权责任",
  "公司商事",
  "交通事故",
  "借贷纠纷",
  "刑事案件",
];
const future = (days) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const id = (prefix) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const requireThat = (ok, message) => {
  if (!ok) throw new Error(message);
};
const get = (items, target, label) => {
  const item = items.find((x) => x.id === target);
  requireThat(item, `${label}不存在`);
  return item;
};
const positive = (value, label) => {
  const n = Number(value);
  requireThat(Number.isFinite(n) && n > 0, `${label}需大于0`);
  return n;
};
const reason = (value) => {
  requireThat(
    String(value || "").trim().length >= 2,
    "请填写至少2字的原因或处理意见",
  );
  return String(value).trim();
};
function modelAnswer(prompt, topic) {
  const urgent = /拘留|羁押|逮捕|传唤|强制措施|时效|转移财产/.test(prompt);
  const checkpoints = {
    合同问题: "合同全文、签订与履行时间、付款情况、双方沟通和约定的交付物。",
    劳动争议: "在职时间、劳动合同、工资记录、相关通知和希望解决的事项。",
    婚姻家事: "涉及的家庭关系、事件经过、财产资料和需要核实的事实。",
    公司商事: "主体和股东信息、章程或协议、通知与会议记录、争议的具体事项。",
    刑事问题: "涉案身份、事件时间与地区、是否已采取强制措施以及已有通知材料。",
    综合咨询: "事件经过、关键日期、涉及主体、已有材料和具体诉求。",
  };
  const text = `## ${topic} · 信息整理示例\n以下内容演示咨询回复的组织方式，尚未调用真实法律模型，也未读取附件。\n\n## 1. 待核实的信息\n${checkpoints[topic] || checkpoints["综合咨询"]}\n\n## 2. 把问题拆开\n事实：哪些内容已经有材料支持？\n争议：各方在哪些事项上存在分歧？\n目标：希望咨询、审阅材料，还是起草文书？\n\n## 3. 下一步工作区\n继续补充事实，或点击“转为服务需求”，在确认公开范围后联系律师。\n\n本地演示内容仅供界面体验，不构成针对问题的法律意见。`;
  return { text, risk: urgent };
}
export function seed() {
  const created = now();
  return {
    schema: 1,
    sessions: [],
    modelChats: [],
    requests: [
      {
        id: "R1001",
        owner: "C1",
        title: "采购合同审阅与修改",
        domain: "民事",
        field: "合同纠纷",
        type: "合同审阅",
        facts: "需要审阅服务范围、付款与交付条款，整理修改意见。",
        region: "北京",
        budget: 2500,
        deadline: future(7),
        deliverables: "审阅意见及修改后的合同",
        visibility: "认证律师可见",
        consent: true,
        status: "待报价",
        created,
      },
      {
        id: "R1002",
        owner: "C1",
        title: "劳动争议文书协作",
        domain: "民事",
        field: "劳动争议",
        type: "法律文书起草",
        facts: "整理事件经过与材料，完成文书初稿及修改。",
        region: "上海",
        budget: 1800,
        deadline: future(5),
        deliverables: "文书初稿、最终确认稿",
        visibility: "指定律师可见",
        consent: true,
        status: "已下单",
        created,
      },
    ],
    quotes: [
      {
        id: "Q1001",
        requestId: "R1001",
        lawyer: "L1",
        scope: "合同文本审阅、一次沟通、两轮修改",
        deliverables: "审阅意见和合同修改稿",
        price: 1800,
        days: 3,
        validUntil: future(5),
        status: "有效",
        created,
      },
      {
        id: "Q1002",
        requestId: "R1001",
        lawyer: "L2",
        scope: "条款核对、修改意见、一次线上沟通",
        deliverables: "书面审阅意见",
        price: 2200,
        days: 2,
        validUntil: future(5),
        status: "有效",
        created,
      },
    ],
    lawyers: [
      {
        id: "L1",
        name: "林律师",
        firm: "和信律师事务所",
        region: "北京",
        field: "合同纠纷",
        mode: "线上服务",
        price: 1800,
        status: "已认证",
        available: true,
        years: 8,
        license: "示例执业证 · 末四位1028",
        expires: future(365),
      },
      {
        id: "L2",
        name: "周律师",
        firm: "致远律师事务所",
        region: "上海",
        field: "劳动争议",
        mode: "线上服务",
        price: 2200,
        status: "已认证",
        available: true,
        years: 6,
        license: "示例执业证 · 末四位2086",
        expires: future(240),
      },
      {
        id: "L3",
        name: "王律师",
        firm: "明正律师事务所",
        region: "广州",
        field: "刑事案件",
        mode: "预约沟通",
        price: 3000,
        status: "待审核",
        available: false,
        years: 5,
        license: "示例执业证 · 待核验",
        expires: future(200),
      },
    ],
    orders: [
      {
        id: "O1001",
        requestId: "R1002",
        quoteId: "Q-SEED",
        client: "C1",
        lawyer: "L1",
        title: "劳动争议文书协作",
        scope: "文书初稿与两轮修改",
        deliverables: "文书初稿、最终确认稿",
        price: 1800,
        status: "服务中",
        paid: 1800,
        paymentStatus: "已支付",
        contract: "D1000",
        delivery: [],
        settlement: "未结算",
        messages: [],
        created,
      },
    ],
    docs: [
      {
        id: "D1000",
        owner: "C1",
        orderId: "O1001",
        title: "法律服务合同",
        type: "服务合同",
        status: "已确认",
        locked: true,
        members: ["C1", "L1"],
        deadline: future(5),
        versions: [
          {
            number: 1,
            body: "法律服务合同（示例）\n委托方：陈先生\n服务方：林律师\n服务范围：文书初稿与两轮修改\n费用：1800元\n交付物：文书初稿、最终确认稿\n其余条款由双方核实后约定。",
            author: "示例记录",
            created,
          },
        ],
        current: 1,
        nodes: [
          { user: "L1", status: "已确认" },
          { user: "C1", status: "已确认" },
        ],
        comments: [],
        created,
      },
      {
        id: "D1001",
        owner: "L1",
        orderId: "O1001",
        title: "文书初稿",
        type: "法律文书",
        status: "草稿",
        locked: false,
        members: ["C1", "L1"],
        deadline: future(5),
        versions: [
          {
            number: 1,
            body: "文书初稿（示例）\n一、当事人信息\n[待补充]\n二、事实经过\n[根据核实后的材料填写]\n三、请求事项\n[待律师与当事人确认]\n四、附件材料\n[证据清单]",
            author: "林律师",
            created,
          },
        ],
        current: 1,
        nodes: [],
        comments: [],
        created,
      },
    ],
    payments: [
      {
        id: "PAY-SEED",
        orderId: "O1001",
        amount: 1800,
        status: "成功",
        created,
      },
    ],
    cases: [],
    audit: [
      {
        id: "LOG-SEED",
        action: "示例订单建立",
        object: "O1001",
        actor: "系统示例",
        role: "system",
        detail: "演示数据，未发生真实支付或签署",
        created,
      },
    ],
    notifications: [],
    profile: {
      client: {
        name: "陈先生",
        identity: "待实名认证",
        enterprise: "个人用户",
      },
      lawyer: { name: "林律师" },
      operator: { name: "审核员" },
    },
    settings: {
      fields: [...fields],
      services: [...serviceTypes],
      risk: "存在紧急事项或强制措施时，请优先联系人工律师；问答仅提供一般信息。",
    },
  };
}
export function canOrder(db, actor, order) {
  return (
    actor.role === "operator" ||
    order.client === actor.id ||
    order.lawyer === actor.id
  );
}
export function canDoc(db, actor, doc) {
  if (actor.role === "operator") return false;
  if (
    actor.role === "lawyer" &&
    db.lawyers.find((l) => l.id === actor.id)?.status !== "已认证"
  )
    return false;
  return doc.members.includes(actor.id);
}
export function log(db, actor, action, object, detail = "") {
  db.audit.unshift({
    id: id("LOG"),
    action,
    object,
    actor: actor.name,
    role: actor.role,
    detail,
    created: now(),
  });
}
function ownedOrder(db, actor, target) {
  const o = get(db.orders, target, "订单");
  requireThat(canOrder(db, actor, o), "无权访问此订单");
  return o;
}
function ownedDoc(db, actor, target) {
  const d = get(db.docs, target, "文书");
  requireThat(canDoc(db, actor, d), "您未获得此文书的访问授权");
  return d;
}
function lawyerReady(db, actor) {
  requireThat(actor.role === "lawyer", "此操作由律师完成");
  const l = get(db.lawyers, actor.id, "律师");
  requireThat(
    l.status === "已认证" && l.available && l.expires >= now().slice(0, 10),
    "资质未通过、已过期或已暂停接单",
  );
}
function clientOrder(db, actor, target) {
  const o = ownedOrder(db, actor, target);
  requireThat(
    actor.role === "client" && o.client === actor.id,
    "此操作由订单当事人完成",
  );
  return o;
}
function notify(db, user, title, target) {
  db.notifications.unshift({
    id: id("N"),
    user,
    title,
    target,
    read: false,
    created: now(),
  });
}

export function dispatch(db, actor, action, p = {}) {
  const next = structuredClone(db);
  const result = applyAction(next, actor, action, p);
  Object.assign(db, next);
  return result;
}
function applyAction(db, actor, action, p = {}) {
  let result;
  if (action === "model-chat") {
    requireThat(actor.role === "client", "法律模型咨询仅对当事人开放");
    requireThat(
      String(p.prompt || "").trim().length >= 2,
      "请输入具体的法律问题",
    );
    const prompt = String(p.prompt).trim();
    requireThat(prompt.length <= 8000, "单次提问不能超过8000字");
    const topic = p.topic || "综合咨询";
    const answer = modelAnswer(prompt, topic);
    const chat = {
      id: id("MC"),
      owner: actor.id,
      topic,
      title: prompt.slice(0, 34),
      messages: [
        {
          role: "user",
          text: prompt,
          attachments: p.attachments || [],
          created: now(),
        },
        {
          role: "assistant",
          text: answer.text,
          risk: answer.risk,
          created: now(),
        },
      ],
      created: now(),
      updated: now(),
      feedback: "",
      contextEnabled: p.contextEnabled !== false,
    };
    (db.modelChats ??= []).unshift(chat);
    log(db, actor, "法律模型咨询", chat.id, chat.topic);
    result = chat;
  }
  if (action === "model-message") {
    requireThat(actor.role === "client", "法律模型咨询仅对当事人开放");
    const chat = get(db.modelChats || [], p.id, "模型咨询");
    requireThat(chat.owner === actor.id, "无权访问此咨询");
    const prompt = String(p.prompt || "").trim();
    requireThat(
      prompt.length >= 2 && prompt.length <= 8000,
      "请输入2至8000字的具体问题",
    );
    const contextEnabled = p.contextEnabled !== false;
    const context = contextEnabled
      ? chat.messages
          .filter((m) => m.role === "user")
          .map((m) => m.text)
          .concat(prompt)
          .join("\n")
      : prompt;
    const answer = modelAnswer(context, p.topic || chat.topic);
    chat.messages.push(
      {
        role: "user",
        text: prompt,
        attachments: p.attachments || [],
        created: now(),
      },
      {
        role: "assistant",
        text: answer.text,
        risk: answer.risk,
        created: now(),
      },
    );
    chat.contextEnabled = contextEnabled;
    chat.topic = p.topic || chat.topic;
    chat.updated = now();
    log(db, actor, "追问法律模型咨询", chat.id, chat.topic);
    result = chat;
  }
  if (action === "model-feedback") {
    const chat = get(db.modelChats || [], p.id, "模型咨询");
    requireThat(
      actor.role === "client" && chat.owner === actor.id,
      "无权评价此咨询",
    );
    chat.feedback = p.value;
    if (Number.isInteger(p.index)) {
      requireThat(
        chat.messages[p.index]?.role === "assistant",
        "请选择模型回复",
      );
      (chat.feedbackByMessage ??= {})[p.index] = p.value;
    }
    chat.updated = now();
    log(db, actor, "反馈法律模型回答", chat.id, p.value);
    result = chat;
  }
  if (action === "model-summary") {
    const chat = get(db.modelChats || [], p.id, "模型咨询");
    requireThat(
      actor.role === "client" && chat.owner === actor.id,
      "无权使用此咨询",
    );
    const existing = db.sessions.find(
      (s) =>
        s.sourceChat === chat.id && s.messageCount === chat.messages.length,
    );
    if (existing) return existing;
    const s = {
      id: id("S"),
      owner: actor.id,
      kind: "model-summary",
      source: "法律模型咨询",
      sourceChat: chat.id,
      messageCount: chat.messages.length,
      created: now(),
      title: chat.title,
      goal: chat.title,
      domain:
        chat.topic === "刑事问题"
          ? "刑事"
          : chat.topic === "综合咨询"
            ? "不确定"
            : "民事",
      field:
        {
          合同问题: "合同纠纷",
          劳动争议: "劳动争议",
          婚姻家事: "婚姻家事",
          公司商事: "公司商事",
          刑事问题: "刑事案件",
        }[chat.topic] || "",
      facts: chat.messages
        .filter((m) => m.role === "user")
        .map((m) => m.text)
        .join("\n\n"),
      risk: chat.messages.some((m) => m.risk),
      attachments: chat.messages.flatMap((m) => m.attachments || []),
      region: "",
      time: "",
      feedback: "",
    };
    db.sessions.unshift(s);
    log(db, actor, "整理模型咨询摘要", s.id, chat.id);
    result = s;
  }
  if (action === "session") {
    requireThat(actor.role === "client", "请切换到当事人视角进行问答");
    requireThat(
      ["民事", "刑事", "不确定"].includes(p.domain),
      "请选择问题类型",
    );
    requireThat(
      String(p.facts || "").trim().length >= 8,
      "请至少填写8字的事实经过",
    );
    requireThat(
      p.region && p.time && p.goal,
      "请补充地区、事件时间和希望解决的问题",
    );
    if (p.domain === "刑事")
      requireThat(p.identity && p.measure, "请填写涉案身份和是否采取强制措施");
    const s = {
      ...p,
      id: id("S"),
      owner: actor.id,
      created: now(),
      title: p.facts.slice(0, 28),
      risk:
        /拘留|羁押|逮捕|强制措施|失联|转移财产|明天|时效/.test(p.facts) ||
        p.measure === "已采取",
      source: "法律问答",
      feedback: "",
    };
    db.sessions.unshift(s);
    log(db, actor, "问答信息整理", s.id, p.domain);
    result = s;
  }
  if (action === "feedback") {
    const s = get(db.sessions, p.id, "会话");
    requireThat(s.owner === actor.id, "无权评价");
    s.feedback = p.value;
    result = s;
  }
  if (action === "request") {
    requireThat(actor.role === "client", "需求由当事人发布");
    requireThat(p.consent, "请先确认事实摘要的公开范围与授权");
    requireThat(
      p.title && p.facts && p.region && p.deadline && p.deliverables,
      "请填写标题、事实、地区、时限和交付物",
    );
    if (p.sourceSession) {
      const s = get(db.sessions, p.sourceSession, "会话");
      requireThat(s.owner === actor.id, "无权使用此会话");
    }
    const r = {
      ...p,
      budget: positive(p.budget, "预算"),
      id: id("R"),
      owner: actor.id,
      status: "待报价",
      created: now(),
    };
    db.requests.unshift(r);
    log(
      db,
      actor,
      "发布律师需求",
      r.id,
      p.sourceSession ? `来源会话 ${p.sourceSession}` : "直接发布",
    );
    notify(db, "L1", "收到可报价的新需求", `requests/${r.id}`);
    result = r;
  }
  if (action === "edit-request") {
    const r = get(db.requests, p.editId, "需求");
    requireThat(
      actor.role === "client" && r.owner === actor.id,
      "只有需求发布者可以编辑",
    );
    requireThat(
      ["待报价", "已退回"].includes(r.status),
      "需求已进入订单流程，不能直接编辑",
    );
    requireThat(
      p.title && p.facts && p.region && p.deadline && p.deliverables,
      "请填写标题、事实、地区、时限和交付物",
    );
    Object.assign(r, {
      ...p,
      budget: positive(p.budget, "预算"),
      status: "待报价",
      updated: now(),
    });
    log(db, actor, "修改律师需求", r.id);
    notify(db, "L1", "需求内容已更新，可重新报价", `requests/${r.id}`);
    result = r;
  }
  if (action === "quote") {
    lawyerReady(db, actor);
    const r = get(db.requests, p.requestId, "需求");
    requireThat(r.consent && r.status === "待报价", "此需求不再接受报价");
    requireThat(
      p.scope && p.deliverables && p.validUntil,
      "请填写服务范围、交付物和报价有效期",
    );
    requireThat(p.validUntil >= now().slice(0, 10), "报价有效期不能早于今天");
    const q = {
      ...p,
      price: positive(p.price, "服务金额"),
      days: positive(p.days, "工期"),
      id: id("Q"),
      lawyer: actor.id,
      status: "有效",
      created: now(),
    };
    db.quotes.unshift(q);
    log(db, actor, "提交服务报价", q.id, r.id);
    notify(db, r.owner, "收到律师报价", `requests/${r.id}`);
    result = q;
  }
  if (action === "accept-quote") {
    const q = get(db.quotes, p.id, "报价");
    const existing = db.orders.find((o) => o.quoteId === q.id);
    if (existing) {
      requireThat(existing.client === actor.id, "无权接受此报价");
      return existing;
    }
    const r = get(db.requests, q.requestId, "需求");
    requireThat(
      actor.role === "client" && r.owner === actor.id,
      "此操作由需求发布者完成",
    );
    requireThat(
      r.status === "待报价" &&
        q.status === "有效" &&
        q.validUntil >= now().slice(0, 10),
      "需求已成交或报价已失效",
    );
    const l = get(db.lawyers, q.lawyer, "律师");
    requireThat(
      l.status === "已认证" && l.available && l.expires >= now().slice(0, 10),
      "律师当前无法接单",
    );
    const o = {
      id: id("O"),
      requestId: r.id,
      quoteId: q.id,
      client: actor.id,
      lawyer: q.lawyer,
      title: r.title,
      scope: q.scope,
      deliverables: q.deliverables,
      price: q.price,
      status: "待确认",
      paid: 0,
      paymentStatus: "未支付",
      delivery: [],
      settlement: "未结算",
      messages: [],
      created: now(),
    };
    const body = `法律服务合同（待确认草稿）\n委托方：${actor.name}\n服务方：${l.name}\n服务范围：${q.scope}\n交付物：${q.deliverables}\n工期：${q.days}天\n费用：${q.price}元\n付款方式：单次付款\n其他条款：由双方补充并核对。`;
    const d = {
      id: id("D"),
      owner: actor.id,
      orderId: o.id,
      title: "法律服务合同",
      type: "服务合同",
      status: "草稿",
      locked: false,
      members: [actor.id, q.lawyer],
      deadline: r.deadline,
      versions: [{ number: 1, body, author: actor.name, created: now() }],
      current: 1,
      nodes: [],
      comments: [],
      created: now(),
    };
    o.contract = d.id;
    db.docs.unshift(d);
    db.orders.unshift(o);
    q.status = "已接受";
    r.status = "已下单";
    log(db, actor, "接受报价并创建订单", o.id, q.id);
    notify(db, q.lawyer, "报价已被接受，请确认服务合同", `documents/${d.id}`);
    result = o;
  }
  if (action === "create-doc") {
    requireThat(actor.role !== "operator", "运营不能创建业务文书");
    const o = ownedOrder(db, actor, p.orderId);
    requireThat(p.title && p.body, "请填写文书名称与正文");
    const d = {
      ...p,
      id: id("D"),
      owner: actor.id,
      type: p.type || "法律文书",
      status: "草稿",
      locked: false,
      members: [o.client, o.lawyer],
      versions: [
        { number: 1, body: p.body, author: actor.name, created: now() },
      ],
      current: 1,
      nodes: [],
      comments: [],
      created: now(),
    };
    delete d.body;
    db.docs.unshift(d);
    log(db, actor, "新建文书", d.id, o.id);
    result = d;
  }
  if (action === "save-version" || action === "restore-version") {
    const d = ownedDoc(db, actor, p.id);
    requireThat(
      !d.locked && d.status !== "会签中",
      "会签中或已锁定文书不能修改，请先撤回流转",
    );
    const body =
      action === "restore-version"
        ? get(
            d.versions.map((v) => ({ ...v, id: String(v.number) })),
            String(p.number),
            "版本",
          ).body
        : p.body;
    requireThat(String(body || "").trim(), "文书正文不能为空");
    const n = Math.max(...d.versions.map((v) => v.number)) + 1;
    d.versions.push({
      number: n,
      body,
      author: actor.name,
      created: now(),
      restoredFrom: action === "restore-version" ? p.number : undefined,
    });
    d.current = n;
    d.status = "草稿";
    d.nodes = [];
    log(
      db,
      actor,
      action === "restore-version" ? "恢复为新版本" : "创建文书版本",
      d.id,
      `v${n}`,
    );
    result = d;
  }
  if (action === "start-sign") {
    const d = ownedDoc(db, actor, p.id);
    requireThat(
      !d.locked && ["草稿", "已退回"].includes(d.status),
      "此文书当前不能发起会签",
    );
    const o = ownedOrder(db, actor, d.orderId);
    requireThat(
      d.members.includes(o.client) && d.members.includes(o.lawyer),
      "请先恢复双方的文书访问授权",
    );
    d.nodes = [
      { user: o.lawyer, status: "待处理" },
      { user: o.client, status: "未轮到" },
    ];
    d.status = "会签中";
    log(db, actor, "发起顺序会签", d.id, `v${d.current}`);
    notify(db, o.lawyer, "待确认文书版本", `documents/${d.id}`);
    result = d;
  }
  if (action === "confirm-doc" || action === "return-doc") {
    const d = ownedDoc(db, actor, p.id);
    requireThat(d.status === "会签中", "文书不在会签中");
    const node = d.nodes.find((n) => n.status === "待处理");
    requireThat(node?.user === actor.id, "尚未轮到您处理此文书");
    if (action === "return-doc") {
      node.status = "已退回";
      d.status = "已退回";
      d.locked = false;
      d.returnReason = reason(p.reason);
      log(db, actor, "退回文书", d.id, d.returnReason);
      notify(db, d.owner, "文书已退回，请修改后重新发起", `documents/${d.id}`);
    } else {
      node.status = "已确认";
      node.confirmedVersion = d.current;
      node.confirmedAt = now();
      const next = d.nodes.find((n) => n.status === "未轮到");
      if (next) {
        next.status = "待处理";
        notify(db, next.user, "轮到您确认文书", `documents/${d.id}`);
      } else {
        d.status = "已确认";
        d.locked = true;
        const o = ownedOrder(db, actor, d.orderId);
        if (o.contract === d.id && o.status === "待确认") o.status = "待支付";
      }
      log(
        db,
        actor,
        "确认文书版本",
        d.id,
        `v${d.current}；平台内确认，不是电子签名`,
      );
    }
    result = d;
  }
  if (action === "withdraw-doc") {
    const d = ownedDoc(db, actor, p.id);
    requireThat(
      d.owner === actor.id && d.status === "会签中",
      "只有发起人可以撤回进行中的流转",
    );
    d.status = "草稿";
    d.nodes = [];
    log(db, actor, "撤回文书流转", d.id);
    result = d;
  }
  if (action === "remind-doc") {
    const d = ownedDoc(db, actor, p.id);
    const n = d.nodes.find((n) => n.status === "待处理");
    requireThat(n, "当前没有待催办节点");
    notify(db, n.user, "文书会签催办", `documents/${d.id}`);
    log(db, actor, "催办会签", d.id);
    result = d;
  }
  if (action === "access-doc") {
    const d = ownedDoc(db, actor, p.id);
    const o = ownedOrder(db, actor, d.orderId);
    requireThat(
      actor.id === d.owner || actor.id === o.client,
      "只有文书发起人或订单当事人可管理访问",
    );
    requireThat(p.user !== actor.id, "不能撤销自己的访问");
    if (p.grant) {
      if (!d.members.includes(p.user)) d.members.push(p.user);
    } else {
      d.members = d.members.filter((u) => u !== p.user);
      if (d.status === "会签中") {
        d.status = "草稿";
        d.nodes = [];
      }
    }
    log(db, actor, p.grant ? "恢复文书授权" : "撤销文书授权", d.id, p.user);
    result = d;
  }
  if (action === "comment") {
    const d = ownedDoc(db, actor, p.id);
    d.comments.unshift({
      id: id("C"),
      text: reason(p.text),
      author: actor.name,
      created: now(),
      resolved: false,
    });
    log(db, actor, "添加文书批注", d.id);
    result = d;
  }
  if (action === "resolve-comment") {
    const d = ownedDoc(db, actor, p.id);
    const c = get(d.comments, p.comment, "批注");
    c.resolved = true;
    log(db, actor, "解决文书批注", d.id);
    result = d;
  }
  if (action === "pay") {
    const o = clientOrder(db, actor, p.id);
    if (o.paid === o.price) return o;
    requireThat(o.status === "待支付", "需先完成服务合同确认");
    const success = p.result === "success";
    db.payments.unshift({
      id: id("PAY"),
      orderId: o.id,
      amount: success ? o.price : 0,
      status: success ? "成功" : "失败",
      created: now(),
    });
    if (success) {
      o.paid = o.price;
      o.paymentStatus = "已支付";
      o.status = "服务中";
      notify(db, o.lawyer, "订单已模拟支付，可开始履约", `orders/${o.id}`);
    } else o.paymentStatus = "支付失败";
    log(
      db,
      actor,
      success ? "模拟支付成功" : "模拟支付失败",
      o.id,
      "仅本地状态，无真实资金交易",
    );
    result = o;
  }
  if (action === "deliver") {
    const o = ownedOrder(db, actor, p.id);
    requireThat(
      actor.role === "lawyer" && o.lawyer === actor.id,
      "仅承办律师可提交交付",
    );
    requireThat(["服务中", "待交付"].includes(o.status), "此订单不能提交交付");
    const d = ownedDoc(db, actor, p.docId);
    requireThat(
      d.orderId === o.id && d.type !== "服务合同",
      "请选择本订单的交付文书",
    );
    o.delivery.push({
      docId: d.id,
      version: d.current,
      note: p.note || "",
      created: now(),
    });
    o.status = "待确认";
    log(db, actor, "提交交付物", o.id, d.id);
    notify(db, o.client, "交付物待确认收悉", `orders/${o.id}`);
    result = o;
  }
  if (action === "receive" || action === "return-delivery") {
    const o = clientOrder(db, actor, p.id);
    requireThat(
      o.status === "待确认" && o.delivery.length,
      "订单当前没有待确认的交付",
    );
    if (action === "receive") {
      o.status = "已完成";
      o.settlement = "待结算";
      o.receivedAt = now();
      log(db, actor, "确认交付收悉", o.id, "平台内收悉确认");
    } else {
      o.status = "服务中";
      o.returnReason = reason(p.reason);
      log(db, actor, "提出交付修改", o.id, o.returnReason);
      notify(db, o.lawyer, "客户提出修改，请查看原因", `orders/${o.id}`);
    }
    result = o;
  }
  if (action === "refund" || action === "dispute") {
    const o = ownedOrder(db, actor, p.id);
    if (action === "refund")
      requireThat(
        actor.role === "client" && o.client === actor.id,
        "退款由当事人发起",
      );
    else requireThat(actor.role !== "operator", "争议由订单参与人发起");
    requireThat(
      o.paid > 0 && !["已关闭", "退款中", "争议中"].includes(o.status),
      "此订单当前不能发起售后",
    );
    const text = reason(p.reason);
    const amount = action === "refund" ? positive(p.amount, "退款金额") : 0;
    requireThat(amount <= o.paid, "退款金额不能超过已付金额");
    const c = {
      id: id("AF"),
      orderId: o.id,
      type: action === "refund" ? "退款" : "争议",
      reason: text,
      amount,
      previousStatus: o.status,
      status: "待处理",
      owner: actor.id,
      evidence: p.evidence || [],
      created: now(),
    };
    db.cases.unshift(c);
    o.status = action === "refund" ? "退款中" : "争议中";
    o.settlement = "暂停结算";
    log(db, actor, "发起" + c.type, o.id, text);
    notify(db, "A1", "新的售后事项待处理", `cases/${c.id}`);
    result = c;
  }
  if (action === "resolve-case") {
    requireThat(actor.role === "operator", "售后由运营处理");
    const c = get(db.cases, p.id, "售后事项");
    requireThat(c.status === "待处理", "此事项已处理");
    const o = get(db.orders, c.orderId, "订单");
    c.result = reason(p.result);
    c.decision = p.decision;
    c.processedAt = now();
    if (c.type === "退款" && p.decision === "approve") {
      c.status = "已退款";
      o.refunded = (o.refunded || 0) + c.amount;
      o.paymentStatus = c.amount === o.paid ? "已退款" : "部分退款";
      o.status = c.amount === o.paid ? "已关闭" : c.previousStatus;
      o.settlement = c.amount === o.paid ? "无需结算" : "待核对";
    } else if (p.decision === "reject") {
      c.status = "已拒绝";
      o.status = c.previousStatus;
      o.settlement = o.status === "已完成" ? "待结算" : "未结算";
    } else {
      c.status = "已处理";
      o.status = p.decision === "close" ? "已关闭" : "服务中";
      o.settlement = p.decision === "close" ? "待核对" : "未结算";
    }
    log(db, actor, "处理售后事项", o.id, `${c.type}：${c.status}；${c.result}`);
    notify(db, o.client, "售后事项有处理结果", `orders/${o.id}`);
    result = c;
  }
  if (action === "message") {
    const o = ownedOrder(db, actor, p.id);
    requireThat(actor.role !== "operator", "运营不参与订单私信");
    o.messages.push({
      author: actor.name,
      text: reason(p.text),
      created: now(),
    });
    log(db, actor, "发送订单消息", o.id);
    result = o;
  }
  if (action === "rating") {
    const o = ownedOrder(db, actor, p.id);
    requireThat(
      o.status === "已完成" && actor.role !== "operator",
      "订单完成后参与人可评价",
    );
    (o.ratings ??= {})[actor.id] = {
      stars: positive(p.stars, "评分"),
      text: p.text || "",
      created: now(),
    };
    log(db, actor, "提交服务评价", o.id);
    result = o;
  }
  if (action === "lawyer-apply") {
    requireThat(actor.role === "lawyer", "请使用律师视角");
    const l = get(db.lawyers, actor.id, "律师");
    requireThat(
      p.firm && p.license && p.region && p.field && p.expires,
      "请填写机构、执业资料、地区、领域与有效期",
    );
    Object.assign(l, p, { status: "待审核", available: false });
    log(db, actor, "提交资质审核", l.id);
    result = l;
  }
  if (action === "review-lawyer") {
    requireThat(actor.role === "operator", "仅运营可审核资质");
    const l = get(db.lawyers, p.id, "律师");
    requireThat(
      ["approve", "reject", "freeze"].includes(p.decision),
      "请选择审核结果",
    );
    l.status =
      p.decision === "approve"
        ? "已认证"
        : p.decision === "freeze"
          ? "已冻结"
          : "需补件";
    l.available = p.decision === "approve";
    l.reviewNote = reason(p.reason);
    log(db, actor, "资质" + l.status, l.id, l.reviewNote);
    result = l;
  }
  if (action === "profile") {
    db.profile[actor.role] = { ...db.profile[actor.role], ...p };
    log(db, actor, "更新账户资料", actor.id);
    result = db.profile[actor.role];
  }
  if (action === "settings") {
    requireThat(actor.role === "operator", "仅运营可调整配置");
    db.settings = {
      fields: p.fields
        .split(/[,，、\n]/)
        .map((v) => v.trim())
        .filter(Boolean),
      services: p.services
        .split(/[,，、\n]/)
        .map((v) => v.trim())
        .filter(Boolean),
      risk: reason(p.risk),
    };
    log(db, actor, "更新服务与风险配置", "SETTINGS");
    result = db.settings;
  }
  requireThat(result, "未知操作");
  return result;
}
export function visibleRequests(db, actor) {
  if (actor.role === "client")
    return db.requests.filter((r) => r.owner === actor.id);
  if (actor.role === "lawyer")
    return db.requests.filter(
      (r) => r.consent && get(db.lawyers, actor.id, "律师").status === "已认证",
    );
  return db.requests;
}
export function evidence(db, actor, target) {
  const o = ownedOrder(db, actor, target);
  const docs = db.docs
    .filter((d) => d.orderId === o.id)
    .map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
      status: d.status,
      members: d.members,
      versions:
        actor.role === "operator"
          ? d.versions.map(({ number, author, created }) => ({
              number,
              author,
              created,
            }))
          : canDoc(db, actor, d)
            ? d.versions
            : [],
      nodes: d.nodes,
    }));
  const order =
    actor.role === "operator"
      ? Object.fromEntries(
          Object.entries(o).filter(
            ([key]) => !["messages", "ratings"].includes(key),
          ),
        )
      : o;
  return {
    kind: "本地过程记录；不构成第三方存证",
    order,
    documents: docs,
    payments: db.payments.filter((p) => p.orderId === o.id),
    afterSales: db.cases.filter((c) => c.orderId === o.id),
    audit: db.audit.filter(
      (l) => l.object === o.id || docs.some((d) => d.id === l.object),
    ),
    exportedAt: now(),
  };
}
