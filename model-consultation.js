import { esc, icon, date } from "./ui.js";

const topics = [
  "综合咨询",
  "合同问题",
  "劳动争议",
  "婚姻家事",
  "公司商事",
  "刑事问题",
];
const examples = [
  {
    title: "梳理法律问题",
    icon: "spark",
    tone: "orange",
    topic: "公司商事",
    text: "公司召开股东会，未通知某小股东参加就通过了决议。需要核对哪些事实和材料？",
    caption: "把问题说清楚 · 明确关注点",
  },
  {
    title: "拆解复杂案情",
    icon: "layers",
    tone: "blue",
    topic: "劳动争议",
    text: "我在公司工作三年，最近收到解除通知，对工资结算和补偿安排有疑问。应该如何整理案情和证据？",
    caption: "整理事件脉络 · 补充关键事实",
  },
  {
    title: "准备服务方案",
    icon: "doc",
    tone: "purple",
    topic: "合同问题",
    text: "我们签订了一份采购合同，对方尚未按约交付。希望先梳理合同履行情况，再请律师审阅材料。",
    caption: "明确服务目标 · 连接专业律师",
  },
];
function format(text) {
  return esc(text)
    .split("\n")
    .map((line) =>
      line.startsWith("## ")
        ? `<h3>${line.slice(3)}</h3>`
        : line
          ? `<p>${line}</p>`
          : "",
    )
    .join("");
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
        files: [],
      });
    return drafts.get(key);
  }
  function render(route) {
    currentRoute = route;
    const chat = active();
    if (chat && chat.id !== currentChatId) {
      continuous = chat.contextEnabled !== false;
      currentChatId = chat.id;
    }
    if (!chat) currentChatId = "";
    if (route.id && !chat)
      return '<section class="surface"><h1>找不到可访问的咨询记录</h1><a class="btn" href="#/model-chat">开始新的咨询</a></section>';
    const d = draft();
    return `<section class="legal-model ${chat ? "has-conversation" : ""}" aria-label="法律模型咨询"><div class="model-toolbar"><div><button class="btn" data-model-action="history">${icon("history")} 咨询记录 <span class="model-history-count">${chats().length}</span></button><button class="btn" data-model-action="new">${icon("plus")} 新建咨询</button></div><label class="model-memory"><input type="checkbox" id="model-continuous" ${continuous ? "checked" : ""}><span>连续对话</span></label></div>
      ${chat ? thread(chat) : `<header class="model-hero"><span class="model-eyebrow">${icon("spark")} 法律模型咨询</span><h1>层层拆解，理清法律问题</h1><p>从一个问题开始，整理事实、发现关注点，为专业法律服务做好准备。</p><button class="model-guide" data-model-action="guide"><span>▶</span> 1分钟了解咨询方式</button></header>`}
      ${composer(d, !!chat)}
      ${!chat ? `<div class="model-examples"><div class="model-divider"><span></span>您可以按照以下场景提问<span></span></div><div class="model-scenario-grid">${examples.map((e, i) => `<button class="model-scenario ${e.tone}" data-model-example="${i}"><div><h2><span>${icon(e.icon)}</span>${e.title}</h2><p>${e.text}</p><small>${e.caption}</small><span class="model-example-arrow">${icon("arrow")}</span></div></button>`).join("")}</div></div>` : ""}
      <footer class="model-disclaimer">${icon("info")} 当前为本地示例回复，尚未连接真实法律模型。内容不构成法律意见；重要或紧急事项请联系律师。</footer></section>`;
  }
  function composer(d, followup) {
    return `<form id="model-consultation-form" class="model-composer ${followup ? "model-followup" : ""}"><label class="sr-only" for="model-prompt">法律咨询内容</label><textarea id="model-prompt" name="prompt" rows="3" maxlength="8000" placeholder="${followup ? "继续补充事实，或追问您关心的事项…" : "输入法律问题，描述案情或需要帮助的事项…"}">${esc(d.text)}</textarea><div class="model-file-chips">${d.files.map((f, i) => `<span>${icon("attach")}${esc(f.name)}<button type="button" data-model-remove-file="${i}" aria-label="移除材料 ${esc(f.name)}">×</button></span>`).join("")}</div>${d.files.length ? '<p class="model-file-note">材料仅记录文件名和大小，示例回复不会读取或分析文件内容。</p>' : ""}<div class="model-compose-footer"><label class="model-topic">${icon("spark")}<select aria-label="咨询领域" id="model-topic">${topics.map((t) => `<option ${d.topic === t ? "selected" : ""}>${t}</option>`).join("")}</select></label><div class="model-tools"><span class="model-key-hint">Enter发送 · Shift+Enter换行</span><button type="button" class="model-tool" data-model-action="polish" title="完善提问" aria-label="完善提问">${icon("magic")}</button><button type="button" class="model-tool" data-model-action="attach" title="添加材料" aria-label="添加材料">${icon("attach")}</button><button class="model-send" type="submit" aria-label="发送咨询" ${d.text.trim().length < 2 ? "disabled" : ""}>${icon("send")}</button></div></div><input hidden id="model-files" type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" multiple></form>`;
  }
  function thread(chat) {
    return `<div class="model-thread-heading"><div><span>${esc(chat.topic)} · ${date(chat.created)}</span><h1>${esc(chat.title)}</h1></div><button class="btn" data-model-action="export">${icon("download")} 导出咨询</button></div><div class="model-messages" aria-label="咨询对话">${chat.messages.map((m, i) => (m.role === "user" ? `<article class="model-message model-user" aria-label="我的提问"><div><p>${esc(m.text)}</p>${m.attachments?.length ? `<small>${icon("attach")} ${m.attachments.map((f) => esc(f.name)).join("、")}</small>` : ""}</div></article>` : `<article class="model-message model-assistant" aria-label="法律助手示例回复"><span class="model-assistant-avatar">${icon("spark")}</span><div><div class="model-answer-label">法律助手 <span>本地示例</span></div>${m.risk ? `<div class="model-urgent">${icon("review")} 检测到紧急事项关键词，请优先联系人工律师核对。<a href="#/lawyers">找律师 ${icon("arrow")}</a></div>` : ""}<div class="model-answer-content">${format(m.text)}</div><div class="model-answer-actions"><button data-model-copy="${i}" title="复制回复">${icon("copy")} 复制</button><button data-model-feedback="有用" data-index="${i}" class="${(chat.feedbackByMessage?.[i] || chat.feedback) === "有用" ? "selected" : ""}">${icon("thumb")} 有用</button><button data-model-feedback="无用" data-index="${i}" class="${(chat.feedbackByMessage?.[i] || chat.feedback) === "无用" ? "selected" : ""}">需要改进</button></div></div></article>`)).join("")}</div><div class="model-conversion"><div>${icon("lawyer")}<span>需要律师审阅材料或起草文书？</span></div><button class="btn primary" data-model-action="request">转为服务需求 ${icon("arrow")}</button><a href="#/lawyers" class="btn">联系律师</a></div>`;
  }
  function bind(root) {
    if (getActor().role !== "client" || !root.querySelector(".legal-model"))
      return;
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
    root.querySelectorAll("[data-model-example]").forEach((el) =>
      el.addEventListener("click", () => {
        const e = examples[Number(el.dataset.modelExample)];
        draft().text = e.text;
        draft().topic = e.topic;
        refresh();
        focusPrompt();
      }),
    );
    root.querySelector("#model-prompt")?.addEventListener("input", (e) => {
      draft().text = e.target.value;
      root.querySelector(".model-send").disabled =
        e.target.value.trim().length < 2;
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
          ? "后续示例回复参考当前会话中的提问"
          : "后续示例回复仅参考本次提问",
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
      draft().files.push(...files.map((f) => ({ name: f.name, size: f.size })));
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
          notify("已复制示例回复");
        } catch {
          notify("浏览器暂不支持复制，请选择文字后复制");
        }
      }),
    );
    root.querySelectorAll("[data-model-feedback]").forEach((el) =>
      el.addEventListener("click", () => {
        try {
          commit("model-feedback", {
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
  function send() {
    const d = draft();
    if (d.text.trim().length < 2) {
      notify("请先输入具体的法律问题");
      return;
    }
    try {
      const chat = active();
      const result = commit(chat ? "model-message" : "model-chat", {
        id: chat?.id,
        prompt: d.text,
        topic: d.topic,
        attachments: d.files,
        contextEnabled: continuous,
      });
      drafts.delete(currentRoute.id || "new");
      navigate("model-chat", result.id);
      refresh();
      requestAnimationFrame(() =>
        document
          .querySelector(".model-followup")
          ?.scrollIntoView({ behavior: "smooth", block: "end" }),
      );
    } catch (error) {
      notify(error.message);
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
      d.text = `事实经过：\n${d.text.trim()}\n\n涉及的时间与地区：\n\n希望解决的问题：`;
      refresh();
      focusPrompt();
    }
    if (name === "history") history();
    if (name === "guide")
      modal(
        "如何使用法律模型咨询",
        '<div class="model-guide-content"><b>1. 描述问题</b><p>可以直接输入案情，也可以点击场景卡片带入示例。</p><b>2. 继续补充</b><p>选择咨询领域、补充关键事实，支持连续追问与本地记录回看。</p><b>3. 联系律师</b><p>需要进一步服务时，先核对摘要，再确认公开范围并发布服务需求。</p><p class="muted">当前为界面与流程演示，尚未接入真实模型。</p></div>',
      );
    if (name === "request" && active()) createRequest(active().id);
    if (name === "export" && active()) {
      const chat = active();
      download(
        `法律模型咨询-${chat.id}.txt`,
        chat.messages
          .map(
            (m) =>
              `${m.role === "user" ? "我的提问" : "法律助手（本地示例）"}\n${m.text}${m.attachments?.length ? "\n材料：" + m.attachments.map((f) => f.name).join("、") : ""}`,
          )
          .join("\n\n"),
      );
      notify("咨询记录已导出");
    }
  }
  function history() {
    modal(
      "法律模型咨询记录",
      '<label class="sr-only" for="model-history-search">搜索咨询记录</label><input class="model-history-search" id="model-history-search" placeholder="搜索咨询记录"><div id="model-history-list"></div>',
    );
    const list = document.querySelector("#model-history-list");
    const search = document.querySelector("#model-history-search");
    const update = () => {
      const owned = chats()
        .slice()
        .sort((a, b) => b.updated.localeCompare(a.updated))
        .filter((c) => c.title.includes(search.value.trim()));
      list.innerHTML = owned.length
        ? owned
            .map(
              (c) =>
                `<button class="model-history-row" data-model-record="${esc(c.id)}"><span>${esc(c.topic)}</span><b>${esc(c.title)}</b><small>${date(c.updated)} · ${c.messages.filter((m) => m.role === "user").length}轮提问</small>${icon("arrow")}</button>`,
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
    };
    search.addEventListener("input", update);
    update();
    search.focus();
  }
  return { render, bind };
}
