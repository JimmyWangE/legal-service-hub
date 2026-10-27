import { civilTopics, coerciveMeasures, consultationCategories, criminalRoles, regions } from "./labels.js";
import { esc, icon, date } from "./ui.js";

const categoryTopic = { criminal: "刑事问题", unsure: "综合咨询" };
const categoryIcon = { civil: "scale", criminal: "shield", unsure: "spark" };
const examples = [
  {
    title: "梳理法律问题",
    icon: "spark",
    tone: "gold",
    category: "civil",
    topic: "公司商事",
    text: "公司召开股东会，未通知某小股东参加就通过了决议。需要核对哪些事实和材料？",
    caption: "把问题说清楚 · 明确关注点",
  },
  {
    title: "拆解复杂案情",
    icon: "layers",
    tone: "navy",
    category: "civil",
    topic: "劳动争议",
    text: "我在公司工作三年，最近收到解除通知，对工资结算和补偿安排有疑问。应该如何整理案情和证据？",
    caption: "整理事件脉络 · 补充关键事实",
  },
  {
    title: "刑事事项求助",
    icon: "shield",
    tone: "red",
    category: "criminal",
    topic: "刑事问题",
    text: "家人因涉嫌经济犯罪被带走调查，目前不清楚是否已被刑事拘留。家属现在可以做什么？",
    caption: "紧急事项 · 优先对接刑事律师",
  },
];

function consultationTemplate(existingText = "") {
  const question = existingText.trim();
  return `【案件类型】：

【我的身份】：

【对方身份及双方关系】：

【事实经过】：
1.
2.
3.

【关键时间和地点】：

【涉及金额或损失】：

【现有证据】：
1.
2.
3.

【已经采取的措施】：

【是否收到通知及期限】：

【希望达到的结果】：

【具体想咨询的问题】：
1.${question ? ` ${question}` : ""}
2.
3.`;
}

function inline(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*/g, "")
    .replace(/__/g, "");
}

