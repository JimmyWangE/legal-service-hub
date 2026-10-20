import assert from "node:assert/strict";
import test from "node:test";
import { apiRequest, mutate, streamRequest, subscribe } from "./api-client.js";
import { getAccessToken, setSession } from "./auth-state.js";

test("API 请求携带内存凭证，金额保持字符串", async () => {
  setSession({ access_token: "unit-token", user: { id: "unit" } });
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (endpoint, options) => {
      assert.equal(endpoint, "/api/v1/orders");
      assert.equal(options.headers.Authorization, "Bearer unit-token");
      return new Response(JSON.stringify({ paid: "19.90" }), { status: 200 });
    };
    assert.equal((await apiRequest("/orders")).paid, "19.90");
  } finally { globalThis.fetch = original; }
});

test("非JSON网关异常转换成可读错误；未认证时清除凭证", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("<h1>Bad gateway</h1>", { status: 502 });
    await assert.rejects(apiRequest("/orders"), (error) => error.status === 502);
    globalThis.fetch = async () => new Response("{}", { status: 401 });
    await assert.rejects(apiRequest("/orders"), (error) => error.status === 401);
    assert.equal(getAccessToken(), "");
  } finally { globalThis.fetch = original; }
});

test("参数校验错误显示具体字段", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "validation_error", message: "请求参数校验失败", details: [{ loc: ["body", "challenge_id"], message: "Field required" }] } }), { status: 422, headers: { "X-Request-Id": "validation-test" } });
    await assert.rejects(apiRequest("/auth/register", { method: "POST", body: {} }), (error) => error.message.includes("challenge_id: Field required") && error.requestId === "validation-test");
  } finally { globalThis.fetch = original; }
});

test("POST 网络不确定失败后沿用同一幂等键，不自动重发", async () => {
  const original = globalThis.fetch;
  const keys = [];
  try {
    globalThis.fetch = async (endpoint, options) => {
      keys.push(options.headers["Idempotency-Key"]);
      if (keys.length === 1) throw new TypeError("network interrupted");
      return new Response('{"id":"saved"}', { status: 200 });
    };
    await assert.rejects(mutate("/requests", { title: "重试测试" }));
    assert.equal(keys.length, 1);
    assert.equal((await mutate("/requests", { title: "重试测试" })).id, "saved");
    assert.equal(keys[0], keys[1]);
  } finally { globalThis.fetch = original; }
});

test("流式咨询按事件增量回调，并返回最终落库结果", async () => {
  setSession({ access_token: "stream-token", user: { id: "stream-user" } });
  const original = globalThis.fetch;
  const events = [];
  try {
    globalThis.fetch = async (endpoint, options) => {
      assert.equal(endpoint, "/api/v1/consultations/c1/messages/stream");
      assert.equal(options.headers.Authorization, "Bearer stream-token");
      assert.equal(options.headers.Accept, "text/event-stream, application/json");
      const response = [
        'event: start\ndata: {"consultation_id":"c1"}\n\n',
        'event: chunk\ndata: {"text":"第一段"}\n\nevent: chunk\ndata: {"text":"第二段"}\n\n',
        'event: done\ndata: {"id":"c1","messages":[]}\n\n',
      ].join("");
      const encoded = new TextEncoder().encode(response);
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoded.slice(0, 17));
          controller.enqueue(encoded.slice(17));
          controller.close();
        },
      }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    };
    const result = await streamRequest("/consultations/c1/messages/stream", { prompt: "测试" }, {
      idempotencyKey: "stream-key",
      onEvent: (name, payload) => events.push([name, payload]),
    });
    assert.deepEqual(events.map(([name]) => name), ["start", "chunk", "chunk", "done"]);
    assert.equal(events[1][1].text + events[2][1].text, "第一段第二段");
    assert.equal(result.id, "c1");
  } finally { globalThis.fetch = original; }
});

test("事件订阅解析帧、携带凭证，正常结束后重连直至取消", async () => {
  setSession({ access_token: "sub-token", user: { id: "unit" } });
  const original = globalThis.fetch;
  const controller = new AbortController();
  const events = [];
  let calls = 0;
  try {
    globalThis.fetch = async (endpoint, options) => {
      calls += 1;
      assert.equal(endpoint, `/api/v1/chats/stream?since=c${calls}`);
      assert.equal(options.headers.Authorization, "Bearer sub-token");
      return new Response(`event: ready\ndata: {"cursor":"c${calls}"}\n\nevent: message\ndata: {"id":"m${calls}"}\n\n`, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    };
    await subscribe(() => `/chats/stream?since=c${calls + 1}`, { signal: controller.signal, onEvent: (name, payload) => { events.push([name, payload.id || payload.cursor]); if (events.length === 4) controller.abort(); } });
    assert.deepEqual(events, [["ready", "c1"], ["message", "m1"], ["ready", "c2"], ["message", "m2"]]);
    globalThis.fetch = async () => new Response("{}", { status: 401 });
    await subscribe("/chats/stream", {});
    assert.equal(getAccessToken(), "");
  } finally { globalThis.fetch = original; }
});
