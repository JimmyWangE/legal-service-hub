from dataclasses import dataclass
from functools import lru_cache
import json
from pathlib import Path
from threading import BoundedSemaphore
from uuid import uuid4
import time
from typing import Protocol

import httpx
from redis.exceptions import RedisError

from app.core.config import get_settings
from app.core.errors import DomainError


@dataclass
class ModelAnswer:
    text: str
    risk: bool


class ModelProvider(Protocol):
    def answer(self, prompt: str, topic: str, context: list[str] | None = None) -> ModelAnswer:
        ...

    def stream_answer(self, prompt: str, topic: str, context: list[str] | None = None):
        ...


class StubModelProvider:
    """Safe local provider; replace with an LLM/RAG worker without changing the API layer."""

    def answer(self, prompt: str, topic: str, context: list[str] | None = None) -> ModelAnswer:
        risk_terms = ("羁押", "逮捕", "刑拘", "立案", "时效", "财产转移", "人身危险")
        risk = any(term in prompt for term in risk_terms)
        risk_text = "\n\n检测到可能的紧急或高风险事项，请尽快联系人工律师核实。" if risk else ""
        return ModelAnswer(
            text=(
                f"## {topic} · 信息整理示例\n"
                "以下内容用于演示咨询流程，不构成法律意见。\n\n"
                "## 1. 待核实信息\n请补充事件时间、地区、涉及主体、已有材料和希望达成的结果。\n\n"
                "## 2. 下一步\n可以继续补充事实，或在确认公开范围后转为律师服务需求。"
                f"{risk_text}"
            ),
            risk=risk,
        )

    def stream_answer(self, prompt: str, topic: str, context: list[str] | None = None):
        answer = self.answer(prompt, topic, context)
        for start in range(0, len(answer.text), 32):
            yield answer.text[start:start + 32]