function format(text) {
  const output = [];
  let list = null;
  const closeList = () => {
    if (list) output.push(`</${list}>`);
    list = null;
  };
  for (const rawLine of String(text || "").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    const bullet = line.match(/^(?:[-*•])\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (heading) {
      closeList();
      output.push(`<h3>${inline(heading[1])}</h3>`);
    } else if (bullet || ordered) {
      const type = bullet ? "ul" : "ol";
      if (list !== type) {
        closeList();
        list = type;
        output.push(`<${list}>`);
      }
      output.push(`<li>${inline((bullet || ordered)[1])}</li>`);
    } else {
      closeList();
      output.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return output.join("");
}

export function createModelConsultation({
  getDb,
  getActor,
  commit,
  refresh,
  navigate,
  notify,
  modal,
  closeModal,
  download,
  createRequest,
}) {
  const drafts = new Map();
  let currentRoute;
  let currentChatId = "";
  let continuous = true;
  let busy = false;
  let streamingChat = null;
  let refreshTimer = null;
  function chats() {
    return (getDb().modelChats || []).filter((c) => c.owner === getActor().id);
  }
  function active() {
    return chats().find((c) => c.id === currentRoute?.id);
  }
  function draft() {
    const key = currentRoute?.id || "new";
    if (!drafts.has(key))
      drafts.set(key, {
        text: "",
        topic: active()?.topic || "综合咨询",
        category: "",
        intake: {},
        files: [],
      });
    return drafts.get(key);
  }
  function render(route) {
    currentRoute = route;
    const chat = active() || streamingChat;
    if (chat && chat.id !== currentChatId) {
      continuous = chat.contextEnabled !== false;
      currentChatId = chat.id;
    }
    if (!chat) currentChatId = "";
    if (route.id && !chat)
      return '<section class="surface"><h1>找不到可访问的咨询记录</h1><a class="btn" href="#/model-chat">开始新的咨询</a></section>';
    const d = draft();
    return `<section class="legal-model ${chat ? "has-conversation" : ""}" aria-label="法律模型咨询"><div class="model-toolbar"><div><button class="btn" data-model-action="history">${icon("history")} 咨询记录 <span class="model-history-count">${chats().length}</span></button><button class="btn" data-model-action="new">${icon("plus")} 新建咨询</button></div><label class="model-memory"><input type="checkbox" id="model-continuous" ${continuous ? "checked" : ""}><span>连续对话</span></label></div>
      ${chat ? thread(chat) : `<header class="model-hero"><span class="model-eyebrow">${icon("spark")} 法律模型咨询</span><h1>先选择问题类型，再描述你的情况</h1><p>系统会按民事或刑事场景引导提问，识别紧急风险，并帮你整理成可交给律师的需求。</p><button class="model-guide" data-model-action="guide">${icon("info")} 了解咨询方式</button></header>${categoryPicker(d)}${d.category ? intakePanel(d) : ""}`}
      ${composer(d, !!chat)}
      ${!chat ? `<div class="model-examples"><div class="model-divider"><span></span>您可以按照以下场景提问<span></span></div><div class="model-scenario-grid">${examples.map((e, i) => `<button class="model-scenario ${e.tone}" data-model-example="${i}"><div><h2><span>${icon(e.icon)}</span>${e.title}</h2><p>${e.text}</p><small>${e.caption}</small><span class="model-example-arrow">${icon("arrow")}</span></div></button>`).join("")}</div></div>` : ""}
      ${busy ? '<div class="model-pending" role="status" aria-live="polite">正在连接法律模型，生成完整回答，请稍候…<small>模型生成期间请勿重复提交，网络超时后可以沿用原问题重试。</small></div>' : ""}
      <footer class="model-disclaimer">${icon("info")} 咨询通过服务端模型生成并保存；不构成法律意见。材料仅保存，尚不参与模型回答；重要或紧急事项请联系律师。</footer></section>`;
  }
  function categoryPicker(d) {
    return `<section class="category-picker" aria-labelledby="category-picker-title"><div class="category-picker-heading"><div><span class="category-step">第一步</span><b id="category-picker-title">选择问题类型</b></div><small>不确定类型？选择“我不确定”即可</small></div><div class="category-cards" role="radiogroup" aria-labelledby="category-picker-title">${Object.entries(consultationCategories).map(([key, [title, text]], index) => `<button type="button" role="radio" aria-checked="${d.category === key}" tabindex="${d.category === key || (!d.category && index === 0) ? "0" : "-1"}" class="category-card ${key} ${d.category === key ? "selected" : ""}" data-model-category="${key}"><span class="category-icon" aria-hidden="true">${icon(categoryIcon[key])}</span><span class="category-copy"><b>${title}</b><small>${text}</small></span>${d.category === key ? `<span class="category-check" aria-hidden="true">${icon("check")}</span>` : ""}</button>`).join("")}</div></section>`;
  }
  function intakeSelect(d, key, title, values) {
    return `<label class="intake-field"><span>${title}</span><select data-intake="${key}"><option value="">请选择</option>${values.map((value) => `<option ${d.intake[key] === value ? "selected" : ""}>${esc(value)}</option>`).join("")}</select></label>`;
  }
  function intakeInput(d, key, title, placeholder) {
    return `<label class="intake-field"><span>${title}</span><input data-intake="${key}" maxlength="200" value="${esc(d.intake[key] || "")}" placeholder="${esc(placeholder)}"></label>`;
  }
  function intakeHeading(title) {
    return `<div class="intake-panel-heading"><div><b>${title}</b><small>补充基本信息，让回答更有针对性</small></div><span class="intake-optional">选填</span></div>`;
  }
  function intakePanel(d) {
    if (d.category === "criminal") {
      const custody = d.intake.coercive_measure && !["否", "不清楚"].includes(d.intake.coercive_measure);
      return `<section class="intake-panel criminal">${intakeHeading("补充刑事事项信息")}<div class="model-urgent strong">${icon("alert")}<div><b>${custody ? "已被采取强制措施，请尽快联系刑事律师" : "刑事事项时效性强"}</b><span>${custody ? "羁押期间的会见、取保候审申请等有严格时限，模型回答仅供参考，建议立即委托执业律师。" : "如涉及羁押、传唤或立案，请优先联系执业律师；模型回答仅供一般信息参考。"}</span></div><a class="btn ${custody ? "danger" : "sm"}" href="#/lawyers">立即找刑事律师</a></div><div class="intake-grid">${intakeSelect(d, "role", "你的身份", criminalRoles)}${intakeSelect(d, "coercive_measure", "是否已被采取强制措施", coerciveMeasures)}${intakeInput(d, "time", "事发时间", "例如：2026年9月")}${intakeInput(d, "location", "事发地点", "例如：上海市浦东新区")}</div></section>`;
    }
    if (d.category === "civil") return `<section class="intake-panel">${intakeHeading("补充案件信息")}<div class="intake-grid">${intakeSelect(d, "region", "所在地区", regions)}${intakeInput(d, "time", "纠纷发生时间", "例如：2026年3月起")}${intakeInput(d, "goal", "希望达到的结果", "例如：追回货款、解除合同")}</div></section>`;
    return `<section class="intake-panel unsure"><p class="intake-guidance">${icon("info")}<span>不确定也没关系，直接描述发生了什么。若涉及被拘留、传唤或刑事立案，请改选“刑事问题”。</span></p></section>`;
  }
  function composer(d, followup) {
    return `<form id="model-consultation-form" class="model-composer ${followup ? "model-followup" : ""}"><label class="sr-only" for="model-prompt">法律咨询内容</label><textarea id="model-prompt" name="prompt" rows="3" maxlength="8000" placeholder="${followup ? "继续补充事实，或追问您关心的事项…" : "输入法律问题，描述案情或需要帮助的事项…"}">${esc(d.text)}</textarea><div class="model-file-chips">${d.files.map((f, i) => `<span>${icon("attach")}${esc(f.name)}<button type="button" data-model-remove-file="${i}" aria-label="移除材料 ${esc(f.name)}">×</button></span>`).join("")}</div>${d.files.length ? '<p class="model-file-note">材料上传后由服务器受控保存，当前不会读取或分析材料内容。</p>' : ""}<div class="model-compose-footer">${followup || d.category !== "civil" ? `<span class="model-topic static">${icon(categoryIcon[active()?.category || d.category || "unsure"] || "spark")}${esc(followup ? active()?.topic || d.topic : categoryTopic[d.category] || "综合咨询")}</span>` : `<label class="model-topic">${icon("scale")}<select aria-label="民事领域" id="model-topic">${civilTopics.map((t) => `<option ${d.topic === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>`}<div class="model-tools"><span class="model-key-hint">Enter发送 · Shift+Enter换行</span><button type="button" class="model-tool" data-model-action="polish" title="完善提问" aria-label="完善提问">${icon("magic")}</button><button type="button" class="model-tool" data-model-action="attach" title="添加材料" aria-label="添加材料">${icon("attach")}</button><button class="model-send" type="submit" aria-label="${busy ? "正在生成回答" : "发送咨询"}" title="${busy ? "正在生成回答" : "发送咨询"}" ${busy || d.text.trim().length < 2 ? "disabled" : ""}>${busy ? '<span class="model-send-loading" aria-hidden="true"></span>' : icon("send")}</button></div></div><input hidden id="model-files" type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" multiple></form>`;
  }
  function thread(chat) {
    const category = consultationCategories[chat.category]?.[0];
    return `<div class="model-thread-heading"><div><span>${category ? `<b class="category-tag ${esc(chat.category)}">${category}</b>` : ""}${esc(chat.topic)} · ${date(chat.created)}</span><h1>${esc(chat.title)}</h1></div>${!busy ? `<div class="heading-tools"><button class="btn" data-model-action="export">${icon("download")} 导出咨询</button><button class="btn" data-model-action="delete">${icon("trash")} 删除咨询</button></div>` : ""}</div>${chat.risk_level === "high" ? `<div class="model-urgent strong">${icon("alert")}<div><b>本次咨询涉及紧急或高风险事项</b><span>请勿仅依赖模型回答，建议尽快联系执业律师核实处理。</span></div><a class="btn danger" href="#/lawyers">立即联系律师</a></div>` : ""}<div class="model-messages" aria-label="咨询对话">${chat.messages.map((m, i) => (m.role === "user" ? `<article class="model-message model-user" aria-label="我的提问"><div><p>${esc(m.text)}</p>${m.attachments?.length ? `<small>${icon("attach")} ${m.attachments.map((f) => esc(f.name)).join("、")}</small>` : ""}</div></article>` : `<article class="model-message model-assistant ${m.streaming ? "model-message-streaming" : m.incomplete ? "model-message-incomplete" : ""}" aria-label="法律助手回复"><span class="model-assistant-avatar">${icon("spark")}</span><div><div class="model-answer-label">法律助手 <span>${m.streaming ? "正在生成" : m.incomplete ? "生成未完成" : m.source === "demo" ? "测试模型" : m.source === "legacy" ? "历史记录（来源未核验）" : "服务端模型"}</span></div>${m.risk ? `<div class="model-urgent">${icon("review")} 检测到紧急事项关键词，请优先联系人工律师核对。<a href="#/lawyers">找律师 ${icon("arrow")}</a></div>` : ""}<div class="model-answer-content">${format(m.text)}${m.streaming ? '<span class="model-streaming-cursor" aria-hidden="true"></span>' : ""}</div>${m.incomplete ? '<div class="model-answer-incomplete">连接中断，当前内容未保存；保留问题后可以重新发送。</div>' : ""}${m.streaming || m.incomplete ? "" : `<div class="model-answer-actions"><button data-model-copy="${i}" title="复制回复">${icon("copy")} 复制</button><button data-model-feedback="有用" data-index="${i}" class="${(chat.feedbackByMessage?.[i] || chat.feedback) === "有用" ? "selected" : ""}">${icon("thumb")} 有用</button><button data-model-feedback="无用" data-index="${i}" class="${(chat.feedbackByMessage?.[i] || chat.feedback) === "无用" ? "selected" : ""}">需要改进</button></div>`}</div></article>`)).join("")}</div>${busy ? "" : `<div class="model-conversion"><div>${icon("lawyer")}<span>需要律师审阅材料或起草文书？可授权模型把本次咨询整理成需求草稿。<button type="button" class="model-explain" data-model-action="explain">什么是需求草稿？</button></span></div><button class="btn primary" data-model-action="request">生成需求草稿 ${icon("arrow")}</button><a href="#/lawyers" class="btn">联系律师</a></div>`}`;
  }
  function bind(root) {
    if (getActor().role !== "client" || !root.querySelector(".legal-model"))
      return;
    if (busy) root.querySelectorAll("textarea, select, .model-send, [data-model-action=attach]").forEach((element) => { element.disabled = true; });
    root.querySelectorAll("[data-model-feedback]").forEach((el) => {
      const chat = active();
      const value = chat?.feedbackByMessage
        ? chat.feedbackByMessage[Number(el.dataset.index)]
        : chat?.feedback;
      el.classList.toggle("selected", value === el.dataset.modelFeedback);
    });
    root.querySelectorAll("[data-model-action]").forEach((el) =>
      el.addEventListener("click", (e) => {
        e.preventDefault();
        action(el.dataset.modelAction);
      }),
    );
    const categoryButtons = Array.from(root.querySelectorAll("[data-model-category]"));
    const selectCategory = (category) => {
      const d = draft();
      if (d.category !== category) {
        d.category = category;
        d.topic = categoryTopic[category] || (civilTopics.includes(d.topic) ? d.topic : civilTopics[0]);
        d.intake = {};
        refresh();
      }
      root.querySelector(`[data-model-category="${category}"]`)?.focus({ preventScroll: true });
    };
    categoryButtons.forEach((el, index) => {
      el.addEventListener("click", () => selectCategory(el.dataset.modelCategory));
      el.addEventListener("keydown", (event) => {
        const offsets = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        if (!(event.key in offsets) && !["Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? categoryButtons.length - 1 : (index + offsets[event.key] + categoryButtons.length) % categoryButtons.length;
        selectCategory(categoryButtons[next].dataset.modelCategory);
      });
    });
    root.querySelectorAll("[data-intake]").forEach((el) => {
      const update = () => { draft().intake[el.dataset.intake] = el.value.trim(); };
      el.addEventListener("input", update);
      el.addEventListener("change", () => { update(); if (el.dataset.intake === "coercive_measure") refresh(); });
    });
    root.querySelectorAll("[data-model-example]").forEach((el) =>
      el.addEventListener("click", () => {
        const e = examples[Number(el.dataset.modelExample)];
        draft().text = e.text;
        draft().topic = e.topic;
        if (draft().category !== e.category) { draft().category = e.category; draft().intake = {}; }
        refresh();
        focusPrompt();
      }),
    );
    root.querySelector("#model-prompt")?.addEventListener("input", (e) => {
      draft().text = e.target.value;
      root.querySelector(".model-send").disabled =
        busy || e.target.value.trim().length < 2;
    });
    root.querySelector("#model-prompt")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    root
      .querySelector("#model-topic")
      ?.addEventListener("change", (e) => (draft().topic = e.target.value));
    root.querySelector("#model-continuous")?.addEventListener("change", (e) => {
      continuous = e.target.checked;
      notify(
        continuous
          ? "后续回复参考当前会话中的提问"
          : "后续回复仅参考本次提问",
      );
    });
    root
      .querySelector("#model-consultation-form")
      ?.addEventListener("submit", (e) => {
        e.preventDefault();
        send();
      });
    root.querySelector("#model-files")?.addEventListener("change", (e) => {
      const files = Array.from(e.target.files);
      const allowed = /\.(pdf|doc|docx|txt|png|jpe?g)$/i;
      if (
        files.some((f) => !allowed.test(f.name) || f.size > 50 * 1024 * 1024)
      ) {
        notify("请选择支持的文件格式，单个文件不超过50MB");
        return;
      }
      if (draft().files.length + files.length > 8) {
        notify("单次咨询最多添加8份材料");
        return;
      }
      draft().files.push(...files.map((file) => ({ name: file.name, size: file.size, file })));
      refresh();
    });
    root.querySelectorAll("[data-model-remove-file]").forEach((el) =>
      el.addEventListener("click", () => {
        draft().files.splice(Number(el.dataset.modelRemoveFile), 1);
        refresh();
      }),
    );
    root.querySelectorAll("[data-model-copy]").forEach((el) =>
      el.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(
            active().messages[Number(el.dataset.modelCopy)].text,
          );
          notify("已复制回复");
        } catch {
          notify("浏览器暂不支持复制，请选择文字后复制");
        }
      }),
    );
    root.querySelectorAll("[data-model-feedback]").forEach((el) =>
      el.addEventListener("click", async () => {
        try {
          await commit("model-feedback", {
            id: active().id,
            value: el.dataset.modelFeedback,
            index: Number(el.dataset.index),
          });
          refresh();
          notify("已保存反馈");
        } catch (error) {
          notify(error.message);
        }
      }),
    );
  }
  function focusPrompt() {
    document.querySelector("#model-prompt")?.focus();
  }
  async function send() {
    if (busy) return;
    const d = draft();
    if (d.text.trim().length < 2) {
      notify("请先输入具体的法律问题");
      return;
    }
    busy = true;
    streamingChat = null;
    refresh();
    try {
      const chat = active();
      const result = await commit(chat || d.conversationId ? "model-message" : "model-chat", {
        id: chat?.id || d.conversationId,
        prompt: d.text,
        topic: chat?.topic || (d.category === "civil" ? d.topic : categoryTopic[d.category] || "综合咨询"),
        category: d.category || "unsure",
        intake: d.intake,
        attachments: d.files,
        contextEnabled: continuous,
        onStart: (id) => {
          streamingChat = { id, topic: d.topic, title: d.text.slice(0, 80), created: new Date().toISOString(), messages: [{ role: "user", text: d.text, attachments: d.files.map((file) => ({ name: file.name, size: file.size })) }, { role: "assistant", text: "", source: "model", streaming: true }] };
          refresh();
        },
        onChunk: (chunk) => {
          if (!streamingChat) return;
          streamingChat.messages[1].text += chunk;
          if (!refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = null; refresh(); }, 60);
        },
      });
      streamingChat = null;
      drafts.delete(currentRoute.id || "new");
      navigate("model-chat", result.id);
      refresh();
      requestAnimationFrame(() =>
        document
          .querySelector(".model-followup")
          ?.scrollIntoView({ behavior: "smooth", block: "end" }),
      );
    } catch (error) {
      if (error.consultationId) d.conversationId = error.consultationId;
      if (streamingChat) {
        streamingChat.messages[1].streaming = false;
        streamingChat.messages[1].incomplete = true;
      }
      notify(error.message);
    } finally {
      busy = false;
      refresh();
    }
  }
  function action(name) {
    if (name === "new") {
      navigate("model-chat");
      refresh();
      window.scrollTo({ top: 0, behavior: "auto" });
      focusPrompt();
    }
    if (name === "attach") document.querySelector("#model-files")?.click();
    if (name === "polish") {
      const d = draft();
      d.text = consultationTemplate(d.text);
      refresh();
      focusPrompt();
    }
    if (name === "history") history();
    if (name === "guide")
      modal(
        "如何使用法律模型咨询",
        `<div class="model-guide-content">
        <b>1. 选择问题类型</b>
        <p>首次咨询需要选择问题类型，帮助系统更准确地评估风险并提供建议：</p>
        <div class="guide-category-list">
          <div class="guide-category-item civil">
            <span class="guide-category-icon">${icon("scale")}</span>
            <div>
              <strong>民事问题</strong>
              <small>合同、劳动、婚姻家事、侵权、借贷等民事纠纷。系统会询问地区、时间和诉求等信息。</small>
            </div>
          </div>
          <div class="guide-category-item criminal">
            <span class="guide-category-icon">${icon("shield")}</span>
            <div>
              <strong>刑事问题</strong>
              <small>涉嫌犯罪、被害、取保、羁押等刑事事项。系统会特别询问是否已被采取强制措施，并优先提示联系律师。<strong>如已被拘留、逮捕或监视居住，请立即联系刑事律师。</strong></small>
            </div>
          </div>
          <div class="guide-category-item unsure">
            <span class="guide-category-icon">${icon("spark")}</span>
            <div>
              <strong>我不确定</strong>
              <small>不清楚属于哪个类型，或涉及多个领域。直接描述情况即可，系统会根据内容识别风险。</small>
            </div>
          </div>
        </div>
        <b>2. 描述并追问</b>
        <p>补充时间、地点、诉求等关键事实，支持连续追问。开启"连续对话"后，每次回答会参考前面的提问内容。会话中的问题类型不会被更改，如需切换请新建咨询。</p>
        <b>3. 风险识别</b>
        <p>系统会自动识别紧急或高风险事项（如羁押、财产转移、诉讼时效等），并在对话中提示联系人工律师。<strong>模型回答仅供参考，不构成法律意见，重要或紧急事项务必联系执业律师。</strong></p>
        <b>4. 转为律师需求</b>
        <p>授权后系统把对话整理成需求草稿，你逐项核对后发布给认证律师报价。已上传的材料也会一并关联到需求中。</p>
        <div class="info-callout">${icon("info")}<span>回答由服务端模型生成，仅供一般信息参考。上传材料仅保存在服务器，当前不参与模型回答生成。</span></div>
        </div>`,
      );
    if (name === "request" && active()) createRequest(active().id);
    if (name === "explain") createRequest(null);
    if (name === "delete" && active()) confirmDelete(active());
    if (name === "export" && active()) {
      const chat = active();
      download(
        `法律模型咨询-${chat.id}.txt`,
        chat.messages
          .map(
            (m) =>
              `${m.role === "user" ? "我的提问" : "法律助手"}\n${m.text}${m.attachments?.length ? "\n材料：" + m.attachments.map((f) => f.name).join("、") : ""}`,
          )
          .join("\n\n"),
      );
      notify("咨询记录已导出");
    }
  }
  function confirmDelete(chat) {
    if (busy) {
      notify("回答生成期间不能删除咨询");
      return;
    }
    modal(
      "删除咨询记录",
      `<p>确定删除咨询“<b>${esc(chat.title)}</b>”吗？</p><div class="info-callout warn">${icon("info")}<span>删除后该咨询的全部问答与反馈将无法恢复；已发布的服务需求和授权记录不受影响。</span></div><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn danger" type="button" id="model-delete-confirm">${icon("trash")} 确认删除</button></div>`,
    );
    const confirm = document.querySelector("#model-delete-confirm");
    confirm.focus();
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        await commit("model-delete", { id: chat.id });
        drafts.delete(chat.id);
        closeModal();
        notify("咨询记录已删除");
      } catch (error) {
        confirm.disabled = false;
        notify(error.message);
      }
    });
  }
  function history() {
    modal(
      "法律模型咨询记录",
      '<div class="model-history-header"><label class="sr-only" for="model-history-search">搜索咨询记录</label><input class="model-history-search" id="model-history-search" placeholder="搜索咨询记录"><div class="model-history-filters"><button class="model-filter-btn active" data-filter-category="">全部</button><button class="model-filter-btn" data-filter-category="civil">${icon("scale")} 民事</button><button class="model-filter-btn" data-filter-category="criminal">${icon("shield")} 刑事</button><button class="model-filter-btn" data-filter-category="unsure">${icon("spark")} 不确定</button></div></div><div id="model-history-list"></div>',
    );
    const list = document.querySelector("#model-history-list");
    const search = document.querySelector("#model-history-search");
    let categoryFilter = "";
    const update = () => {
      const owned = chats()
        .slice()
        .sort((a, b) => b.updated.localeCompare(a.updated))
        .filter((c) => c.title.includes(search.value.trim()) && (!categoryFilter || c.category === categoryFilter));
      list.innerHTML = owned.length
        ? owned
            .map(
              (c) => {
                const categoryLabel = consultationCategories[c.category]?.[0] || "综合";
                const categoryBadge = `<span class="category-badge ${c.category}">${icon(categoryIcon[c.category] || "spark")}${categoryLabel}</span>`;
                const riskBadge = c.risk_level === "high" ? `<span class="risk-badge">${icon("alert")}高风险</span>` : "";
                return `<div class="model-history-item"><button class="model-history-row" data-model-record="${esc(c.id)}"><div class="history-row-header">${categoryBadge}${riskBadge}<span class="history-topic">${esc(c.topic)}</span></div><b>${esc(c.title)}</b><small>${date(c.updated)}${c.messages.length ? ` · ${c.messages.filter((m) => m.role === "user").length}轮提问` : ""}</small>${icon("arrow")}</button><button class="model-history-delete" data-model-delete="${esc(c.id)}" title="删除咨询" aria-label="删除咨询 ${esc(c.title)}" ${busy ? "disabled" : ""}>${icon("trash")}</button></div>`;
              }
            )
            .join("")
        : '<div class="model-history-empty">暂无匹配的咨询记录</div>';
      list.querySelectorAll("[data-model-record]").forEach((el) =>
        el.addEventListener("click", () => {
          closeModal();
          navigate("model-chat", el.dataset.modelRecord);
          refresh();
          window.scrollTo({ top: 0, behavior: "auto" });
        }),
      );
      list.querySelectorAll("[data-model-delete]").forEach((el) =>
        el.addEventListener("click", () => {
          const chat = chats().find((c) => c.id === el.dataset.modelDelete);
          if (chat) confirmDelete(chat);
        }),
      );
    };
    document.querySelectorAll("[data-filter-category]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-filter-category]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        categoryFilter = btn.dataset.filterCategory;
        update();
      });
    });
    search.addEventListener("input", update);
    update();
    search.focus();
  }
  return { render, bind, clear: () => { drafts.clear(); currentChatId = ""; } };
}
