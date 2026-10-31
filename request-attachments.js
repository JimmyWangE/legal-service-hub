import { esc, icon } from "./ui.js";

const maxFiles = 8;
const maxBytes = 50 * 1024 * 1024;
const selections = new WeakMap();

function fileSize(size) {
  return size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export class RequestAttachmentSelection {
  entries = [];

  add(files) {
    const next = [...this.entries];
    for (const file of files) {
      if (!/\.(pdf|docx?|txt|png|jpe?g)$/i.test(file.name)) throw new Error(`不支持“${file.name}”的格式，请选择 PDF、Word、TXT 或聊天截图`);
      if (file.size === 0) throw new Error(`“${file.name}”是空文件，请重新选择`);
      if (file.size > maxBytes) throw new Error(`“${file.name}”超过 50MB，请压缩或拆分后上传`);
      if (!next.some((entry) => entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified)) next.push({ file, fileId: null });
    }
    if (next.length > maxFiles) throw new Error("每个需求最多添加 8 个附件，请移除部分文件后重试");
    this.entries = next;
  }

  remove(index) {
    this.entries.splice(index, 1);
  }

  async uploadAll(upload, onProgress = () => {}) {
    for (const [index, entry] of this.entries.entries()) {
      if (!entry.fileId) {
        onProgress(`正在上传附件 ${index + 1}/${this.entries.length}：${entry.file.name}`);
        const stored = await upload(entry.file);
        entry.fileId = stored.id;
      }
    }
    return this.entries.map((entry) => entry.fileId);
  }
}

export function requestAttachmentField() {
  return `<section class="request-upload" aria-labelledby="request-upload-title"><div class="request-upload-heading"><b id="request-upload-title">聊天记录与附件</b><span class="muted">选填 · 最多 8 个</span></div><label class="request-upload-picker" for="request-attachment-input">${icon("attach")}<span><b>添加聊天截图或相关材料</b><small>支持多选，发布前可移除</small></span><span class="btn sm">选择文件</span><input id="request-attachment-input" type="file" multiple accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" data-request-files aria-describedby="request-attachment-help"></label><p class="muted" id="request-attachment-help">支持 PNG/JPG 聊天截图、PDF、Word、TXT 聊天记录，单个不超过 50MB。请先遮盖无关隐私信息；附件仅本人和成单律师可下载，不向浏览或报价的律师公开。</p><ul class="request-attachment-list" data-request-file-list aria-label="已选择的附件" hidden></ul><p class="request-upload-status" data-request-upload-status role="status" aria-live="polite"></p></section>`;
}

export function bindRequestAttachments(root) {
  const input = root.querySelector("[data-request-files]");
  if (!input || selections.has(input.form)) return;
  const form = input.form;
  const selection = new RequestAttachmentSelection();
  selections.set(form, selection);
  const list = form.querySelector("[data-request-file-list]");
  const status = form.querySelector("[data-request-upload-status]");
  const paint = () => {
    list.hidden = selection.entries.length === 0;
    list.innerHTML = selection.entries.map((entry, index) => `<li>${icon("doc")}<div><b>${esc(entry.file.name)}</b><small>${fileSize(entry.file.size)}</small></div><button type="button" class="icon-btn" data-remove-request-file="${index}" aria-label="移除 ${esc(entry.file.name)}">${icon("close")}</button></li>`).join("");
  };
  input.addEventListener("change", () => {
    if (form.dataset.busy) return;
    try {
      selection.add(Array.from(input.files));
      status.textContent = `已选择 ${selection.entries.length} 个附件，提交时一并上传`;
      paint();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      input.value = "";
    }
  });
  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-request-file]");
    if (!button || form.dataset.busy) return;
    selection.remove(Number(button.dataset.removeRequestFile));
    status.textContent = selection.entries.length ? `已选择 ${selection.entries.length} 个附件` : "";
    paint();
  });
}

export async function uploadRequestAttachments(form, upload) {
  const selection = selections.get(form);
  if (!selection) return [];
  const input = form.querySelector("[data-request-files]");
  const status = form.querySelector("[data-request-upload-status]");
  input.disabled = true;
  try {
    const ids = await selection.uploadAll(upload, (message) => { status.textContent = message; });
    status.textContent = ids.length ? "附件已上传，正在发布需求…" : "";
    return ids;
  } catch (error) {
    status.textContent = "附件上传失败，已保留所选文件；重试时不会重复上传已成功的文件。";
    throw error;
  } finally {
    input.disabled = false;
  }
}

export function renderRequestAttachments(item) {
  const attachments = item.attachments || [];
  const count = item.attachment_count || attachments.length;
  if (!count) return "";
  return `<section class="surface"><h2>聊天记录与附件 <span class="muted">${count} 个</span></h2>${attachments.length ? `<ul class="request-attachment-list">${attachments.map((file) => `<li>${icon("doc")}<div><b>${esc(file.name)}</b><small>${fileSize(file.size)}</small></div><button class="btn sm" type="button" data-action="download-request-file" data-request-id="${esc(item.id)}" data-id="${esc(file.file_id)}" data-name="${esc(file.name)}">${icon("download")} 下载</button></li>`).join("")}</ul>` : `<p class="muted">当事人已上传相关材料。为保护隐私，仅需求本人和成单律师可下载原始附件。</p>`}</section>`;
}