class OpenAICompatibleProvider:
    def __init__(self):
        settings = get_settings()
        if not settings.model_api_key_file:
            raise DomainError("未配置模型 API Key 文件", 503, "model_not_configured")
        key_path = Path(settings.model_api_key_file)
        try:
            api_key = key_path.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise DomainError("模型 API Key 文件不可读取", 503, "model_key_unavailable") from exc
        if not api_key:
            raise DomainError("模型 API Key 文件为空", 503, "model_key_unavailable")
        self.settings = settings
        self.headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        self.base_url = settings.model_base_url.rstrip("/") + "/"
        self.capacity = BoundedSemaphore(settings.model_max_concurrency)
        self.client = httpx.Client(
            base_url=self.base_url,
            headers=self.headers,
            timeout=httpx.Timeout(settings.model_timeout_seconds, connect=10.0),
            trust_env=False,
        )
        self._model_name = settings.model_name.strip()

    def _model(self) -> str:
        if self._model_name:
            return self._model_name
        try:
            response = self.client.get("models")
            response.raise_for_status()
            models = response.json().get("data", [])
            self._model_name = models[0]["id"] if models else ""
        except (httpx.HTTPError, RedisError, KeyError, IndexError, TypeError, ValueError) as exc:
            raise DomainError("无法从模型服务发现可用模型", 503, "model_unavailable") from exc
        if not self._model_name:
            raise DomainError("模型服务没有返回可用模型", 503, "model_unavailable")
        return self._model_name

    def _messages(self, prompt: str, topic: str, context: list[str] | None = None):
        system = (
            "你是法律服务平台的法律信息整理助手。只提供一般信息、事实梳理和下一步建议，"
            "不替代律师意见，不承诺案件结果。遇到刑事、羁押、时效、立案、财产转移或人身危险等高风险事项，"
            "明确建议尽快联系人工律师。请使用简体中文，结构清晰，避免编造法规条文。"
            "不要输出思考过程，直接给出完整回答；如需分点请使用清晰的标题和项目符号。"
        )
        messages = [{"role": "system", "content": system}]
        if context:
            remaining = 16000
            history = []
            for entry in reversed(context[-12:]):
                if not isinstance(entry, dict) or entry.get("role") not in {"user", "assistant"}:
                    continue
                content = str(entry.get("content", ""))[:min(4000, remaining)]
                history.insert(0, {"role": entry["role"], "content": content})
                remaining -= len(content)
                if remaining <= 0:
                    break
            messages.extend(history)
        messages.append({"role": "user", "content": f"咨询领域：{topic}\n用户问题：{prompt}"})
        return messages

    def _request_body(self, messages, stream: bool, max_tokens: int | None = None):
        return {
            "model": self._model(),
            "messages": messages,
            "temperature": self.settings.model_temperature,
            "max_tokens": max_tokens or self.settings.model_max_tokens,
            "stream": stream,
            "chat_template_kwargs": {"enable_thinking": self.settings.model_enable_thinking},
        }

    def probe(self):
        response = self.client.post("chat/completions", json={"model": self._model(), "messages": [{"role": "user", "content": "请用一句话说明这是一项服务可用性测试。"}], "max_tokens": 32, "temperature": 0, "stream": False}, timeout=10)
        response.raise_for_status()
        message = response.json()["choices"][0]["message"]
        if not message.get("content") and not message.get("reasoning_content") and not message.get("reasoning"):
            raise DomainError("模型生成探测无响应", 503, "model_generation_unavailable")

    def answer(self, prompt: str, topic: str, context: list[str] | None = None) -> ModelAnswer:
        messages = self._messages(prompt, topic, context)
        if not self.capacity.acquire(blocking=False):
            raise DomainError("模型繁忙，请稍后重试", 429, "model_busy")
        lease = uuid4().hex
        shared = None
        try:
            if self.settings.redis_url:
                from app.services.health import redis_client

                shared = redis_client()
                admitted = shared.eval("redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1]); if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end; redis.call('ZADD', KEYS[1], ARGV[2], ARGV[4]); redis.call('EXPIRE', KEYS[1], 180); return 1", 1, "model:inflight", time.time(), time.time() + self.settings.model_timeout_seconds + 15, self.settings.model_max_concurrency, lease)
                if not admitted:
                    raise DomainError("模型繁忙，请稍后重试", 429, "model_busy")
            request_body = self._request_body(messages, stream=False)
            response = self.client.post("chat/completions", json=request_body)
            response.raise_for_status()
            payload = response.json()
            choice = payload["choices"][0]
            message = choice["message"]
            if choice.get("finish_reason") == "length" and self.settings.model_max_tokens < 4096:
                request_body["max_tokens"] = min(4096, self.settings.model_max_tokens * 2)
                response = self.client.post("chat/completions", json=request_body)
                response.raise_for_status()
                payload = response.json()
                choice = payload["choices"][0]
                message = choice["message"]
            content = message.get("content") or ""
            if isinstance(content, list):
                content = "".join(str(item.get("text", "")) for item in content if isinstance(item, dict))
            if not isinstance(content, str) or not content.strip():
                raise ValueError("empty model response")
            if "</think>" in content:
                content = content.rsplit("</think>", 1)[1].strip()
            if not content:
                raise ValueError("empty model answer")
            risk_terms = ("羁押", "逮捕", "刑拘", "立案", "时效", "财产转移", "人身危险")
            risk = any(term in prompt or term in content for term in risk_terms)
            return ModelAnswer(text=content.strip(), risk=risk)
        except (httpx.HTTPError, RedisError, KeyError, IndexError, TypeError, ValueError) as exc:
            raise DomainError("模型服务暂时不可用，请稍后重试或联系人工律师", 503, "model_unavailable") from exc
        finally:
            self.capacity.release()
            if shared:
                try:
                    shared.zrem("model:inflight", lease)
                except Exception:
                    pass
                shared.close()

    def stream_answer(self, prompt: str, topic: str, context: list[str] | None = None):
        messages = self._messages(prompt, topic, context)
        if not self.capacity.acquire(blocking=False):
            raise DomainError("模型繁忙，请稍后重试", 429, "model_busy")
        lease = uuid4().hex
        shared = None
        try:
            if self.settings.redis_url:
                from app.services.health import redis_client

                shared = redis_client()
                admitted = shared.eval("redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1]); if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end; redis.call('ZADD', KEYS[1], ARGV[2], ARGV[4]); redis.call('EXPIRE', KEYS[1], 180); return 1", 1, "model:inflight", time.time(), time.time() + self.settings.model_timeout_seconds + 15, self.settings.model_max_concurrency, lease)
                if not admitted:
                    raise DomainError("模型繁忙，请稍后重试", 429, "model_busy")
            generated = []
            continuation = 0
            while True:
                stream = self._stream_chunks(messages)
                try:
                    while True:
                        chunk = next(stream)
                        generated.append(chunk)
                        yield chunk
                except StopIteration as finished:
                    finish_reason = finished.value
                if finish_reason != "length" or continuation >= 2:
                    break
                messages = [
                    *messages,
                    {"role": "assistant", "content": "".join(generated)},
                    {"role": "user", "content": "请从上次回答中断的位置继续，直接输出剩余内容，不要重复已经输出的内容。"},
                ]
                continuation += 1
        except DomainError:
            raise
        except (httpx.HTTPError, RedisError, KeyError, IndexError, TypeError, ValueError) as exc:
            raise DomainError("模型服务暂时不可用，请稍后重试或联系人工律师", 503, "model_unavailable") from exc
        finally:
            self.capacity.release()
            if shared:
                try:
                    shared.zrem("model:inflight", lease)
                except Exception:
                    pass
                shared.close()

    def _stream_chunks(self, messages):
        finish_reason = None
        emitted = False
        with self.client.stream("POST", "chat/completions", json=self._request_body(messages, stream=True)) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                payload = json.loads(data)
                choice = payload.get("choices", [{}])[0]
                finish_reason = choice.get("finish_reason") or finish_reason
                delta = choice.get("delta", {})
                content = delta.get("content", "")
                if isinstance(content, list):
                    content = "".join(str(item.get("text", "")) for item in content if isinstance(item, dict))
                if isinstance(content, str) and content:
                    emitted = True
                    yield content
        if not emitted:
            raise DomainError("模型没有返回可展示内容", 503, "model_unavailable")
        return finish_reason


class FallbackModelProvider:
    def __init__(self, primary: ModelProvider, fallback: ModelProvider):
        self.primary = primary
        self.fallback = fallback

    def answer(self, prompt: str, topic: str, context: list[str] | None = None) -> ModelAnswer:
        try:
            return self.primary.answer(prompt, topic, context)
        except DomainError:
            return self.fallback.answer(prompt, topic, context)

    def stream_answer(self, prompt: str, topic: str, context: list[str] | None = None):
        emitted = False
        try:
            for chunk in self.primary.stream_answer(prompt, topic, context):
                emitted = True
                yield chunk
        except DomainError:
            if emitted:
                raise
            yield from self.fallback.stream_answer(prompt, topic, context)


@lru_cache(maxsize=1)
def get_model_provider() -> ModelProvider:
    settings = get_settings()
    if settings.model_provider in ("openai", "openai_compatible", "vllm"):
        try:
            primary = OpenAICompatibleProvider()
        except DomainError:
            if settings.model_fallback_to_stub:
                return StubModelProvider()
            raise
        if settings.model_fallback_to_stub:
            return FallbackModelProvider(primary, StubModelProvider())
        return primary
    return StubModelProvider()
