import { clearSession, getAccessToken } from "./auth-state.js";

const pendingIntents = new Map();

function validationMessage(detail) {
  if (!detail?.details?.length) return detail?.message;
  const fields = detail.details.map((item) => {
    const location = Array.isArray(item.loc) ? item.loc.filter((part) => part !== "body").join(".") : "请求体";
    return `${location || "请求体"}: ${item.message}`;
  });
  return `${detail.message || "请求参数校验失败"}：${fields.join("；")}`;
}

export class ApiError extends Error {
  constructor(message, status = 0, code = "network_error", requestId = "") {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const values = new Uint8Array(24);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function apiRequest(endpoint, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 110000);
  const headers = { Accept: "application/json" };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  const multipart = options.body instanceof FormData;
  if (options.body !== undefined && !multipart) headers["Content-Type"] = "application/json";
  try {
    const response = await fetch(`/api/v1${endpoint}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : multipart ? options.body : JSON.stringify(options.body),
      credentials: "same-origin",
      signal: controller.signal,
      cache: "no-store",
    });
    const requestId = response.headers.get("X-Request-Id") || "";
    if (options.download && response.ok) return response.blob();
    let payload = null;
    if (response.status !== 204) {
      const text = await response.text();
      try { payload = JSON.parse(text); } catch { payload = null; }
    }
    if (!response.ok) {
      if (response.status === 401 && token) {
        clearSession();
        globalThis.dispatchEvent?.(new Event("auth-expired"));
      }
      const detail = payload?.error ?? payload?.detail;
      const messages = { 401: "登录已过期，请重新登录；尚未提交的输入会保留", 403: "当前账户无权执行此操作", 409: "数据已更新或请求冲突，请刷新核对后重试", 422: "请检查填写内容", 429: "请求较多，请稍后重试", 503: "服务暂不可用，请稍后重试" };
      throw new ApiError(validationMessage(detail) || messages[response.status] || "请求失败，请稍后重试", response.status, detail?.code || "request_failed", requestId);
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.name === "AbortError" ? "等待超时，服务器可能仍在处理；请先刷新状态，重试将沿用同一幂等键" : "网络连接失败，请检查网络后重试");
  } finally {
    clearTimeout(timer);
  }
}

export async function mutate(endpoint, body, options = {}) {
  const intent = JSON.stringify([endpoint, body ?? null]);
  if (!pendingIntents.has(intent)) pendingIntents.set(intent, createIdempotencyKey());
  const result = await apiRequest(endpoint, { ...options, method: "POST", body, idempotencyKey: pendingIntents.get(intent) });
  pendingIntents.delete(intent);
  return result;
}

function responseError(response, payload, requestId, token) {
  if (response.status === 401 && token) {
    clearSession();
    globalThis.dispatchEvent?.(new Event("auth-expired"));
  }
  const detail = payload?.error ?? payload?.detail;
  const messages = { 401: "登录已过期，请重新登录；尚未提交的输入会保留", 403: "当前账户无权执行此操作", 409: "数据已更新或请求冲突，请刷新核对后重试", 422: "请检查填写内容", 429: "请求较多，请稍后重试", 503: "服务暂不可用，请稍后重试" };
  return new ApiError(validationMessage(detail) || messages[response.status] || "请求失败，请稍后重试", response.status, detail?.code || "request_failed", requestId);
}

export async function streamRequest(endpoint, body, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 200000);
  const headers = { Accept: "text/event-stream, application/json" };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  headers["Content-Type"] = "application/json";
  try {
    const response = await fetch(`/api/v1${endpoint}`, { method: "POST", headers, body: JSON.stringify(body), credentials: "same-origin", signal: controller.signal, cache: "no-store" });
    const requestId = response.headers.get("X-Request-Id") || "";
    const contentType = response.headers.get("Content-Type") || "";
    if (!response.ok) {
      const text = await response.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch { payload = null; }
      throw responseError(response, payload, requestId, token);
    }
    if (contentType.includes("application/json")) return await response.json();
    if (!response.body) throw new ApiError("浏览器不支持流式响应，请刷新后重试", 0, "stream_unsupported", requestId);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result = null;
    const dispatch = async (raw) => {
      const lines = raw.split(/\r?\n/);
      const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
      const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      if (!data) return;
      let payload;
      try { payload = JSON.parse(data); } catch { throw new ApiError("模型流响应格式异常，请稍后重试", 502, "invalid_stream", requestId); }
      if (eventName === "error") throw new ApiError(payload.message || "模型服务暂时不可用，请稍后重试", 503, payload.code || "model_unavailable", requestId);
      if (eventName === "done") result = payload;
      if (options.onEvent) await options.onEvent(eventName, payload);
    };
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let separator;
      while ((separator = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        await dispatch(raw);
      }
      if (done) break;
    }
    if (buffer.trim()) await dispatch(buffer);
    if (!result) throw new ApiError("模型响应未正常结束，请刷新咨询记录", 502, "incomplete_stream", requestId);
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.name === "AbortError" ? "模型生成超时，服务器可能仍在处理；请稍后刷新咨询记录" : "模型流连接中断，请沿用原问题重试");
  } finally {
    clearTimeout(timer);
  }
}

export async function streamMutate(endpoint, body, options = {}) {
  const intent = JSON.stringify([endpoint, body ?? null]);
  if (!pendingIntents.has(intent)) pendingIntents.set(intent, createIdempotencyKey());
  try {
    const result = await streamRequest(endpoint, body, { ...options, idempotencyKey: pendingIntents.get(intent) });
    pendingIntents.delete(intent);
    return result;
  } catch (error) {
    throw error;
  }
}

export async function uploadFile(file, documentId) {
  const form = new FormData();
  form.append("file", file);
  if (documentId) form.append("document_id", documentId);
  return apiRequest("/files", { method: "POST", body: form });
}

export async function downloadFile(fileId, name, endpoint = `/files/${encodeURIComponent(fileId)}`) {
  const blob = await apiRequest(endpoint, { download: true });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name || fileId;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
