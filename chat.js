import { apiRequest, downloadFile, subscribe, uploadFile } from "./api-client.js";
import { avatar, esc, icon } from "./ui.js";

const MAX_LENGTH = 2000;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const FILE_TYPES = /\.(pdf|doc|docx|txt|png|jpe?g)$/i;
const fileSize = (bytes = 0) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const preview = (message) => message.text || (message.attachment ? `[文件] ${message.attachment.name}` : "");
// SQLite 返回的时间不带时区，统一按 UTC 解析
const parseTime = (value) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(String(value)) ? value : `${value}Z`);
const dayKey = (value) => parseTime(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", weekday: "short" });
const clock = (value) => parseTime(value).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false });
function shortTime(value) {
  if (!value) return "";
  return dayKey(value) === dayKey(new Date().toISOString()) ? clock(value) : parseTime(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" });
}

export function createChat({ getUser, notify, navigate, onBadge }) {
  let conversations = [];
  const messages = new Map();
  const drafts = new Map();
  const pendingFiles = new Map();
  const exhausted = new Set();
  let activeId = "";
  let query = "";
  let connection = "connecting";
  let controller = null;
  let cursor = "";
  let readTimer = null;
  let localSequence = 0;

  const onPage = () => location.hash.startsWith("#/messages");
  const active = () => conversations.find((item) => item.id === activeId);
  const totalUnread = () => conversations.reduce((sum, item) => sum + (item.unread || 0), 0);
  const updateBadge = () => onBadge(totalUnread());

  async function loadList() {
    try {
      conversations = await apiRequest("/chats");
      updateBadge();
      refreshList();
      refreshThread();
    } catch (error) {
      if (error.status !== 401) notify(error.message);
    }
  }

  function start() {
    stop();
    controller = new AbortController();
    cursor = "";
    connection = "connecting";
    void loadList();
    void subscribe(() => `/chats/stream${cursor ? `?since=${encodeURIComponent(cursor)}` : ""}`, {
      signal: controller.signal,
      onStatus: (value) => { connection = value; refreshConnection(); },
      onEvent: (name, payload) => {
        if (name === "message") { cursor = payload.created_at; receive(payload); }
        else if (payload?.cursor) cursor = payload.cursor;
      },
    });
  }

  function stop() {
    controller?.abort();
    controller = null;
    conversations = [];
    messages.clear();
    drafts.clear();
    pendingFiles.clear();
    exhausted.clear();
    activeId = "";
  }

  function receive(message) {
    const conversation = conversations.find((item) => item.id === message.conversation_id);
    if (!conversation) { void loadList(); return; }
    const mine = message.sender_id === getUser()?.id;
    const list = messages.get(conversation.id);
    if (list && !list.some((item) => item.id === message.id)) list.push(message);
    conversation.last_message = message;
    conversation.last_message_at = message.created_at;
    conversations.sort((a, b) => parseTime(b.last_message_at) - parseTime(a.last_message_at));
    const viewing = onPage() && activeId === conversation.id && document.visibilityState === "visible";
    if (!mine && !viewing) {
      conversation.unread = (conversation.unread || 0) + 1;
      if (!onPage()) notify(`${conversation.peer.name}：${preview(message).slice(0, 40)}`);
    }
    if (viewing && !mine) scheduleRead(conversation.id);
    updateBadge();
    refreshList();
    if (conversation.id === activeId) refreshMessages(true);
  }

  function scheduleRead(id) {
    clearTimeout(readTimer);
    readTimer = setTimeout(() => {
      apiRequest(`/chats/${encodeURIComponent(id)}/read`, { method: "POST" }).catch(() => {});
    }, 300);
  }

  async function ensure(id) {
    if (!conversations.some((item) => item.id === id)) await loadList();
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return;
    if (!messages.has(id)) {
      try {
        messages.set(id, await apiRequest(`/chats/${encodeURIComponent(id)}/messages?limit=50`));
        if (messages.get(id).length < 50) exhausted.add(id);
      } catch (error) { notify(error.message); return; }
    }
    if (conversation.unread) {
      conversation.unread = 0;
      updateBadge();
      refreshList();
      scheduleRead(id);
    }
    refreshMessages(true);
  }

  async function loadEarlier() {
    const list = messages.get(activeId);
    if (!list?.length) return;
    const box = document.querySelector("#chat-messages");
    const before = box?.scrollHeight || 0;
    try {
      const older = await apiRequest(`/chats/${encodeURIComponent(activeId)}/messages?limit=50&before=${encodeURIComponent(list[0].created_at)}`);
      if (older.length < 50) exhausted.add(activeId);
      list.unshift(...older.filter((item) => !list.some((entry) => entry.id === item.id)));
      refreshMessages(false);
      if (box) box.scrollTop = box.scrollHeight - before;
    } catch (error) { notify(error.message); }
  }

  async function send(text, retryId = "", file = null) {
    const conversation = active();
    const value = text.trim();
    if (!conversation || (!value && !file && !retryId)) return;
    const list = messages.get(conversation.id) || [];
    messages.set(conversation.id, list);
    const local = retryId ? list.find((item) => item.id === retryId) : { id: `local-${++localSequence}`, conversation_id: conversation.id, sender_id: getUser().id, text: value, file, attachment: file ? { name: file.name, size: file.size } : null, created_at: new Date().toISOString(), pending: true };
    if (retryId) Object.assign(local, { pending: true, failed: false });
    else list.push(local);
    refreshMessages(true);
    try {
      if (local.file && !local.attachment?.file_id) {
        const stored = await uploadFile(local.file);
        local.attachment = { ...local.attachment, file_id: stored.id };
      }
      const body = { text: local.text, ...(local.attachment?.file_id ? { file_id: local.attachment.file_id } : {}) };
      const saved = await apiRequest(`/chats/${encodeURIComponent(conversation.id)}/messages`, { method: "POST", body });
      const index = list.indexOf(local);
      if (list.some((item) => item.id === saved.id)) list.splice(index, 1);
      else list.splice(index, 1, saved);
      conversation.last_message = saved;
      conversation.last_message_at = saved.created_at;
      conversations.sort((a, b) => parseTime(b.last_message_at) - parseTime(a.last_message_at));
      refreshList();
    } catch (error) {
      Object.assign(local, { pending: false, failed: true });
      notify(error.message);
    }
    refreshMessages(true);
  }

  async function open(peerId, orderId = "") {
    const conversation = await apiRequest("/chats", { method: "POST", body: { peer_id: peerId, ...(orderId ? { order_id: orderId } : {}) } });
    if (!conversations.some((item) => item.id === conversation.id)) conversations.unshift(conversation);
    navigate("messages", conversation.id);
  }

  function listHtml() {
    const needle = query.trim().toLowerCase();
    const items = conversations.filter((item) => !needle || item.peer.name.toLowerCase().includes(needle) || (item.last_message?.text || "").toLowerCase().includes(needle));
    if (!items.length) return `<div class="chat-placeholder"><div>${icon("message")}<h3>${conversations.length ? "没有匹配的会话" : "暂无会话"}</h3><p class="muted">${conversations.length ? "换个关键词试试" : "可在“找律师”、需求报价或订单页发起交流"}</p></div></div>`;
    return items.map((item) => `<a class="chat-item ${item.id === activeId ? "active" : ""}" href="#/messages/${esc(item.id)}">${avatar(item.peer, "lg")}<div><div class="row"><b>${esc(item.peer.name)}<span class="role-tag">${item.peer.side === "lawyer" ? "律师" : "当事人"}</span></b><time>${shortTime(item.last_message?.created_at || item.last_message_at)}</time></div><div class="row"><p>${item.last_message ? `${item.last_message.sender_id === getUser().id ? "我：" : ""}${esc(preview(item.last_message))}` : "暂无消息，打个招呼吧"}</p>${item.unread ? `<span class="unread">${item.unread > 99 ? "99+" : item.unread}</span>` : ""}</div></div></a>`).join("");
  }

  function messagesHtml() {
    const conversation = active();
    const list = messages.get(activeId);
    if (!list) return '<div class="chat-placeholder"><p class="muted">正在加载消息…</p></div>';
    const me = getUser();
    let lastDay = "";
    const rows = list.map((item) => {
      const mine = item.sender_id === me.id;
      const day = dayKey(item.created_at);
      const divider = day !== lastDay ? `<div class="day-divider">${day}</div>` : "";
      lastDay = day;
      const meta = item.failed ? `发送失败 <button type="button" class="retry" data-chat-retry="${esc(item.id)}">重新发送</button>` : item.pending ? (item.file && !item.attachment?.file_id ? "上传中…" : "发送中…") : clock(item.created_at);
      const file = item.attachment ? `<div class="chat-file">${icon("doc")}<div><b>${esc(item.attachment.name)}</b><small>${fileSize(item.attachment.size)}</small></div>${item.pending || item.failed || item.id.startsWith("local-") ? "" : `<button type="button" class="btn sm" data-chat-download="${esc(item.attachment.file_id)}" data-name="${esc(item.attachment.name)}">${icon("download")} 下载</button>`}</div>` : "";
      return `${divider}<div class="bubble-row ${mine ? "mine" : ""} ${item.failed ? "failed" : ""}">${avatar(mine ? me : conversation.peer, "sm")}<div><div class="bubble">${file}${item.text ? `<span>${esc(item.text)}</span>` : ""}</div><div class="bubble-meta">${meta}</div></div></div>`;
    }).join("");
    return `${exhausted.has(activeId) ? "" : '<button type="button" class="btn sm load-earlier" data-chat-earlier>加载更早的消息</button>'}${rows || '<div class="chat-placeholder"><p class="muted">还没有消息，发送第一条消息开始交流。</p></div>'}`;
  }

  function threadHtml() {
    const conversation = active();
    if (!conversation) return `<div class="chat-placeholder"><div>${icon("message")}<h3>选择一个会话开始交流</h3><p class="muted">当事人可从“找律师”、需求报价或订单页联系律师；律师可联系已报价或有订单往来的当事人。</p></div></div>`;
    const draft = drafts.get(conversation.id) || "";
    const pendingFile = pendingFiles.get(conversation.id);
    return `<header class="chat-header"><a class="icon-btn chat-back" href="#/messages" aria-label="返回会话列表">${icon("back")}</a>${avatar(conversation.peer, "lg")}<div><b>${esc(conversation.peer.name)}</b><small>${conversation.peer.side === "lawyer" ? "认证律师" : "当事人"} · 消息实时送达</small></div><div class="actions">${conversation.order_id ? `<a class="btn sm" href="#/order/${esc(conversation.order_id)}">${icon("order")} 关联订单</a>` : ""}${conversation.peer.side === "lawyer" ? '<a class="btn sm" href="#/requests">发布需求</a>' : ""}</div></header>
      <div class="chat-messages" id="chat-messages" aria-live="polite">${messagesHtml()}</div>
      <form class="chat-composer" id="chat-composer"><button type="button" class="icon-btn" data-chat-attach title="上传文件" aria-label="上传文件">${icon("attach")}</button><input id="chat-file" class="sr-only" type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"><div class="composer-main">${pendingFile ? `<div class="chat-file-chip">${icon("doc")}<span>${esc(pendingFile.name)} · ${fileSize(pendingFile.size)}</span><button type="button" data-chat-file-remove aria-label="移除文件">${icon("close")}</button></div>` : ""}<label class="sr-only" for="chat-input">输入消息</label><textarea id="chat-input" rows="1" maxlength="${MAX_LENGTH}" placeholder="${pendingFile ? "可补充文字说明，Enter 发送" : "输入消息，Enter 发送，Shift+Enter 换行"}">${esc(draft)}</textarea></div><div class="composer-side"><small id="chat-counter">${draft.length}/${MAX_LENGTH}</small><button class="btn primary" type="submit" ${draft.trim() || pendingFile ? "" : "disabled"}>${icon("send")} 发送</button></div></form>`;
  }

  function render(route) {
    activeId = route.id || "";
    return `<div class="chat-shell ${activeId ? "has-active" : ""}"><section class="chat-list" aria-label="会话列表"><header><h2>实时交流 <span class="conn-state ${connection === "open" ? "" : "retrying"}" id="chat-conn">${connection === "open" ? "已连接" : "连接中"}</span></h2><label class="search-input">${icon("search")}<span class="sr-only">搜索会话</span><input id="chat-search" value="${esc(query)}" placeholder="搜索联系人或消息"></label></header><div class="chat-items" id="chat-items">${listHtml()}</div></section><section class="chat-thread" id="chat-thread">${threadHtml()}</section></div>`;
  }

  function refreshConnection() {
    const target = document.querySelector("#chat-conn");
    if (!target) return;
    target.textContent = connection === "open" ? "已连接" : "重连中";
    target.classList.toggle("retrying", connection !== "open");
  }
  function refreshList() {
    const target = document.querySelector("#chat-items");
    if (target) target.innerHTML = listHtml();
  }
  function refreshThread() {
    const target = document.querySelector("#chat-thread");
    if (!target || !onPage()) return;
    const hadThread = !!target.querySelector("#chat-composer");
    if (hadThread === !!active()) return;
    target.innerHTML = threadHtml();
    bindThread(target);
    if (activeId) void ensure(activeId);
  }
  function refreshMessages(stick) {
    const box = document.querySelector("#chat-messages");
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    box.innerHTML = messagesHtml();
    bindMessages(box);
    if (stick && (nearBottom || box.dataset.initial !== "done")) { box.scrollTop = box.scrollHeight; box.dataset.initial = "done"; }
  }

  function bindMessages(box) {
    box.querySelector("[data-chat-earlier]")?.addEventListener("click", loadEarlier);
    box.querySelectorAll("[data-chat-retry]").forEach((element) => element.addEventListener("click", () => {
      const item = messages.get(activeId)?.find((entry) => entry.id === element.dataset.chatRetry);
      if (item) void send(item.text, item.id);
    }));
    box.querySelectorAll("[data-chat-download]").forEach((element) => element.addEventListener("click", async () => {
      element.disabled = true;
      try { await downloadFile(element.dataset.chatDownload, element.dataset.name, `/chats/${encodeURIComponent(activeId)}/files/${encodeURIComponent(element.dataset.chatDownload)}`); }
      catch (error) { notify(error.message); }
      finally { element.disabled = false; }
    }));
  }

  function bindThread(root) {
    const form = root.querySelector("#chat-composer");
    if (!form) return;
    const input = form.querySelector("#chat-input");
    const submit = form.querySelector("[type=submit]");
    const counter = form.querySelector("#chat-counter");
    const resize = () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; };
    const redraw = () => {
      const thread = document.querySelector("#chat-thread");
      thread.innerHTML = threadHtml();
      bindThread(thread);
      thread.querySelector("#chat-input")?.focus();
    };
    const fileInput = form.querySelector("#chat-file");
    form.querySelector("[data-chat-attach]").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (!file) return;
      if (!FILE_TYPES.test(file.name)) return notify("仅支持 PDF、Word、TXT、PNG、JPG 文件");
      if (file.size > MAX_FILE_BYTES) return notify("单个文件不能超过50MB");
      pendingFiles.set(activeId, file);
      redraw();
    });
    form.querySelector("[data-chat-file-remove]")?.addEventListener("click", () => { pendingFiles.delete(activeId); redraw(); });
    input.addEventListener("input", () => {
      drafts.set(activeId, input.value);
      counter.textContent = `${input.value.length}/${MAX_LENGTH}`;
      submit.disabled = !input.value.trim() && !pendingFiles.has(activeId);
      resize();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value;
      const file = pendingFiles.get(activeId) || null;
      if (!text.trim() && !file) return;
      input.value = "";
      drafts.delete(activeId);
      pendingFiles.delete(activeId);
      void send(text, "", file);
      if (file) redraw();
      else {
        counter.textContent = `0/${MAX_LENGTH}`;
        submit.disabled = true;
        resize();
        input.focus();
      }
    });
    const box = root.querySelector("#chat-messages");
    if (box) { bindMessages(box); box.scrollTop = box.scrollHeight; }
  }

  function bind(root) {
    if (!root.querySelector(".chat-shell")) return;
    root.querySelector("#chat-search")?.addEventListener("input", (event) => { query = event.target.value; refreshList(); });
    bindThread(root);
    if (activeId) void ensure(activeId);
  }

  document.addEventListener("visibilitychange", () => {
    const conversation = active();
    if (document.visibilityState === "visible" && onPage() && conversation?.unread) {
      conversation.unread = 0;
      updateBadge();
      refreshList();
      scheduleRead(conversation.id);
    }
  });

  return { start, stop, render, bind, open, unread: totalUnread };
}
